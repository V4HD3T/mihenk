/**
 * Zod validation middleware.
 *
 * validate({ body, params, query }) checks each supplied schema and replaces
 * the request property with the parsed result, so handlers downstream receive
 * coerced, trimmed, known-shaped data (numbers as numbers, emails lowercased)
 * instead of raw client input.
 *
 * On failure it responds 400 with the first message plus a per-field list,
 * matching the { error } shape the existing frontend already displays.
 */

function formatIssues(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(body)',
    message: issue.message,
  }));
}

function validate(schemas) {
  return (req, res, next) => {
    for (const key of ['params', 'query', 'body']) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (!result.success) {
        const details = formatIssues(result.error);
        return res.status(400).json({ error: details[0].message, details });
      }

      // req.query is a getter-only property on Express 5; assigning to it
      // throws. Writing to a separate field keeps this middleware usable on
      // both major versions.
      if (key === 'query') {
        req.validatedQuery = result.data;
      } else {
        req[key] = result.data;
      }
    }
    return next();
  };
}

module.exports = { validate, formatIssues };
