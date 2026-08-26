const SHARE_TOKEN_PATH = /^\/r\/[^/]+/;
const SHARE_TOKEN_ANYWHERE = /\/r\/[A-Za-z0-9_-]+/g;

export function redactPath(path) {
  return path.replace(SHARE_TOKEN_PATH, '/r/[redacted]');
}

// Belt-and-braces: unlike redactPath (which only matches a well-formed
// /r/:token path), this strips any /r/<token> sequence out of an arbitrary
// string — e.g. a full share URL embedded in an Error message or stack —
// so a future code path that logs one still can't leak the token.
export function redactTokens(text) {
  return text.replace(SHARE_TOKEN_ANYWHERE, '/r/[redacted]');
}

export function requestLogger(config) {
  return function (req, res, next) {
    if (config.nodeEnv === 'test') {
      next();
      return;
    }

    const start = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const line = [
        new Date().toISOString(),
        req.method,
        redactPath(req.path),
        res.statusCode,
        `${durationMs.toFixed(1)}ms`,
      ].join(' ');
      console.log(line);
    });

    next();
  };
}
