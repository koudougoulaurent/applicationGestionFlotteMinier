import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authApi } from '../lib/api';
import { useAuthStore } from '../store';
import { useRole } from '../hooks/useRole';

type MfaView = 'idle' | 'setup' | 'disable';

interface MfaSetupData {
  secret: string;
  qr_image: string;
}

export default function Settings() {
  const { user }        = useAuthStore();
  const { role }        = useRole();
  const queryClient     = useQueryClient();

  const [mfaView, setMfaView]   = useState<MfaView>('idle');
  const [otp, setOtp]           = useState('');
  const [setupData, setSetupData] = useState<MfaSetupData | null>(null);
  const [msg, setMsg]           = useState('');
  const [err, setErr]           = useState('');

  const { data: mfaStatus } = useQuery({
    queryKey: ['mfa-status'],
    queryFn: async () => { const r = await authApi.mfaStatus(); return r.data as { mfa_enabled: boolean }; },
  });

  // ── Start MFA setup ───────────────────────────────────────────
  const startSetup = useMutation({
    mutationFn: () => authApi.mfaSetup(),
    onSuccess: (res) => {
      setSetupData(res.data as MfaSetupData);
      setMfaView('setup');
      setOtp('');
      setErr('');
    },
    onError: () => setErr('Impossible de générer le secret MFA.'),
  });

  // ── Confirm MFA enable ────────────────────────────────────────
  const enableMfa = useMutation({
    mutationFn: () => authApi.mfaEnable(otp),
    onSuccess: () => {
      setMsg('MFA activé avec succès. Conservez précieusement votre application d\'authentification.');
      setMfaView('idle');
      setOtp('');
      setSetupData(null);
      queryClient.invalidateQueries({ queryKey: ['mfa-status'] });
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErr(msg || 'Code OTP invalide.');
      setOtp('');
    },
  });

  // ── Disable MFA ───────────────────────────────────────────────
  const disableMfa = useMutation({
    mutationFn: () => authApi.mfaDisable(otp),
    onSuccess: () => {
      setMsg('MFA désactivé.');
      setMfaView('idle');
      setOtp('');
      queryClient.invalidateQueries({ queryKey: ['mfa-status'] });
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setErr(msg || 'Code OTP invalide.');
      setOtp('');
    },
  });

  const isMfaEnabled = mfaStatus?.mfa_enabled ?? false;

  return (
    <div className="space-y-5 max-w-2xl">
      <h1 className="text-xl font-bold">Paramètres & Sécurité</h1>

      {/* User info */}
      <div className="card">
        <div className="card-header">Informations du compte</div>
        <div className="p-4 space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-mine-muted">Nom</span>
            <span className="font-medium">{user?.firstName} {user?.lastName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-mine-muted">Identifiant</span>
            <span className="font-mono text-mine-accent">{user?.username}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-mine-muted">Rôle</span>
            <span className={`badge text-xs font-semibold ${
              role === 'ADMIN' ? 'bg-purple-900/50 text-purple-300' :
              role === 'DISPATCHER' ? 'bg-blue-900/50 text-blue-300' :
              'bg-gray-700 text-gray-300'
            }`}>{role}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-mine-muted">Droits</span>
            <span className="text-xs text-mine-muted">
              {role === 'ADMIN' ? '✅ Lecture + Écriture + Administration' :
               role === 'DISPATCHER' ? '✅ Lecture + Dispatch + Alarmes' :
               '👁 Lecture seule'}
            </span>
          </div>
        </div>
      </div>

      {/* MFA section */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <span>Authentification à deux facteurs (MFA)</span>
          <span className={`badge text-xs font-semibold ${isMfaEnabled ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
            {isMfaEnabled ? '🔐 Activé' : '🔓 Désactivé'}
          </span>
        </div>

        <div className="p-4 space-y-4">
          {/* Success / error messages */}
          {msg && (
            <div className="flex gap-2 text-green-400 text-sm bg-green-900/20 border border-green-800/50 rounded-lg px-3 py-2.5">
              <span>✓</span><span>{msg}</span>
            </div>
          )}
          {err && (
            <div className="flex gap-2 text-red-400 text-sm bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2.5">
              <span>⚠</span><span>{err}</span>
            </div>
          )}

          {/* ── Idle: show toggle button ── */}
          {mfaView === 'idle' && (
            <div className="text-sm text-mine-muted space-y-3">
              <p>
                Le MFA ajoute une couche de sécurité supplémentaire. À chaque connexion, vous devrez
                saisir un code temporaire généré par votre application d'authentification.
              </p>
              <p className="text-xs">
                Applications compatibles : <strong className="text-white">Google Authenticator</strong>,{' '}
                <strong className="text-white">Authy</strong>,{' '}
                <strong className="text-white">Microsoft Authenticator</strong>, etc.
              </p>
              <div className="flex gap-3 mt-4">
                {!isMfaEnabled ? (
                  <button
                    onClick={() => { setErr(''); setMsg(''); startSetup.mutate(); }}
                    disabled={startSetup.isPending}
                    className="btn-primary text-sm"
                  >
                    {startSetup.isPending ? 'Génération…' : '🔐 Activer le MFA'}
                  </button>
                ) : (
                  <button
                    onClick={() => { setErr(''); setMsg(''); setMfaView('disable'); setOtp(''); }}
                    className="px-4 py-2 text-sm bg-red-900/40 text-red-400 border border-red-800/50 rounded-lg hover:bg-red-900/60 transition-colors"
                  >
                    Désactiver le MFA
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Setup: show QR code ── */}
          {mfaView === 'setup' && setupData && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-white font-semibold mb-2">Étape 1 — Scannez le QR code</p>
                <p className="text-xs text-mine-muted mb-3">
                  Ouvrez votre application d'authentification et scannez le code ci-dessous.
                  Si vous ne pouvez pas scanner, entrez manuellement la clé secrète.
                </p>
                <div className="flex flex-col items-center gap-4 p-4 bg-mine-bg rounded-xl border border-mine-border">
                  <img src={setupData.qr_image} alt="QR code MFA" className="w-48 h-48 rounded-lg" />
                  <div className="w-full">
                    <p className="text-xs text-mine-muted mb-1 text-center">Clé secrète (saisie manuelle)</p>
                    <div className="font-mono text-xs text-mine-accent bg-mine-border/30 rounded px-3 py-2 text-center break-all">
                      {setupData.secret}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <p className="text-sm text-white font-semibold mb-2">Étape 2 — Confirmer avec un code</p>
                <p className="text-xs text-mine-muted mb-3">
                  Entrez le code à 6 chiffres affiché dans votre application pour confirmer la configuration.
                </p>
                <input
                  type="text" inputMode="numeric" pattern="\d{6}" maxLength={6}
                  value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000" autoFocus
                  className="input w-full text-center text-xl font-mono tracking-[0.5em] py-3"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => enableMfa.mutate()}
                  disabled={otp.length !== 6 || enableMfa.isPending}
                  className="btn-primary text-sm disabled:opacity-50"
                >
                  {enableMfa.isPending ? 'Activation…' : '✓ Confirmer et activer'}
                </button>
                <button
                  onClick={() => { setMfaView('idle'); setSetupData(null); setOtp(''); setErr(''); }}
                  className="px-4 py-2 text-sm text-mine-muted hover:text-white transition-colors"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          {/* ── Disable: confirm with OTP ── */}
          {mfaView === 'disable' && (
            <div className="space-y-4">
              <p className="text-sm text-mine-muted">
                Pour désactiver le MFA, confirmez avec un code de votre application d'authentification.
              </p>
              <input
                type="text" inputMode="numeric" pattern="\d{6}" maxLength={6}
                value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000" autoFocus
                className="input w-full text-center text-xl font-mono tracking-[0.5em] py-3"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => disableMfa.mutate()}
                  disabled={otp.length !== 6 || disableMfa.isPending}
                  className="px-4 py-2 text-sm bg-red-900/40 text-red-400 border border-red-800/50 rounded-lg hover:bg-red-900/60 transition-colors disabled:opacity-50"
                >
                  {disableMfa.isPending ? 'Désactivation…' : 'Confirmer la désactivation'}
                </button>
                <button
                  onClick={() => { setMfaView('idle'); setOtp(''); setErr(''); }}
                  className="px-4 py-2 text-sm text-mine-muted hover:text-white transition-colors"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Role permissions info */}
      <div className="card">
        <div className="card-header">Gestion des droits d'accès</div>
        <div className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-mine-border">
                  <th className="text-left py-2 px-3 text-mine-muted uppercase">Rôle</th>
                  <th className="text-center py-2 px-3 text-mine-muted uppercase">Lecture</th>
                  <th className="text-center py-2 px-3 text-mine-muted uppercase">Dispatch</th>
                  <th className="text-center py-2 px-3 text-mine-muted uppercase">Écriture</th>
                  <th className="text-center py-2 px-3 text-mine-muted uppercase">Admin</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { role: 'ADMIN',      read: true, dispatch: true, write: true, admin: true, color: 'text-purple-400' },
                  { role: 'DISPATCHER', read: true, dispatch: true, write: false, admin: false, color: 'text-blue-400' },
                  { role: 'VIEWER',     read: true, dispatch: false, write: false, admin: false, color: 'text-gray-400' },
                ].map(row => (
                  <tr key={row.role} className={`border-b border-mine-border/50 ${row.role === role ? 'bg-mine-accent/5' : ''}`}>
                    <td className={`py-2.5 px-3 font-semibold ${row.color}`}>
                      {row.role} {row.role === role && <span className="text-mine-accent text-xs ml-1">← vous</span>}
                    </td>
                    {[row.read, row.dispatch, row.write, row.admin].map((v, i) => (
                      <td key={i} className="py-2.5 px-3 text-center">
                        {v ? <span className="text-green-400">✓</span> : <span className="text-mine-border">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
