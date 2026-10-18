import { HttpError } from "../lib/httpError.js";
import { config } from "../config.js";

export function notFoundHandler(req, _res, next) {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl.split("?")[0]}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err?.code === "LIMIT_FILE_SIZE") err = new HttpError(413, "File is too large (max 5 MB)");
  if (err?.name === "MulterError") err = new HttpError(400, err.message);
  if (err?.type === "entity.parse.failed") err = new HttpError(400, "Malformed JSON body");
  if (err?.type === "entity.too.large") err = new HttpError(413, "Request body too large");
  if (/UNIQUE constraint failed/.test(err?.message || "")) err = new HttpError(409, "A record with those details already exists");
  if (/CHECK constraint failed/.test(err?.message || "")) err = new HttpError(422, "That change is not allowed (e.g. insufficient stock)");

  const status = err instanceof HttpError ? err.status : 500;
  if (status >= 500) {
    if (!config.isTest) console.error(`[${req.id}]`, err);
  }
  res.status(status).json({
    error: {
      status,
      message: status >= 500 ? "Something went wrong on our side. Please try again." : err.message,
      details: err instanceof HttpError ? err.details : undefined,
      requestId: req.id,
    },
  });
}
