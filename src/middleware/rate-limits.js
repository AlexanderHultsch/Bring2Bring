import { rateLimit } from 'express-rate-limit';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const RATE_LIMIT_MESSAGE = 'Too many login attempts. Please try again later.';

const GLOBAL_WINDOW_MS = 60 * 1000;
const GLOBAL_CEILING_MAX = 300;

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

// SPECIFICATION.md section 11: the global ceiling above every per-route
// limiter — looser than all of them (300/min vs. share's 60/min and
// login/register/reset's 10/15min), so it never becomes the binding
// constraint on a route that already limits itself. It exists only to stop
// a flood from costing the Pi CPU it also needs for DNS. src/app.js mounts
// this after static assets, /healthz and the share route, so none of those
// count against it.
export function globalCeilingLimiter() {
  return rateLimit({
    windowMs: GLOBAL_WINDOW_MS,
    limit: GLOBAL_CEILING_MAX,
    standardHeaders: true,
    legacyHeaders: false,
  });
}
