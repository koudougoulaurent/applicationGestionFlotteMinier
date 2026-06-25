import { Request, Response, NextFunction } from 'express';

// SQL injection patterns — defense-in-depth (parameterized queries already prevent it)
const SQL_PATTERNS = [
  /(\b(UNION|SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|TRUNCATE|GRANT|REVOKE)\b)/i,
  /(--|\/\*|\*\/|xp_|sp_|0x[0-9a-f]+)/i,
  /(\bOR\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?|\bAND\b\s+['"]?\d+['"]?\s*=\s*['"]?\d+['"]?)/i,
  /'\s*(OR|AND)\s*'/i,
];

// Strips HTML tags, null bytes, and control characters from strings
function sanitizeString(value: string): string {
  return value
    .replace(/\0/g, '')                            // null bytes
    .replace(/[--]/g, '') // control chars
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '') // script blocks
    .replace(/<[^>]+>/g, '')                        // HTML tags
    .replace(/javascript:/gi, '')                   // js: URIs
    .replace(/on\w+\s*=/gi, '')                     // inline event handlers
    .trim();
}

// Recursively sanitize all string values in an object
function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeValue(v)])
    );
  }
  return value;
}

// Check for SQL injection patterns in string values
function detectSqlInjection(value: unknown, path = ''): string | null {
  if (typeof value === 'string') {
    for (const pattern of SQL_PATTERNS) {
      if (pattern.test(value)) {
        return `Suspicious input detected in field: ${path || 'body'}`;
      }
    }
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = detectSqlInjection(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const hit = detectSqlInjection(v, path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
  }
  return null;
}

// Middleware: sanitize body + detect SQLi
export function sanitizeBody(req: Request, res: Response, next: NextFunction): void {
  if (req.body && typeof req.body === 'object') {
    // SQL injection detection (log & block)
    const sqliHit = detectSqlInjection(req.body);
    if (sqliHit) {
      res.status(400).json({ error: 'Invalid input detected' });
      return;
    }
    // XSS sanitization
    req.body = sanitizeValue(req.body);
  }
  next();
}

// Middleware: sanitize query params
export function sanitizeQuery(req: Request, _res: Response, next: NextFunction): void {
  if (req.query) {
    for (const [key, val] of Object.entries(req.query)) {
      if (typeof val === 'string') {
        req.query[key] = sanitizeString(val);
      }
    }
  }
  next();
}
