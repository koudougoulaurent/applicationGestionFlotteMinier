import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { query } from '../config/database';
import { AuthRequest } from '../middleware/auth';

const JWT_SECRET   = process.env.JWT_SECRET || 'fallback_secret_change_in_prod';
const JWT_EXPIRES  = process.env.JWT_EXPIRES_IN || '8h';
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// ── Helpers ────────────────────────────────────────────────────────────────────
function signFullToken(user: { user_id: string; username: string; role_name: string; site_id: string }) {
  return jwt.sign(
    { userId: user.user_id, username: user.username, role: user.role_name, siteId: user.site_id },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES } as jwt.SignOptions
  );
}

function buildUserPayload(user: Record<string, string>) {
  return {
    id:        user.user_id,
    username:  user.username,
    firstName: user.first_name,
    lastName:  user.last_name,
    role:      user.role_name,
    siteId:    user.site_id,
    mfaEnabled: Boolean(user.mfa_enabled),
  };
}

async function fetchUserByUsername(username: string) {
  const r = await query(
    `SELECT u.user_id, u.username, u.password_hash, u.first_name, u.last_name,
            u.site_id, u.active, u.mfa_secret, u.mfa_enabled,
            u.failed_attempts, u.locked_until,
            r.role_name
     FROM core.app_user u
     JOIN core.role r ON u.role_id = r.role_id
     WHERE u.username = $1`,
    [username]
  );
  return r.rows[0] || null;
}

async function fetchUserById(id: string) {
  const r = await query(
    `SELECT u.user_id, u.username, u.first_name, u.last_name,
            u.site_id, u.mfa_secret, u.mfa_enabled,
            r.role_name
     FROM core.app_user u
     JOIN core.role r ON u.role_id = r.role_id
     WHERE u.user_id = $1`,
    [id]
  );
  return r.rows[0] || null;
}

async function auditLog(params: {
  userId?: string; username?: string; action: string;
  resourceType?: string; resourceId?: string; ip?: string;
  success?: boolean; errorMessage?: string; payload?: object;
}) {
  await query(
    `INSERT INTO core.audit_log
       (user_id, username, action, resource_type, resource_id, ip_address, success, error_message, payload)
     VALUES ($1,$2,$3,$4,$5,$6::inet,$7,$8,$9)`,
    [
      params.userId || null,
      params.username || null,
      params.action,
      params.resourceType || null,
      params.resourceId || null,
      params.ip || null,
      params.success !== false,
      params.errorMessage || null,
      params.payload ? JSON.stringify(params.payload) : null,
    ]
  ).catch(() => { /* audit failures must not break the API */ });
}

// ── Controllers ────────────────────────────────────────────────────────────────

export async function login(req: Request, res: Response): Promise<void> {
  const { username, password } = req.body; // validated by Zod loginSchema
  const ip = req.ip;

  const user = await fetchUserByUsername(username);

  if (!user || !user.active) {
    await auditLog({ username, action: 'LOGIN', ip, success: false, errorMessage: 'User not found or inactive' });
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // Account lockout check
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minsLeft = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
    await auditLog({ userId: user.user_id, username, action: 'LOGIN', ip, success: false, errorMessage: 'Account locked' });
    res.status(423).json({ error: `Account locked due to too many failed attempts. Try again in ${minsLeft} minute(s).` });
    return;
  }

  // Password verification
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    const newCount = (Number(user.failed_attempts) || 0) + 1;
    const lockUntil = newCount >= MAX_ATTEMPTS
      ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
      : null;
    await query(
      `UPDATE core.app_user SET failed_attempts = $1, locked_until = $2 WHERE user_id = $3`,
      [newCount, lockUntil, user.user_id]
    );
    await auditLog({ userId: user.user_id, username, action: 'LOGIN', ip, success: false, errorMessage: `Bad password (attempt ${newCount})` });
    if (newCount >= MAX_ATTEMPTS) {
      res.status(423).json({ error: `Account locked after ${MAX_ATTEMPTS} failed attempts. Try again in ${LOCK_MINUTES} minutes.` });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
    return;
  }

  // Reset lockout counters
  await query(
    `UPDATE core.app_user SET failed_attempts = 0, locked_until = NULL, last_login = NOW() WHERE user_id = $1`,
    [user.user_id]
  );

  // MFA required?
  if (user.mfa_enabled === true) {
    const mfaSession = jwt.sign(
      { userId: user.user_id, type: 'mfa_pending' },
      JWT_SECRET,
      { expiresIn: '5m' } as jwt.SignOptions
    );
    await auditLog({ userId: user.user_id, username, action: 'LOGIN_MFA_REQUIRED', ip });
    res.json({ mfa_required: true, mfa_session: mfaSession });
    return;
  }

  // Full token
  const token = signFullToken(user);
  await auditLog({ userId: user.user_id, username, action: 'LOGIN', ip });
  res.json({ token, user: buildUserPayload(user) });
}

