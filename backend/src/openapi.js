/**
 * openapi.js
 *
 * The API, described. Served at GET /api/openapi.json.
 *
 * Written by hand rather than generated from decorators, because the routes are
 * plain Express and annotating them would have meant restructuring working code
 * to satisfy a generator. The usual objection to a hand-written document is
 * that it drifts, so it does not get to drift: tests/openapi.test.js walks the
 * live Express router and fails if the document and the application disagree
 * about which endpoints exist, in either direction.
 *
 * Paths use OpenAPI's {braces} where Express uses :colons; the test converts
 * between them.
 */

const { version } = require('../package.json');

// ---------------------------------------------------------------------------
// Reusable pieces
// ---------------------------------------------------------------------------

const bearer = [{ bearerAuth: [] }];

const errorSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
};

/** The responses almost every authenticated endpoint can return. */
const authErrors = {
  401: { $ref: '#/components/responses/Unauthorized' },
  429: { $ref: '#/components/responses/RateLimited' },
  500: { $ref: '#/components/responses/ServerError' },
};

const json = (schema) => ({ content: { 'application/json': { schema } } });

const ok = (description, schema) => ({ description, ...json(schema) });

const idParam = (name = 'id', description = 'Numeric identifier') => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'integer', minimum: 1 },
});

