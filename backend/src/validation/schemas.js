/**
 * Request validation schemas.
 *
 * Kept in one place (rather than inline in each route) so they can be unit
 * tested without booting a server or touching the database - a malformed
 * request should be rejected by the schema long before it reaches Postgres.
 */

const { z } = require('zod');

const LANGUAGES = ['python', 'cpp', 'java', 'javascript', 'c', 'go'];

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

const createCourse = z.object({
  title: z.string().trim().min(1, 'Course title is required').max(200),
  description: z.string().trim().max(5000).optional().default(''),
  term: z.string().trim().max(50).optional().default(''),
});

const updateCourse = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(5000).optional(),
  term: z.string().trim().max(50).optional(),
  archived: z.boolean().optional(),
});

const joinCourse = z.object({
  joinCode: z.string().trim().min(1, 'A join code is required').max(16),
});

const courseUserParams = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});

const examUserParams = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});

const gradeParams = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
  problemId: z.coerce.number().int().positive(),
});

const accommodation = z.object({
  // 0 removes the accommodation. Capped at 24h so a typo can't leave an exam
  // open indefinitely for one student.
  extra_minutes: z.coerce.number().int().min(0).max(1440),
  note: z.string().trim().max(500).optional().default(''),
});

const gradeOverride = z.object({
  score: z.coerce.number().int().min(0),
  max_score: z.coerce.number().int().positive(),
  feedback: z.string().trim().max(2000).optional().default(''),
});

/**
 * The paper: which problems, in which order, worth how much.
 *
 * `problem_ids` is ordered - position N in the array is question N on the
 * paper - so a client that simply sends the list it already had keeps working
 * and gets the order it was displaying. `points` is optional and parallel to
 * it; omitted, the server divides 100 evenly the way it always has.
 */
const examPaper = z.object({
  problem_ids: z.array(z.coerce.number().int().positive()).min(1, 'An exam needs at least one problem'),
  points: z.array(z.coerce.number().int().min(0).max(1000)).optional(),
  // Only meaningful when it narrows the pool; the route drops it otherwise.
  problems_per_student: z.coerce.number().int().positive().nullish(),
  // Capped at 24h for the same reason an accommodation is: a typo should not
  // leave a paper collectable a week later.
  late_window_minutes: z.coerce.number().int().min(0).max(1440).optional().default(0),
  late_penalty_percent: z.coerce.number().int().min(0).max(100).optional().default(0),
});

const updateExam = examPaper.extend({
  title: z.string().trim().min(1, 'A title is required').max(200),
  description: z.string().trim().max(5000).optional().default(''),
  start_time: z.coerce.date(),
  end_time: z.coerce.date(),
  duration_minutes: z.coerce.number().int().positive().max(1440),
});

/**
 * The whole roster in one request rather than one call per student.
 *
 * An empty array is a meaningful value and not a missing one: it clears the
 * roster, which returns the exam to being sat by the whole course. That is why
 * this is a PUT of the entire list - "remove the last student" and "never had a
 * roster" must be expressible and distinguishable.
 */
const examRoster = z.object({
  user_ids: z.array(z.coerce.number().int().positive()),
});

const saveDraft = z.object({
  problem_id: z.coerce.number().int().positive(),
  exam_id: z.coerce.number().int().positive().nullish(),
  language,
  code: z.string().max(100000),
});

const draftQuery = z.object({
  problem_id: z.coerce.number().int().positive(),
  exam_id: z.coerce.number().int().positive().optional(),
});

const CHECKERS = ['exact', 'case_insensitive', 'float', 'unordered_lines', 'unordered_tokens', 'regex'];

const problemGrading = z.object({
  checker: z.enum(CHECKERS).optional().default('exact'),
  checker_config: z.record(z.string(), z.unknown()).optional().default({}),
  // Bounds match the database CHECK constraints, so a bad value is a clean 400
  // rather than a constraint violation surfacing as a 500.
  time_limit_sec: z.coerce.number().int().min(1).max(60).nullish(),
  memory_limit_mb: z.coerce.number().int().min(64).max(2048).nullish(),
});

const archiveCourse = z.object({
  source_label: z.string().trim().min(1).max(200).optional(),
});

const forgotPassword = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required').max(150),
});

const resetPassword = z.object({
  token: z.string().min(1, 'A reset token is required').max(200),
  password: z.string().min(6, 'Password must be at least 6 characters').max(200),
});

const verifyEmail = z.object({
  token: z.string().min(1, 'A verification token is required').max(200),
});

const integrityEvent = z.object({
  exam_id: z.coerce.number().int().positive(),
  problem_id: z.coerce.number().int().positive().nullish(),
  event_type: z.enum(['tab_hidden', 'paste', 'fullscreen_exit']),
  detail: z.string().max(1000).nullish(),
});

module.exports = {
  LANGUAGES,
  CHECKERS,
  problemGrading,
  archiveCourse,
  forgotPassword,
  resetPassword,
  verifyEmail,
  idParam,
  register,
  login,
  executeCode,
  createSubmission,
  integrityEvent,
  createCourse,
  updateCourse,
  joinCourse,
  courseUserParams,
  examUserParams,
  examPaper,
  updateExam,
  examRoster,
  gradeParams,
  accommodation,
  gradeOverride,
  saveDraft,
  draftQuery,
};
