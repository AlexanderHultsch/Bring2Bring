import { rateLimit } from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const RATE_LIMIT_MESSAGE = 'Too many login attempts. Please try again later.';

function normalizedUsername(req) {
  const raw = req.body?.username;
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

function renderRateLimited(req, res) {
  const username = typeof req.body?.username === 'string' ? req.body.username : '';
  res.status(429).render('login', { error: RATE_LIMIT_MESSAGE, username });
}

export function loginIpLimiter() {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: MAX_ATTEMPTS,
    standardHeaders: true,
    legacyHeaders: false,
    handler: renderRateLimited,
  });
}

export function loginUsernameLimiter() {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: MAX_ATTEMPTS,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: normalizedUsername,
    handler: renderRateLimited,
  });
}
