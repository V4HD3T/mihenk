/**
 * Test environment.
 *
 * These tests deliberately need NO PostgreSQL and NO Redis: they cover routing,
 * validation, security headers and rate limiting, all of which happen before a
 * handler ever reaches the database. That keeps `npm test` runnable on a laptop
 * and in CI without spinning up services.
 *
 * Anything that genuinely needs a live database belongs in a separate
 * integration suite (see the roadmap), not here.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-not-used-anywhere-real';
process.env.LOG_LEVEL = 'silent';
process.env.TEACHER_INVITE_CODE = 'test-invite-code';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';

// The integration suites exercise the real POST /api/submissions path, which
// enqueues a grading job. TEST_REDIS_* points them at a throwaway Redis; when
// none is running the enqueue fails fast (bounded by QUEUE_ENQUEUE_TIMEOUT_MS)
// and those specific assertions fail rather than hanging the run.
if (process.env.TEST_REDIS_HOST) process.env.REDIS_HOST = process.env.TEST_REDIS_HOST;
if (process.env.TEST_REDIS_PORT) process.env.REDIS_PORT = process.env.TEST_REDIS_PORT;
