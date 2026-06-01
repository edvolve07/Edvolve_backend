export function errorHandler(error, _req, res, _next) {
  const statusCode = error.statusCode || error.status || 500;
  const payload = {
    message: statusCode === 500 ? 'Something went wrong' : error.message,
    details: [],
  };

  if (error.details) {
    payload.details = Array.isArray(error.details) ? error.details : [String(error.details)];
  }

  if (process.env.NODE_ENV !== 'production' && statusCode >= 400) {
    console.error('[api-error]', {
      statusCode,
      message: error.message,
      details: error.details,
      cause: error.cause?.message,
    });
  }

  if (process.env.NODE_ENV !== 'production' && statusCode === 500) {
    payload.stack = error.stack;
  }

  res.status(statusCode).json(payload);
}
