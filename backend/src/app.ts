import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import routes from './routes';
import { errorHandler, notFound } from './middleware/errorHandler';
import { sanitizeBody, sanitizeQuery } from './middleware/sanitize';

const app = express();

// ── Security headers (helmet) ─────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'none'"],
      scriptSrc:   ["'self'"],
      styleSrc:    ["'self'"],
      imgSrc:      ["'self'", 'data:'],
      connectSrc:  ["'self'"],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
      baseUri:     ["'self'"],
      formAction:  ["'self'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  crossOriginEmbedderPolicy: false, // needed for Socket.io
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  noSniff: true,
  xssFilter: true,
  hidePoweredBy: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, cb) => {
    const allowed = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:4000')
      .split(',')
      .map(s => s.trim());
    if (!origin || allowed.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  maxAge: 600, // preflight cache 10 min
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Strict limit on auth endpoints (brute-force protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,                   // 20 attempts per IP per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Try again later.' },
  skipSuccessfulRequests: true,
});

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Slow down.' },
});

// Simulation polling endpoints have higher limit — legitimate high-frequency polling
const simLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min window
  max: 300,            // 300 req/min = 5 req/s
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded. Slow down.' },
});

// Live telemetry (GPS trames depuis engins réels) — 1 trame/5s × 50 engins = 600/min max
const liveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 720,            // tolérance 20% sur 50 engins à 5s/trame
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Live telemetry rate limit exceeded.' },
  keyGenerator: (req) => {
    // Rate-limit par IP + fleetNumber pour bloquer le spam d'un seul engin
    const body = req.body as { fleetNumber?: string };
    return `${req.ip}:${body?.fleetNumber ?? 'unknown'}`;
  },
});

app.use('/api/v1/auth/login',         authLimiter);
app.use('/api/v1/auth/mfa/verify',    authLimiter);
app.use('/api/v1/telemetry/live',     liveLimiter); // avant le limiter général
app.use('/api/v1/simulation',         simLimiter);
app.use('/api',                       apiLimiter);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));          // cap body size
app.use(express.urlencoded({ extended: false }));  // no prototype pollution

// ── Global input sanitisation (XSS + SQLi detection) ─────────────────────────
app.use(sanitizeQuery);
app.use(sanitizeBody);

// ── Health check (public, no auth) ───────────────────────────────────────────
app.get('/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'FMS Mining API' });
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/v1', routes);

// ── Error handling ────────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

export default app;
