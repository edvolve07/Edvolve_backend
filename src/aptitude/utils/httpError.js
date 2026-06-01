export class HttpError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function badRequest(message, details = null) {
  return new HttpError(400, message, details);
}

export function unauthorized(message = 'Authentication required') {
  return new HttpError(401, message);
}

export function forbidden(message = 'You do not have permission to access this resource') {
  return new HttpError(403, message);
}

export function notFound(message = 'Resource not found') {
  return new HttpError(404, message);
}
