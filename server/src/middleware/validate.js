import { ZodError } from "zod";
import { HttpError } from "../lib/httpError.js";

/** Validate and replace req[source] with the parsed (coerced, stripped) value. */
export const validate = (schema, source = "body") => (req, _res, next) => {
  try {
    req[source] = schema.parse(req[source] ?? {});
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      const fields = {};
      for (const issue of err.issues) fields[issue.path.join(".") || "_"] ??= issue.message;
      return next(new HttpError(400, "Validation failed", { fields }));
    }
    next(err);
  }
};
