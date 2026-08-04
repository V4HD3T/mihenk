/**
 * metrics.js
 *
 * Prometheus instrumentation, shared by the API and the workers.
 *
 * The questions this is meant to answer during an exam, when someone asks "is
 * it keeping up?": how deep is the grading backlog, how long is a submission
 * waiting, and are runs failing for infrastructure reasons rather than because
 * the code is wrong.
 *
 * Every process that exposes metrics sets a distinct `role` label, so a
 * scraper can tell the API apart from each worker without them overwriting
 * each other's series.
 */

const client = require('prom-client');

const register = new client.Registry();

function init(role) {
  register.setDefaultLabels({ role });
  // Event-loop lag, heap, GC, open handles: the first things to look at when
  // the app is slow but nothing is obviously broken.
  client.collectDefaultMetrics({ register, prefix: 'codecloud_' });
  return register;
}

const httpRequestDuration = new client.Histogram({
  name: 'codecloud_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'route', 'status'],
  // Tuned for an API where most calls are DB reads and the slow tail is code
  // execution, which is on its own much wider scale.
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const submissionsTotal = new client.Counter({
  name: 'codecloud_submissions_total',
  help: 'Submissions accepted for grading',
  labelNames: ['language'],
  registers: [register],
});

const gradingDuration = new client.Histogram({
  name: 'codecloud_grading_duration_seconds',
  help: 'Wall-clock time to grade one submission, from picking it up to writing the result',
  labelNames: ['language'],
  // Compiling Java or Go dominates the tail, so this runs well past the HTTP scale.
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60],
  registers: [register],
});

/**
 * How long a submission sat in the queue before a worker took it.
 *
 * This, not grading duration, is what a student actually experiences during a
 * rush - and it is the number the autoscaler is trying to keep down.
 */
const queueWaitDuration = new client.Histogram({
  name: 'codecloud_queue_wait_seconds',
  help: 'Time between a submission being enqueued and a worker starting it',
  buckets: [0.05, 0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [register],
});

const verdictsTotal = new client.Counter({
  name: 'codecloud_verdicts_total',
  help: 'Grading verdicts',
  labelNames: ['verdict', 'language'],
  registers: [register],
});

const gradingFailuresTotal = new client.Counter({
  name: 'codecloud_grading_failures_total',
  help: 'Grading jobs that threw rather than producing a verdict (an infrastructure failure, not a wrong answer)',
  registers: [register],
});

const enqueueFailuresTotal = new client.Counter({
  name: 'codecloud_enqueue_failures_total',
  help: 'Submissions that could not be queued, e.g. Redis unreachable',
  registers: [register],
});

const queueDepth = new client.Gauge({
  name: 'codecloud_queue_depth',
  help: 'Jobs in the grading queue by state',
  labelNames: ['state'],
  registers: [register],
});

const workerPoolSize = new client.Gauge({
  name: 'codecloud_worker_pool_size',
  help: 'Grading worker processes currently running',
  registers: [register],
});

const dbPool = new client.Gauge({
  name: 'codecloud_db_pool_connections',
  help: 'PostgreSQL pool connections by state',
  labelNames: ['state'],
  registers: [register],
});

/**
 * Express middleware recording every request.
 *
 * Uses `req.route.path` rather than `req.url` so that /api/problems/1 and
 * /api/problems/2 share one series instead of creating unbounded cardinality.
 */
function httpMiddleware(req, res, next) {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || 'unmatched';
    end({ method: req.method, route, status: res.statusCode });
  });
  next();
}

/** Refreshes the gauges that describe something's current state rather than an event. */
async function collectQueueDepth(queue) {
  try {
    const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed');
    for (const [state, value] of Object.entries(counts)) {
      queueDepth.set({ state }, value);
    }
  } catch {
    /* metrics must never break a request path */
  }
}

function collectDbPool(pool) {
  try {
    dbPool.set({ state: 'total' }, pool.totalCount ?? 0);
    dbPool.set({ state: 'idle' }, pool.idleCount ?? 0);
    dbPool.set({ state: 'waiting' }, pool.waitingCount ?? 0);
  } catch {
    /* as above */
  }
}

module.exports = {
  register,
  init,
  httpMiddleware,
  collectQueueDepth,
  collectDbPool,
  httpRequestDuration,
  submissionsTotal,
  gradingDuration,
  queueWaitDuration,
  verdictsTotal,
  gradingFailuresTotal,
  enqueueFailuresTotal,
  queueDepth,
  workerPoolSize,
  dbPool,
};