export async function verifyMfaLogin(req: Request, res: Response): Promise<void> {
  const { mfa_session, otp } = req.body; // validated by Zod mfaVerifySchema
  const ip = req.ip;

  let payload: { userId: string; type: string };
  try {
    payload = jwt.verify(mfa_session, JWT_SECRET) as { userId: string; type: string };
  } catch {
    res.status(401).json({ error: 'MFA session expired or invalid. Please log in again.' });
    return;
  }

  if (payload.type !== 'mfa_pending') {
    res.status(401).json({ error: 'Invalid MFA session type.' });
    return;
  }

  const user = await fetchUserById(payload.userId);
  if (!user) {
    res.status(401).json({ error: 'User not found.' });
    return;
  }

  const valid = speakeasy.totp.verify({ secret: user.mfa_secret, encoding: 'base32', token: otp, window: 1 });
  if (!valid) {
    await auditLog({ userId: user.user_id, username: user.username, action: 'MFA_VERIFY', ip, success: false, errorMessage: 'Invalid OTP' });
    res.status(401).json({ error: 'Invalid OTP code.' });
    return;
  }

  await query(`UPDATE core.app_user SET last_login = NOW() WHERE user_id = $1`, [user.user_id]);
  const token = signFullToken(user);
  await auditLog({ userId: user.user_id, username: user.username, action: 'LOGIN', ip });
  res.json({ token, user: buildUserPayload(user) });
}

export async function me(req: AuthRequest, res: Response): Promise<void> {
  const result = await query(
    `SELECT u.user_id, u.username, u.first_name, u.last_name, u.email,
            u.site_id, u.mfa_enabled, r.role_name, ms.name AS site_name
     FROM core.app_user u
     JOIN core.role r ON u.role_id = r.role_id
     LEFT JOIN core.mine_site ms ON u.site_id = ms.site_id
     WHERE u.user_id = $1`,
    [req.user?.userId]
  );
  res.json(result.rows[0] || null);
}

// ── MFA Setup ─────────────────────────────────────────────────────────────────

export async function setupMfa(req: AuthRequest, res: Response): Promise<void> {
  const user = await fetchUserById(req.user!.userId);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  if (user.mfa_enabled) { res.status(409).json({ error: 'MFA is already enabled. Disable it first.' }); return; }

  const secretObj = speakeasy.generateSecret({
    name:   `FMS Mining (${user.username})`,
    length: 20,
  });
  const secret     = secretObj.base32;
  const otpauthUrl = secretObj.otpauth_url!;

  // Save secret (not yet active until confirmed)
  await query(`UPDATE core.app_user SET mfa_secret = $1 WHERE user_id = $2`, [secret, user.user_id]);

  const qrImage = await QRCode.toDataURL(otpauthUrl);
  res.json({ secret, qr_image: qrImage, otpauth_url: otpauthUrl });
}

export async function enableMfa(req: AuthRequest, res: Response): Promise<void> {
  const { otp } = req.body; // validated by mfaOtpSchema
  const user = await fetchUserById(req.user!.userId);

  if (!user || !user.mfa_secret) {
    res.status(400).json({ error: 'Call GET /auth/mfa/setup first to generate a secret.' });
    return;
  }
  if (user.mfa_enabled) {
    res.status(409).json({ error: 'MFA is already enabled.' });
    return;
  }

  const enableValid = speakeasy.totp.verify({ secret: user.mfa_secret, encoding: 'base32', token: otp, window: 1 });
  if (!enableValid) {
    await auditLog({ userId: user.user_id, username: user.username, action: 'MFA_ENABLE', success: false, errorMessage: 'Invalid OTP during setup' });
    res.status(401).json({ error: 'Invalid OTP. MFA not enabled.' });
    return;
  }

  await query(`UPDATE core.app_user SET mfa_enabled = TRUE WHERE user_id = $1`, [user.user_id]);
  await auditLog({ userId: user.user_id, username: user.username, action: 'MFA_ENABLE' });
  res.json({ message: 'MFA enabled successfully. Store your backup codes safely.' });
}

export async function disableMfa(req: AuthRequest, res: Response): Promise<void> {
  const { otp } = req.body; // validated by mfaOtpSchema
  const user = await fetchUserById(req.user!.userId);

  if (!user || !user.mfa_enabled) {
    res.status(400).json({ error: 'MFA is not currently enabled.' });
    return;
  }

  const disableValid = speakeasy.totp.verify({ secret: user.mfa_secret, encoding: 'base32', token: otp, window: 1 });
  if (!disableValid) {
    await auditLog({ userId: user.user_id, username: user.username, action: 'MFA_DISABLE', success: false, errorMessage: 'Invalid OTP' });
    res.status(401).json({ error: 'Invalid OTP. MFA not disabled.' });
    return;
  }

  await query(
    `UPDATE core.app_user SET mfa_enabled = FALSE, mfa_secret = NULL WHERE user_id = $1`,
    [user.user_id]
  );
  await auditLog({ userId: user.user_id, username: user.username, action: 'MFA_DISABLE' });
  res.json({ message: 'MFA disabled.' });
}

export async function getMfaStatus(req: AuthRequest, res: Response): Promise<void> {
  const result = await query(
    `SELECT mfa_enabled FROM core.app_user WHERE user_id = $1`,
    [req.user!.userId]
  );
  res.json({ mfa_enabled: result.rows[0]?.mfa_enabled ?? false });
}