const LANGUAGES = ['python', 'cpp', 'java', 'javascript', 'c', 'go'];
const CHECKERS = ['exact', 'case_insensitive', 'float', 'unordered_lines', 'unordered_tokens', 'regex'];
const VERDICTS = [
  'accepted',
  'wrong_answer',
  'time_limit_exceeded',
  'memory_limit_exceeded',
  'runtime_error',
  'compile_error',
  'output_limit_exceeded',
];

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const schemas = {
  Error: errorSchema,

  User: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      email: { type: 'string', format: 'email' },
      role: { type: 'string', enum: ['student', 'teacher'] },
    },
  },

  AuthResult: {
    type: 'object',
    properties: {
      token: { type: 'string', description: 'JWT, sent as `Authorization: Bearer <token>`' },
      user: { $ref: '#/components/schemas/User' },
    },
  },

  Course: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      title: { type: 'string' },
      description: { type: 'string' },
      term: { type: 'string' },
      archived: { type: 'boolean' },
      join_code: {
        type: 'string',
        description: 'Present for the owning teacher only. Holding it is enough to enrol.',
      },
      problem_count: { type: 'integer' },
      student_count: { type: 'integer' },
    },
  },

  Problem: {
    type: 'object',
    description:
      'A problem belonging to an exam is not returned to a student until one of its exams has started.',
    properties: {
      id: { type: 'integer' },
      course_id: { type: 'integer' },
      title: { type: 'string' },
      description: { type: 'string' },
      difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
      checker: { type: 'string', enum: CHECKERS },
      checker_config: { type: 'object', additionalProperties: true },
      time_limit_sec: { type: 'integer', nullable: true, minimum: 1, maximum: 60 },
      memory_limit_mb: { type: 'integer', nullable: true, minimum: 64, maximum: 2048 },
      ...Object.fromEntries(
        LANGUAGES.map((l) => [`starter_code_${l}`, { type: 'string' }])
      ),
    },
  },

  TestCase: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      input: { type: 'string' },
      expected_output: { type: 'string' },
      is_sample: {
        type: 'boolean',
        description: 'Non-sample cases are never returned to a student.',
      },
    },
  },

  Exam: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      course_id: { type: 'integer' },
      title: { type: 'string' },
      description: { type: 'string' },
      start_time: { type: 'string', format: 'date-time' },
      end_time: { type: 'string', format: 'date-time' },
      duration_minutes: { type: 'integer' },
      problems_per_student: {
        type: 'integer',
        nullable: true,
        description: 'When set, each student is dealt this many problems at random from the pool.',
      },
    },
  },

  Submission: {
    type: 'object',
    properties: {
      id: { type: 'integer' },
      problem_id: { type: 'integer' },
      exam_id: { type: 'integer', nullable: true },
      language: { type: 'string', enum: LANGUAGES },
      status: { type: 'string', enum: ['queued', 'running', 'completed', 'error'] },
      verdict: { type: 'string', enum: VERDICTS, nullable: true },
      passed_count: { type: 'integer' },
      total_count: { type: 'integer' },
      submitted_at: { type: 'string', format: 'date-time' },
    },
  },

  ExecutionResult: {
    type: 'object',
    description: 'One run of the code against free-form stdin. Nothing is stored.',
    properties: {
      stdout: { type: 'string' },
      stderr: { type: 'string' },
      exitCode: { type: 'integer' },
      executionTimeMs: { type: 'integer' },
      timedOut: { type: 'boolean' },
      compileError: { type: 'string', nullable: true },
    },
  },
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const paths = {
  '/api/health': {
    get: {
      tags: ['Operations'],
      summary: 'Liveness probe',
      security: [],
      responses: {
        200: ok('The service is up', {
          type: 'object',
          properties: {
            status: { type: 'string' },
            service: { type: 'string' },
            time: { type: 'string', format: 'date-time' },
          },
        }),
      },
    },
  },

  '/metrics': {
    get: {
      tags: ['Operations'],
      summary: 'Prometheus scrape endpoint',
      description:
        'Disabled entirely when METRICS_TOKEN is unset — a 404, not an open endpoint. Otherwise requires `Authorization: Bearer <METRICS_TOKEN>`, which is not the user JWT.',
      security: bearer,
      responses: {
        200: {
          description: 'Metrics in Prometheus text exposition format',
          content: { 'text/plain': { schema: { type: 'string' } } },
        },
        401: { $ref: '#/components/responses/Unauthorized' },
        404: { description: 'No METRICS_TOKEN is configured, so the endpoint does not exist' },
      },
    },
  },

  '/api/openapi.json': {
    get: {
      tags: ['Operations'],
      summary: 'This document',
      security: [],
      responses: { 200: ok('The OpenAPI description of this API', { type: 'object' }) },
    },
  },

  // --- Authentication -----------------------------------------------------
  '/api/auth/register': {
    post: {
      tags: ['Authentication'],
      summary: 'Create an account',
      description:
        'The role is decided by the server. An account is a student unless the request carries the configured teacher invite code; a `role` field in the body is ignored.',
      security: [],
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name: { type: 'string', maxLength: 150 },
            email: { type: 'string', format: 'email', maxLength: 150 },
            password: { type: 'string', minLength: 6, maxLength: 200 },
            inviteCode: { type: 'string', description: 'Grants the teacher role when it matches.' },
          },
        }),
      },
      responses: {
        201: ok('Account created and signed in', { $ref: '#/components/schemas/AuthResult' }),
        400: { $ref: '#/components/responses/BadRequest' },
        409: ok('That address already has an account', errorSchema),
        429: { $ref: '#/components/responses/RateLimited' },
      },
    },
  },

  '/api/auth/login': {
    post: {
      tags: ['Authentication'],
      summary: 'Sign in',
      security: [],
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' },
          },
        }),
      },
      responses: {
        200: ok('Signed in', { $ref: '#/components/schemas/AuthResult' }),
        401: ok('Wrong address or password — the two are not distinguished', errorSchema),
        429: { $ref: '#/components/responses/RateLimited' },
      },
    },
  },

  '/api/auth/me': {
    get: {
      tags: ['Authentication'],
      summary: 'The signed-in user',
      security: bearer,
      responses: {
        200: ok('The caller', {
          type: 'object',
          properties: { user: { $ref: '#/components/schemas/User' } },
        }),
        ...authErrors,
      },
    },
  },

  '/api/auth/registration-options': {
    get: {
      tags: ['Authentication'],
      summary: 'Whether this server accepts a teacher invite code',
      description: 'Lets the sign-up form hide the invite field when no code is configured.',
      security: [],
      responses: {
        200: ok('Registration options', {
          type: 'object',
          properties: { teacherRegistrationEnabled: { type: 'boolean' } },
        }),
      },
    },
  },

  '/api/auth/forgot-password': {
    post: {
      tags: ['Authentication'],
      summary: 'Request a password reset link',
      description:
        'Answers identically whether or not the address exists, including on internal failure. Anything else would make this an endpoint for testing who has an account.',
      security: [],
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['email'],
          properties: { email: { type: 'string', format: 'email' } },
        }),
      },
      responses: {
        200: ok('Always the same message', {
          type: 'object',
          properties: { message: { type: 'string' } },
        }),
        429: { $ref: '#/components/responses/RateLimited' },
      },
    },
  },

  '/api/auth/reset-password': {
    post: {
      tags: ['Authentication'],
      summary: 'Redeem a reset token',
      description:
        'The token is single-use: redeeming it is one UPDATE ... RETURNING that both checks and consumes it, so a forwarded link cannot be replayed and two simultaneous requests cannot both succeed.',
      security: [],
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['token', 'password'],
          properties: {
            token: { type: 'string' },
            password: { type: 'string', minLength: 6 },
          },
        }),
      },
      responses: {
        200: ok('Password changed', { type: 'object', properties: { success: { type: 'boolean' } } }),
        400: ok('The link is invalid, expired or already used', errorSchema),
        429: { $ref: '#/components/responses/RateLimited' },
      },
    },
  },

  '/api/auth/verify-email': {
    post: {
      tags: ['Authentication'],
      summary: 'Confirm an email address',
      security: [],
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['token'],
          properties: { token: { type: 'string' } },
        }),
      },
      responses: {
        200: ok('Address confirmed', { type: 'object', properties: { success: { type: 'boolean' } } }),
        400: ok('The link is invalid or expired', errorSchema),
      },
    },
  },

  '/api/auth/resend-verification': {
    post: {
      tags: ['Authentication'],
      summary: 'Send the confirmation email again',
      security: bearer,
      responses: {
        200: ok('Sent, or already confirmed', {
          type: 'object',
          properties: { sent: { type: 'boolean' }, alreadyVerified: { type: 'boolean' } },
        }),
        ...authErrors,
      },
    },
  },

  // --- Courses ------------------------------------------------------------
  '/api/courses': {
    get: {
      tags: ['Courses'],
      summary: 'Courses the caller can see',
      description: 'Teachers see the courses they created; students see the ones they joined.',
      security: bearer,
      responses: {
        200: ok('Courses', {
          type: 'object',
          properties: {
            courses: { type: 'array', items: { $ref: '#/components/schemas/Course' } },
          },
        }),
        ...authErrors,
      },
    },
    post: {
      tags: ['Courses'],
      summary: 'Create a course',
      security: bearer,
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', maxLength: 200 },
            description: { type: 'string', maxLength: 5000 },
            term: { type: 'string', maxLength: 50 },
          },
        }),
      },
      responses: {
        201: ok('Created, with its join code', {
          type: 'object',
          properties: { course: { $ref: '#/components/schemas/Course' } },
        }),
        400: { $ref: '#/components/responses/BadRequest' },
        403: { $ref: '#/components/responses/Forbidden' },
        ...authErrors,
      },
    },
  },

  '/api/courses/{id}': {
    get: {
      tags: ['Courses'],
      summary: 'One course',
      security: bearer,
      parameters: [idParam()],
      responses: {
        200: ok('The course', {
          type: 'object',
          properties: { course: { $ref: '#/components/schemas/Course' } },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
    put: {
      tags: ['Courses'],
      summary: 'Update a course, including archiving it',
      description: 'Archiving stops new enrolments. Existing content and roster are untouched.',
      security: bearer,
      parameters: [idParam()],
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          properties: {
            title: { type: 'string', maxLength: 200 },
            description: { type: 'string', maxLength: 5000 },
            term: { type: 'string', maxLength: 50 },
            archived: { type: 'boolean' },
          },
        }),
      },
      responses: {
        200: ok('Updated', {
          type: 'object',
          properties: { course: { $ref: '#/components/schemas/Course' } },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/courses/join': {
    post: {
      tags: ['Courses'],
      summary: 'Enrol with a join code',
      security: bearer,
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['joinCode'],
          properties: { joinCode: { type: 'string', maxLength: 16 } },
        }),
      },
      responses: {
        201: ok('Enrolled', {
          type: 'object',
          properties: { course: { $ref: '#/components/schemas/Course' } },
        }),
        400: ok('You already teach this course', errorSchema),
        403: ok('The course is archived and is not accepting new students', errorSchema),
        404: ok('No course has that code', errorSchema),
        ...authErrors,
      },
    },
  },

  '/api/courses/{id}/roster': {
    get: {
      tags: ['Courses'],
      summary: 'Who is enrolled',
      security: bearer,
      parameters: [idParam()],
      responses: {
        200: ok('The roster', {
          type: 'object',
          properties: {
            students: {
              type: 'array',
              items: {
                allOf: [
                  { $ref: '#/components/schemas/User' },
                  { type: 'object', properties: { submission_count: { type: 'integer' } } },
                ],
              },
            },
          },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/courses/{id}/roster/{userId}': {
    delete: {
      tags: ['Courses'],
      summary: 'Unenrol a student',
      security: bearer,
      parameters: [idParam('id', 'Course id'), idParam('userId', 'Student id')],
      responses: {
        200: ok('Removed', { type: 'object', properties: { success: { type: 'boolean' } } }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/courses/{id}/regenerate-code': {
    post: {
      tags: ['Courses'],
      summary: 'Issue a new join code',
      description: 'The previous code stops working immediately.',
      security: bearer,
      parameters: [idParam()],
      responses: {
        200: ok('The new code', {
          type: 'object',
          properties: { joinCode: { type: 'string' } },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  // --- Problems -----------------------------------------------------------
  '/api/problems': {
    get: {
      tags: ['Problems'],
      summary: 'Problems the caller can reach',
      security: bearer,
      parameters: [
        {
          name: 'course_id',
          in: 'query',
          required: false,
          schema: { type: 'integer' },
          description: 'Narrow to one course.',
        },
      ],
      responses: {
        200: ok('Problems', {
          type: 'object',
          properties: {
            problems: { type: 'array', items: { $ref: '#/components/schemas/Problem' } },
          },
        }),
        ...authErrors,
      },
    },
    post: {
      tags: ['Problems'],
      summary: 'Create a problem with its test cases',
      security: bearer,
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['course_id', 'title', 'description', 'testCases'],
          properties: {
            course_id: { type: 'integer' },
            title: { type: 'string', maxLength: 200 },
            description: { type: 'string' },
            difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
            checker: { type: 'string', enum: CHECKERS },
            checker_config: { type: 'object', additionalProperties: true },
            time_limit_sec: { type: 'integer', nullable: true, minimum: 1, maximum: 60 },
            memory_limit_mb: { type: 'integer', nullable: true, minimum: 64, maximum: 2048 },
            testCases: {
              type: 'array',
              minItems: 1,
              items: { $ref: '#/components/schemas/TestCase' },
            },
            ...Object.fromEntries(LANGUAGES.map((l) => [`starter_code_${l}`, { type: 'string' }])),
          },
        }),
      },
      responses: {
        201: ok('Created', {
          type: 'object',
          properties: { problem: { $ref: '#/components/schemas/Problem' } },
        }),
        400: { $ref: '#/components/responses/BadRequest' },
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/problems/{id}': {
    get: {
      tags: ['Problems'],
      summary: 'One problem, with the test cases the caller may see',
      description:
        'Students receive sample test cases only, and receive nothing at all for a problem whose exams have not started.',
      security: bearer,
      parameters: [idParam()],
      responses: {
        200: ok('The problem', {
          type: 'object',
          properties: {
            problem: { $ref: '#/components/schemas/Problem' },
            testCases: { type: 'array', items: { $ref: '#/components/schemas/TestCase' } },
          },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
    put: {
      tags: ['Problems'],
      summary: 'Replace a problem',
      description:
        'Every column named here is replaced, so send the whole object — a partial body blanks what it omits. Test cases are not touched; they have their own endpoints.',
      security: bearer,
      parameters: [idParam()],
      requestBody: {
        required: true,
        ...json({ $ref: '#/components/schemas/Problem' }),
      },
      responses: {
        200: ok('Updated', {
          type: 'object',
          properties: { problem: { $ref: '#/components/schemas/Problem' } },
        }),
        400: { $ref: '#/components/responses/BadRequest' },
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
    delete: {
      tags: ['Problems'],
      summary: 'Delete a problem and its submissions',
      security: bearer,
      parameters: [idParam()],
      responses: {
        200: ok('Deleted', { type: 'object', properties: { success: { type: 'boolean' } } }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/problems/{id}/testcases': {
    post: {
      tags: ['Problems'],
      summary: 'Add a test case',
      security: bearer,
      parameters: [idParam()],
      requestBody: {
        required: true,
        ...json({ $ref: '#/components/schemas/TestCase' }),
      },
      responses: {
        201: ok('Added', {
          type: 'object',
          properties: { testCase: { $ref: '#/components/schemas/TestCase' } },
        }),
        400: { $ref: '#/components/responses/BadRequest' },
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/problems/{id}/testcases/{tcId}': {
    delete: {
      tags: ['Problems'],
      summary: 'Remove a test case',
      security: bearer,
      parameters: [idParam('id', 'Problem id'), idParam('tcId', 'Test case id')],
      responses: {
        200: ok('Removed', { type: 'object', properties: { success: { type: 'boolean' } } }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  // --- Submissions --------------------------------------------------------
  '/api/submissions': {
    post: {
      tags: ['Submissions'],
      summary: 'Submit for grading',
      description:
        'Returns 202 immediately; grading happens in a worker. The result arrives over the WebSocket, or by polling GET /api/submissions/{id}.',
      security: bearer,
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['problem_id', 'language', 'code'],
          properties: {
            problem_id: { type: 'integer' },
            exam_id: { type: 'integer', nullable: true },
            language: { type: 'string', enum: LANGUAGES },
            code: { type: 'string', maxLength: 100000 },
          },
        }),
      },
      responses: {
        202: ok('Queued for grading', {
          type: 'object',
          properties: {
            submission: { $ref: '#/components/schemas/Submission' },
            status: { type: 'string' },
          },
        }),
        400: ok('The problem has no test cases', errorSchema),
        403: ok('The exam window is closed, or this problem is not on your paper', errorSchema),
        404: { $ref: '#/components/responses/NotFound' },
        503: ok('The queue is unreachable; the submission was not accepted', errorSchema),
        ...authErrors,
      },
    },
  },

  '/api/submissions/execute': {
    post: {
      tags: ['Submissions'],
      summary: 'Run code once against free-form input',
      description: 'The "Run" button. Nothing is stored and nothing is graded.',
      security: bearer,
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['language', 'code'],
          properties: {
            language: { type: 'string', enum: LANGUAGES },
            code: { type: 'string', maxLength: 100000 },
            stdin: { type: 'string', maxLength: 100000 },
          },
        }),
      },
      responses: {
        200: ok('The run', { $ref: '#/components/schemas/ExecutionResult' }),
        400: { $ref: '#/components/responses/BadRequest' },
        ...authErrors,
      },
    },
  },

  '/api/submissions/my': {
    get: {
      tags: ['Submissions'],
      summary: 'The caller’s own submissions',
      security: bearer,
      responses: {
        200: ok('Up to the last 100, newest first', {
          type: 'object',
          properties: {
            submissions: { type: 'array', items: { $ref: '#/components/schemas/Submission' } },
          },
        }),
        ...authErrors,
      },
    },
  },

  '/api/submissions/problem/{id}': {
    get: {
      tags: ['Submissions'],
      summary: 'Every submission for one problem',
      security: bearer,
      parameters: [idParam('id', 'Problem id')],
      responses: {
        200: ok('Submissions', {
          type: 'object',
          properties: {
            submissions: { type: 'array', items: { $ref: '#/components/schemas/Submission' } },
          },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/submissions/{id}': {
    get: {
      tags: ['Submissions'],
      summary: 'Poll one submission',
      description:
        'The fallback for a client that missed the WebSocket push. Output of non-sample test cases is withheld from students.',
      security: bearer,
      parameters: [idParam()],
      responses: {
        200: ok('The submission and its result so far', {
          type: 'object',
          properties: {
            submission: { $ref: '#/components/schemas/Submission' },
            status: { type: 'string' },
            passedCount: { type: 'integer' },
            totalCount: { type: 'integer' },
            results: { type: 'array', items: { type: 'object', additionalProperties: true } },
            compileError: { type: 'string', nullable: true },
          },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  // --- Drafts -------------------------------------------------------------
  '/api/drafts': {
    get: {
      tags: ['Drafts'],
      summary: 'Restore unsubmitted work',
      description: 'A draft is private to the person who wrote it. No role can read another’s.',
      security: bearer,
      parameters: [
        { name: 'problem_id', in: 'query', required: true, schema: { type: 'integer' } },
        { name: 'exam_id', in: 'query', required: false, schema: { type: 'integer' } },
      ],
      responses: {
        200: ok('The draft, or null', {
          type: 'object',
          properties: {
            draft: {
              nullable: true,
              type: 'object',
              properties: {
                language: { type: 'string', enum: LANGUAGES },
                code: { type: 'string' },
                updated_at: { type: 'string', format: 'date-time' },
              },
            },
          },
        }),
        400: { $ref: '#/components/responses/BadRequest' },
        ...authErrors,
      },
    },
    put: {
      tags: ['Drafts'],
      summary: 'Save work in progress',
      security: bearer,
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['problem_id', 'language', 'code'],
          properties: {
            problem_id: { type: 'integer' },
            exam_id: { type: 'integer', nullable: true },
            language: { type: 'string', enum: LANGUAGES },
            code: { type: 'string', maxLength: 100000 },
          },
        }),
      },
      responses: {
        200: ok('Saved', {
          type: 'object',
          properties: {
            saved: { type: 'boolean' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
    delete: {
      tags: ['Drafts'],
      summary: 'Discard a draft',
      security: bearer,
      parameters: [
        { name: 'problem_id', in: 'query', required: true, schema: { type: 'integer' } },
        { name: 'exam_id', in: 'query', required: false, schema: { type: 'integer' } },
      ],
      responses: {
        200: ok('Discarded', { type: 'object', properties: { success: { type: 'boolean' } } }),
        ...authErrors,
      },
    },
  },

  // --- Exams --------------------------------------------------------------
  '/api/exams': {
    get: {
      tags: ['Exams'],
      summary: 'Exams the caller can see',
      security: bearer,
      responses: {
        200: ok('Exams', {
          type: 'object',
          properties: { exams: { type: 'array', items: { $ref: '#/components/schemas/Exam' } } },
        }),
        ...authErrors,
      },
    },
    post: {
      tags: ['Exams'],
      summary: 'Schedule an exam',
      description:
        'Every problem must belong to the same course as the exam. `problem_ids` is ordered: position N in the array is question N on the paper. Points are hand-set through `points` when supplied and otherwise divided evenly to total 100.',
      security: bearer,
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['course_id', 'title', 'start_time', 'end_time', 'duration_minutes', 'problem_ids'],
          properties: {
            course_id: { type: 'integer' },
            title: { type: 'string', maxLength: 200 },
            description: { type: 'string' },
            start_time: { type: 'string', format: 'date-time' },
            end_time: { type: 'string', format: 'date-time' },
            duration_minutes: { type: 'integer', minimum: 1 },
            problem_ids: {
              type: 'array',
              minItems: 1,
              items: { type: 'integer' },
              description: 'Ordered. The array order is the order of the paper.',
            },
            points: {
              type: 'array',
              items: { type: 'integer', minimum: 0, maximum: 1000 },
              description:
                'Parallel to problem_ids. Omit for the even split; supplying a partial list is a 400.',
            },
            problems_per_student: {
              type: 'integer',
              nullable: true,
              description: 'Ignored unless it is smaller than the number of problems.',
            },
            late_window_minutes: {
              type: 'integer',
              minimum: 0,
              maximum: 1440,
              default: 0,
              description:
                'Minutes past the student’s effective deadline during which a submission is still accepted, flagged late. 0 refuses everything after the deadline, which is the behaviour before v2.1.0.',
            },
            late_penalty_percent: {
              type: 'integer',
              minimum: 0,
              maximum: 100,
              default: 0,
              description: 'Deducted from the automatic score of a submission accepted late.',
            },
            user_ids: {
              type: 'array',
              items: { type: 'integer' },
              description:
                'Who sits this exam. Omit or leave empty and the whole course sits it. Everyone named must already be enrolled in the course.',
            },
          },
        }),
      },
      responses: {
        201: ok('Scheduled', {
          type: 'object',
          properties: { exam: { $ref: '#/components/schemas/Exam' } },
        }),
        400: { $ref: '#/components/responses/BadRequest' },
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/exams/{id}': {
    get: {
      tags: ['Exams'],
      summary: 'One exam and the caller’s paper',
      description:
        'Before the exam starts, a student receives the exam but an empty problem list, and no random deal is recorded. Teachers always see the whole pool. Problems come back in the teacher’s order. A student who is not on the exam’s roster gets 404, the same answer as an exam in another course.',
      security: bearer,
      parameters: [idParam()],
      responses: {
        200: ok('The exam', {
          type: 'object',
          properties: {
            exam: { $ref: '#/components/schemas/Exam' },
            problems: { type: 'array', items: { $ref: '#/components/schemas/Problem' } },
            myProgress: { type: 'array', items: { type: 'object', additionalProperties: true } },
            endsAt: {
              type: 'string',
              format: 'date-time',
              nullable: true,
              description: 'The caller’s own deadline, including any granted extra time.',
            },
          },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
    put: {
      tags: ['Exams'],
      summary: 'Edit an exam',
      description:
        'The owning teacher only. The paper is replaced wholesale rather than merged, so send the full ordered `problem_ids`. Deals held by students for problems no longer on the paper are discarded.',
      security: bearer,
      parameters: [idParam()],
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['title', 'start_time', 'end_time', 'duration_minutes', 'problem_ids'],
          properties: {
            title: { type: 'string', maxLength: 200 },
            description: { type: 'string' },
            start_time: { type: 'string', format: 'date-time' },
            end_time: { type: 'string', format: 'date-time' },
            duration_minutes: { type: 'integer', minimum: 1 },
            problem_ids: { type: 'array', minItems: 1, items: { type: 'integer' } },
            points: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 1000 } },
            problems_per_student: { type: 'integer', nullable: true },
            late_window_minutes: { type: 'integer', minimum: 0, maximum: 1440 },
            late_penalty_percent: { type: 'integer', minimum: 0, maximum: 100 },
          },
        }),
      },
      responses: {
        200: ok('Updated', {
          type: 'object',
          properties: { exam: { $ref: '#/components/schemas/Exam' } },
        }),
        400: { $ref: '#/components/responses/BadRequest' },
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/exams/{id}/roster': {
    get: {
      tags: ['Exams'],
      summary: 'Who sits this exam',
      description:
        'The owning teacher only. An empty roster is not "nobody" but "the whole course", which is what `whole_course` distinguishes.',
      security: bearer,
      parameters: [idParam()],
      responses: {
        200: ok('The roster', {
          type: 'object',
          properties: {
            roster: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  user_id: { type: 'integer' },
                  name: { type: 'string' },
                  email: { type: 'string' },
                  added_at: { type: 'string', format: 'date-time' },
                },
              },
            },
            whole_course: { type: 'boolean' },
          },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
    put: {
      tags: ['Exams'],
      summary: 'Set who sits this exam',
      description:
        'The owning teacher only. Replaces the whole roster; an empty list hands the exam back to the entire course. Everyone named must be a student already enrolled in the course, so a roster cannot be used as a second enrolment path. Students removed from the roster lose any randomised deal they were holding.',
      security: bearer,
      parameters: [idParam()],
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['user_ids'],
          properties: { user_ids: { type: 'array', items: { type: 'integer' } } },
        }),
      },
      responses: {
        200: ok('Saved', {
          type: 'object',
          properties: {
            roster: { type: 'array', items: { type: 'integer' } },
            whole_course: { type: 'boolean' },
          },
        }),
        400: { $ref: '#/components/responses/BadRequest' },
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/exams/{id}/results': {
    get: {
      tags: ['Exams'],
      summary: 'Results, with any manual override applied',
      security: bearer,
      parameters: [idParam()],
      responses: {
        200: ok('One row per student per problem', {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  user_id: { type: 'integer' },
                  name: { type: 'string' },
                  email: { type: 'string' },
                  problem_id: { type: 'integer' },
                  problem_title: { type: 'string' },
                  best_passed: { type: 'integer' },
                  total_count: { type: 'integer' },
                  final_score: { type: 'integer' },
                  final_max: { type: 'integer' },
                  is_overridden: { type: 'boolean' },
                },
              },
            },
          },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/exams/{id}/accommodations': {
    get: {
      tags: ['Exams'],
      summary: 'Who has extra time on this exam',
      security: bearer,
      parameters: [idParam()],
      responses: {
        200: ok('Accommodations', {
          type: 'object',
          properties: {
            accommodations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  user_id: { type: 'integer' },
                  name: { type: 'string' },
                  email: { type: 'string' },
                  extra_minutes: { type: 'integer' },
                  note: { type: 'string' },
                },
              },
            },
          },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/exams/{id}/accommodations/{userId}': {
    put: {
      tags: ['Exams'],
      summary: 'Grant or change extra time',
      description:
        'Minutes added to this student’s deadline for this exam. 0 removes the grant. The countdown, the submission window and the integrity logging all follow the extended deadline.',
      security: bearer,
      parameters: [idParam('id', 'Exam id'), idParam('userId', 'Student id')],
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['extra_minutes'],
          properties: {
            extra_minutes: { type: 'integer', minimum: 0, maximum: 1440 },
            note: { type: 'string', maxLength: 500 },
          },
        }),
      },
      responses: {
        200: ok('Granted, changed, or removed', {
          type: 'object',
          properties: {
            accommodation: { type: 'object', additionalProperties: true },
            removed: { type: 'boolean' },
          },
        }),
        400: { $ref: '#/components/responses/BadRequest' },
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/exams/{id}/grades/{userId}/{problemId}': {
    put: {
      tags: ['Exams'],
      summary: 'Override the automatic grade',
      description: 'The automatic result is kept and still returned alongside the override.',
      security: bearer,
      parameters: [
        idParam('id', 'Exam id'),
        idParam('userId', 'Student id'),
        idParam('problemId', 'Problem id'),
      ],
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['score', 'max_score'],
          properties: {
            score: { type: 'integer', minimum: 0 },
            max_score: { type: 'integer', minimum: 1 },
            feedback: { type: 'string', maxLength: 2000 },
          },
        }),
      },
      responses: {
        200: ok('Saved', {
          type: 'object',
          properties: { override: { type: 'object', additionalProperties: true } },
        }),
        400: ok('The score exceeds the maximum', errorSchema),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
    delete: {
      tags: ['Exams'],
      summary: 'Fall back to the automatic grade',
      security: bearer,
      parameters: [
        idParam('id', 'Exam id'),
        idParam('userId', 'Student id'),
        idParam('problemId', 'Problem id'),
      ],
      responses: {
        200: ok('Removed', { type: 'object', properties: { success: { type: 'boolean' } } }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/exams/{id}/assignments': {
    get: {
      tags: ['Exams'],
      summary: 'Who was dealt which problems',
      description: 'For auditing a randomised exam when a student questions their paper.',
      security: bearer,
      parameters: [idParam()],
      responses: {
        200: ok('Assignments', {
          type: 'object',
          properties: {
            assignments: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  user_id: { type: 'integer' },
                  name: { type: 'string' },
                  email: { type: 'string' },
                  problems: { type: 'array', items: { type: 'string' } },
                  problem_ids: { type: 'array', items: { type: 'integer' } },
                },
              },
            },
          },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  // --- Academic integrity -------------------------------------------------
  '/api/integrity/events': {
    post: {
      tags: ['Integrity'],
      summary: 'Report a client-side integrity event',
      description:
        'Tab switches, pastes and fullscreen exits during an exam. Outside the window the event is accepted and discarded (204) rather than logged.',
      security: bearer,
      requestBody: {
        required: true,
        ...json({
          type: 'object',
          required: ['exam_id', 'event_type'],
          properties: {
            exam_id: { type: 'integer' },
            problem_id: { type: 'integer', nullable: true },
            event_type: { type: 'string', enum: ['tab_hidden', 'paste', 'fullscreen_exit'] },
            detail: { type: 'string', maxLength: 1000, nullable: true },
          },
        }),
      },
      responses: {
        201: ok('Logged', { type: 'object', properties: { success: { type: 'boolean' } } }),
        204: { description: 'Outside the exam window; nothing logged' },
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/integrity/exam/{id}': {
    get: {
      tags: ['Integrity'],
      summary: 'Per-student integrity summary for an exam',
      security: bearer,
      parameters: [idParam('id', 'Exam id')],
      responses: {
        200: ok('Counts per student', {
          type: 'object',
          properties: {
            summary: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  user_id: { type: 'integer' },
                  name: { type: 'string' },
                  tab_hidden_count: { type: 'integer' },
                  paste_count: { type: 'integer' },
                  fullscreen_exit_count: { type: 'integer' },
                },
              },
            },
          },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/integrity/problem/{id}/similarity': {
    get: {
      tags: ['Integrity'],
      summary: 'Pairwise similarity across the class',
      description:
        'A screening tool, not a verdict. Pairs are flagged relative to the class’s own baseline, because a short exercise has few reasonable solutions and a uniformly high score means nothing.',
      security: bearer,
      parameters: [idParam('id', 'Problem id')],
      responses: {
        200: ok('One group per language', {
          type: 'object',
          properties: {
            groups: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  language: { type: 'string', enum: LANGUAGES },
                  submissionCount: { type: 'integer' },
                  baseline: { type: 'number' },
                  pairs: { type: 'array', items: { type: 'object', additionalProperties: true } },
                },
              },
            },
          },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/integrity/compare/{idA}/{idB}': {
    get: {
      tags: ['Integrity'],
      summary: 'Two submissions side by side, with matching spans marked',
      security: bearer,
      parameters: [idParam('idA', 'First submission id'), idParam('idB', 'Second submission id')],
      responses: {
        200: ok('The comparison', {
          type: 'object',
          properties: {
            similarity: { type: 'number' },
            submissionA: { type: 'object', additionalProperties: true },
            submissionB: { type: 'object', additionalProperties: true },
          },
        }),
        400: ok('Different problems or different languages', errorSchema),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/integrity/archive': {
    get: {
      tags: ['Integrity'],
      summary: 'Cohorts kept for screening',
      security: bearer,
      responses: {
        200: ok('One row per archived cohort', {
          type: 'object',
          properties: {
            archives: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  source_label: { type: 'string' },
                  submissions: { type: 'integer' },
                  problems: { type: 'integer' },
                  archived_at: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        }),
        ...authErrors,
      },
    },
  },

  '/api/integrity/archive/course/{id}': {
    post: {
      tags: ['Integrity'],
      summary: 'Archive a finished course for future screening',
      description:
        'Copies the latest submission per student, problem and language into the caller’s private archive. Never shown to students.',
      security: bearer,
      parameters: [idParam('id', 'Course id')],
      requestBody: {
        required: false,
        ...json({
          type: 'object',
          properties: { source_label: { type: 'string', maxLength: 200 } },
        }),
      },
      responses: {
        201: ok('Archived', {
          type: 'object',
          properties: { archived: { type: 'integer' }, sourceLabel: { type: 'string' } },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/integrity/archive/{label}': {
    delete: {
      tags: ['Integrity'],
      summary: 'Drop one archived cohort',
      security: bearer,
      parameters: [
        {
          name: 'label',
          in: 'path',
          required: true,
          schema: { type: 'string' },
          description: 'The cohort’s source label, URL-encoded.',
        },
      ],
      responses: {
        200: ok('Deleted', { type: 'object', properties: { deleted: { type: 'integer' } } }),
        ...authErrors,
      },
    },
  },

  '/api/integrity/problem/{id}/archive-matches': {
    get: {
      tags: ['Integrity'],
      summary: 'Screen this problem against previous cohorts',
      description:
        'Requires the shared part to be a large fraction of *both* submissions, and uses a fixed high threshold: the archive spans different cohorts and problems, so there is no class baseline to calibrate against.',
      security: bearer,
      parameters: [idParam('id', 'Problem id')],
      responses: {
        200: ok('Matches above the threshold', {
          type: 'object',
          properties: {
            matches: { type: 'array', items: { type: 'object', additionalProperties: true } },
            archiveSize: { type: 'integer' },
            threshold: { type: 'number' },
          },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  // --- People and analytics -----------------------------------------------
  '/api/users/students': {
    get: {
      tags: ['People'],
      summary: 'Students in the caller’s own courses',
      description: 'Counts cover work in the caller’s courses only.',
      security: bearer,
      responses: {
        200: ok('Students with summary counts', {
          type: 'object',
          properties: {
            students: {
              type: 'array',
              items: {
                allOf: [
                  { $ref: '#/components/schemas/User' },
                  {
                    type: 'object',
                    properties: {
                      submission_count: { type: 'integer' },
                      solved_count: { type: 'integer' },
                    },
                  },
                ],
              },
            },
          },
        }),
        403: { $ref: '#/components/responses/Forbidden' },
        ...authErrors,
      },
    },
  },

  '/api/users/students/{id}': {
    get: {
      tags: ['People'],
      summary: 'One student’s recent work in the caller’s courses',
      security: bearer,
      parameters: [idParam('id', 'Student id')],
      responses: {
        200: ok('The student and their submissions', {
          type: 'object',
          properties: {
            student: { $ref: '#/components/schemas/User' },
            submissions: { type: 'array', items: { $ref: '#/components/schemas/Submission' } },
          },
        }),
        404: { $ref: '#/components/responses/NotFound' },
        ...authErrors,
      },
    },
  },

  '/api/analytics/overview': {
    get: {
      tags: ['Analytics'],
      summary: 'Class-wide statistics for a teacher',
      security: bearer,
      responses: {
        200: ok('Totals and time series', {
          type: 'object',
          properties: {
            totals: { type: 'object', additionalProperties: true },
            dailySubmissions: { type: 'array', items: { type: 'object', additionalProperties: true } },
            languageDistribution: { type: 'array', items: { type: 'object', additionalProperties: true } },
            problemSuccessRates: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        }),
        403: { $ref: '#/components/responses/Forbidden' },
        ...authErrors,
      },
    },
  },

  '/api/analytics/me': {
    get: {
      tags: ['Analytics'],
      summary: 'The caller’s own progress',
      description: 'The denominator counts only problems the caller can currently reach.',
      security: bearer,
      responses: {
        200: ok('Personal totals and activity', {
          type: 'object',
          properties: {
            totals: { type: 'object', additionalProperties: true },
            dailyActivity: { type: 'array', items: { type: 'object', additionalProperties: true } },
            languageBreakdown: { type: 'array', items: { type: 'object', additionalProperties: true } },
            totalProblems: { type: 'integer' },
          },
        }),
        ...authErrors,
      },
    },
  },
};

// ---------------------------------------------------------------------------

const document = {
  openapi: '3.1.0',
  info: {
    title: 'Mihenk API',
    version,
    description:
      'Cloud-based coding education and examination.\n\n' +
      'All authenticated requests carry `Authorization: Bearer <token>` from ' +
      '/api/auth/login or /api/auth/register.\n\n' +
      'Two rules run through everything here and are worth reading once rather ' +
      'than in every endpoint. First, content is scoped by course: a teacher ' +
      'reaches the courses they created, a student the ones they joined, and ' +
      'anything outside that is a 404 rather than a 403, so the two are ' +
      'indistinguishable. Second, an exam paper is sealed until the exam ' +
      'starts — its problems are invisible to students beforehand, through ' +
      'reading and through submitting alike.',
    license: { name: 'See repository' },
  },
  servers: [{ url: '/', description: 'This deployment' }],
  tags: [
    { name: 'Authentication' },
    { name: 'Courses' },
    { name: 'Problems' },
    { name: 'Submissions' },
    { name: 'Drafts' },
    { name: 'Exams' },
    { name: 'Integrity' },
    { name: 'People' },
    { name: 'Analytics' },
    { name: 'Operations' },
  ],
  security: bearer,
  paths,
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas,
    responses: {
      BadRequest: ok('The request failed validation', errorSchema),
      Unauthorized: ok('Missing, invalid or expired token', errorSchema),
      Forbidden: ok('Authenticated, but not allowed to do this', errorSchema),
      NotFound: ok('No such object, or not visible to the caller', errorSchema),
      RateLimited: ok('Too many requests', errorSchema),
      ServerError: ok('Unexpected server error', errorSchema),
    },
  },
};

module.exports = { document };
