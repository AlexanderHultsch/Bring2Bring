const SHARE_TOKEN_PATH = /^\/r\/[^/]+/;

export function redactPath(path) {
  return path.replace(SHARE_TOKEN_PATH, '/r/[redacted]');
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
