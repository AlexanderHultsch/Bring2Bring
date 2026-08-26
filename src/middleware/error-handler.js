function titleFor(status) {
  if (status === 404) return 'Not found';
  if (status >= 400 && status < 500) return 'Error';
  return 'Server error';
}

function genericMessageFor(status) {
  if (status === 404) return 'The page you are looking for does not exist.';
  if (status >= 400 && status < 500) return 'Something went wrong with your request.';
  return 'Something went wrong. Please try again later.';
}

export function notFoundHandler() {
  return function (req, res, next) {
    const error = new Error('Not found');
    error.status = 404;
    next(error);
  };
}

export function errorHandler(config) {
  return function (err, req, res, next) {
    const rawStatus = err.status || err.statusCode;
    const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus < 500 ? rawStatus : 500;
    const title = titleFor(status);
    const message = config.isProduction ? genericMessageFor(status) : err.message;

    if (status >= 500) {
      console.error(err.message);
      console.error(err.stack);
    }

    if (req.accepts(['html', 'json']) === 'json') {
      res.status(status).json({ error: title });
      return;
    }

    res.status(status).render('error', { title, status, message });
  };
}
