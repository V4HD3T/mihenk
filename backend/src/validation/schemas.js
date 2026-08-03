/**
 * Request validation schemas.
 *
 * Kept in one place (rather than inline in each route) so they can be unit
 * tested without booting a server or touching the database - a malformed
 * request should be rejected by the schema long before it reaches Postgres.
 */

const { z } = require('zod');

const LANGUAGES = ['python', 'cpp', 'java', 'javascript', 'c'];

// Route params arrive as strings; coerce to a positive integer so a request
// like GET /api/submissions/abc is a clean 400 instead of a Postgres error.
const idParam = z.object({
  id: z.coerce.number().int().positive(),
});

const language = z.enum(LANGUAGES, {
  message: `Invalid language. Must be one of: ${LANGUAGES.join(', ')}`,
});

const code = z
  .string()
  .min(1, 'Code cannot be empty')
  .max(100000, 'Code is too long')
  .refine((v) => v.trim().length > 0, 'Code cannot be empty');

const register = z.object({
  name: z.string().trim().min(1, 'Name is required').max(150),
  email: z.string().trim().toLowerCase().email('A valid email address is required').max(150),
  password: z.string().min(6, 'Password must be at least 6 characters').max(200),
  // Role is deliberately NOT accepted from the client. A teacher account is
  // created only by supplying the server's configured invite code.
  inviteCode: z.string().min(1).max(200).optional(),
});

const login = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required').max(150),
  password: z.string().min(1, 'Password is required').max(200),
});

const executeCode = z.object({
  language,
  code,
  stdin: z.string().max(100000).optional().default(''),
});

const createSubmission = z.object({
  problem_id: z.coerce.number().int().positive(),
  exam_id: z.coerce.number().int().positive().nullish(),
  language,
  code,
});

const integrityEvent = z.object({
  exam_id: z.coerce.number().int().positive(),
  problem_id: z.coerce.number().int().positive().nullish(),
  event_type: z.enum(['tab_hidden', 'paste']),
  detail: z.string().max(1000).nullish(),
});

module.exports = {
  LANGUAGES,
  idParam,
  register,
  login,
  executeCode,
  createSubmission,
  integrityEvent,
};
