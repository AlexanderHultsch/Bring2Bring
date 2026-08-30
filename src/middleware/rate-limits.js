import { rateLimit } from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const RATE_LIMIT_MESSAGE = 'Too many login attempts. Please try again later.';

function normalizedUsername(req) {
  const raw = req.body?.username;
  return typeof raw === 'string' ? raw.trim().toLowerCase() : '';
}

// SPECIFICATION.md sections 6.1/6.2: /login, /register and /reset-password
// all rate limit the same way but must re-render their own view, not
// login's, on the 429 — so the view (and any locals it needs beyond
// error/username) is parameterised rather than hard-coded.
function renderRateLimited(view, extraLocals) {
  return function (req, res) {
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    res.status(429).render(view, { error: RATE_LIMIT_MESSAGE, username, ...extraLocals });
  };
}

function ipLimiter(view, extraLocals) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: MAX_ATTEMPTS,
    standardHeaders: true,
    legacyHeaders: false,
    handler: renderRateLimited(view, extraLocals),
  });
}

function usernameLimiter(view, extraLocals) {
  return rateLimit({
    windowMs: WINDOW_MS,
    limit: MAX_ATTEMPTS,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: normalizedUsername,
    handler: renderRateLimited(view, extraLocals),
  });
}

export function loginIpLimiter() {
  return ipLimiter('login', { passwordReset: false });
}

export function loginUsernameLimiter() {
  return usernameLimiter('login', { passwordReset: false });
}

export function registerIpLimiter() {
  return ipLimiter('register');
}

export function registerUsernameLimiter() {
  return usernameLimiter('register');
}

// §6.2: showing the security question already confirms the username
// exists, so the username limiter here is the half that actually matters —
// see src/routes/auth.js.
export function resetPasswordIpLimiter() {
  return ipLimiter('reset-password', { question: null });
}

export function resetPasswordUsernameLimiter() {
  return usernameLimiter('reset-password', { question: null });
}
