/**
 * Validated environment configuration.
 *
 * The app reads its config from here instead of touching process.env directly,
 * so a missing or malformed variable fails loudly at startup with a list of
 * what's wrong - rather than surfacing later as a confusing runtime error
 * (e.g. jwt.sign throwing because JWT_SECRET was undefined).
 */

const { z } = require('zod');

const DEFAULT_JWT_SECRET = 'change-this-secret-before-deploying-to-production';

const numeric = (fallback) =>
  z.coerce.number().int().positive().default(fallback);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: numeric(4000),

  DB_HOST: z.string().min(1).default('localhost'),
  DB_PORT: numeric(5432),
  DB_NAME: z.string().min(1).default('codecloud'),
  DB_USER: z.string().min(1).default('postgres'),
  DB_PASSWORD: z.string().default('postgres'),

  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // When unset, teacher self-registration is disabled entirely (safe default).
  // When set, a client must supply this exact code to create a teacher account.
  TEACHER_INVITE_CODE: z.string().min(1).optional(),

  EXEC_TIME_LIMIT_SEC: numeric(5),
  // Compiling gets its own, larger budget: a templated C++ file can take longer
  // to compile than the problem's whole run budget.
  EXEC_COMPILE_TIME_LIMIT_SEC: numeric(30),
  EXEC_MEMORY_LIMIT_KB: numeric(524288),
  EXEC_MAX_OUTPUT_CHARS: numeric(100000),
  // Where per-run work directories are created. Must be left at the default
  // unless the worker itself runs in a container: the docker daemon resolves
  // bind-mount paths on the HOST, so a containerised worker needs this to be a
  // volume mounted at the identical path on both sides, or the sandbox silently
  // receives an empty directory.
  EXEC_WORK_DIR: z.string().optional(),

  // How submitted code is isolated:
  //   docker - every run happens in a throwaway, network-disconnected container
  //   host   - run directly on this machine (timeout + memory limits only)
  //   auto   - use docker when a working daemon is reachable, else host
  // 'auto' is convenient for development but must never be used to serve
  // untrusted users: it silently degrades to the weaker backend.
  SANDBOX_MODE: z.enum(['docker', 'host', 'auto']).default('auto'),
  SANDBOX_IMAGE_PREFIX: z.string().min(1).default('codecloud'),
  SANDBOX_MEMORY_MB: numeric(256),
  SANDBOX_JAVA_MEMORY_MB: numeric(384),
  SANDBOX_CPUS: z.coerce.number().positive().default(0.5),
  SANDBOX_PIDS_LIMIT: numeric(64),
  SANDBOX_TMPFS_MB: numeric(16),

  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: numeric(6379),
  WORKER_CONCURRENCY: numeric(4),

  // Autoscaling pool (npm run worker:pool). The default shape suits one
  // machine: idle at 1 worker, up to 8 during an exam rush.
  WORKER_POOL_MIN: numeric(1),
  WORKER_POOL_MAX: numeric(8),
  // Queued+active jobs one worker is expected to absorb before another is added.
  WORKER_POOL_BACKLOG_PER_WORKER: numeric(10),
  WORKER_POOL_INTERVAL_MS: numeric(5000),
  // Consecutive quiet ticks before shrinking, so a lull between two waves of
  // submissions doesn't cost the startup time of rebuilding the pool.
  WORKER_POOL_SCALE_DOWN_TICKS: numeric(6),
  // Where the grading side exposes /metrics. The pool aggregates its children
  // and serves one endpoint here; a worker started on its own serves its own.
  // Like the API's, it does not exist at all without METRICS_TOKEN.
  WORKER_METRICS_PORT: numeric(4001),
  // How long POST /api/submissions waits for Redis to accept a grading job
  // before giving up. Without a bound, a Redis outage hangs the request.
  QUEUE_ENQUEUE_TIMEOUT_MS: numeric(5000),

  // Comma-separated list of allowed browser origins. No wildcard default:
  // an unset value means "localhost dev only", never "any site on the web".
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),

  RATE_LIMIT_WINDOW_MIN: numeric(15),
  RATE_LIMIT_MAX: numeric(300),
  AUTH_RATE_LIMIT_MAX: numeric(10),
  EXEC_RATE_LIMIT_MAX: numeric(30),

  LOG_LEVEL: z.string().optional(),

  // Email. Without SMTP_HOST, development logs messages instead of sending
  // them (so a reset link is visible in the console) and production refuses to
  // start - silently not sending password resets is worse than failing loudly.
  MAIL_TRANSPORT: z.enum(['smtp', 'log', 'silent']).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: numeric(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().default('CodeCloud <no-reply@codecloud.local>'),

  // Where the links in those emails point. Same value as PUBLIC_ORIGIN in a
  // compose deployment.
  PUBLIC_URL: z.string().default('http://localhost:5173'),

  PASSWORD_RESET_TTL_MIN: numeric(60),
  EMAIL_VERIFICATION_TTL_HOURS: numeric(48),
  // Advisory by default: an unverified account still works, it is just flagged.
  // Turning this on blocks sign-in until the address is confirmed, which needs
  // working email first.
  REQUIRE_EMAIL_VERIFICATION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // GET /metrics is operational detail (queue depth, failure rates, host stats).
  // Unset = the endpoint is disabled entirely rather than public by default.
  METRICS_TOKEN: z.string().min(1).optional(),

  // Connection pools. The default pg pool of 10 is the ceiling on concurrent
  // requests that touch the database, so it needs to be at least as large as
  // the worker concurrency it serves.
  DB_POOL_MAX: numeric(20),
  DB_IDLE_TIMEOUT_MS: numeric(30000),
  DB_CONNECTION_TIMEOUT_MS: numeric(5000),
});

function loadEnv(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const env = parsed.data;

  // Shipping the example secret to production would make every JWT forgeable
  // by anyone who has read the repo, so refuse to start rather than warn.
  if (env.NODE_ENV === 'production' && env.JWT_SECRET === DEFAULT_JWT_SECRET) {
    throw new Error(
      'JWT_SECRET is still the placeholder value from .env.example. Set a real secret before running in production.'
    );
  }

  return {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    allowedOrigins: env.FRONTEND_ORIGIN.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}

// Loaded lazily and cached, so importing this module never explodes at import
// time - the failure surfaces on first real use (server/worker startup), and
// tests can exercise loadEnv() directly with their own fake environments.
let cached = null;
function config() {
  if (!cached) cached = loadEnv();
  return cached;
}

module.exports = { config, loadEnv, schema, DEFAULT_JWT_SECRET };
