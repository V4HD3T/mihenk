/**
 * workerPool.js
 *
 * Supervises grading worker processes and sizes the pool to the backlog.
 *
 *   npm run worker:pool
 *
 * The shape of the load this exists for: a course sits idle for weeks, then two
 * hundred students submit within the same ten minutes. Running enough workers
 * for the exam wastes a machine the rest of the term; running enough for the
 * quiet weeks means the exam queue takes far too long to drain.
 *
 * Each worker is a separate OS process running src/worker.js - the same process
 * you would start by hand, so nothing about grading changes. This only decides
 * how many of them exist. Workers on other machines pull from the same Redis
 * queue and are unaffected by this supervisor; it manages the pool on its own
 * host only.
 */

require('dotenv').config();
const { fork } = require('child_process');
const path = require('path');
const { Queue } = require('bullmq');
const client = require('prom-client');
const createConnection = require('./queue/redis');
const logger = require('./logger');
const metrics = require('./metrics');
const { startMetricsServer } = require('./metricsServer');
const { config } = require('./config/env');

const env = config();
const WORKER_SCRIPT = path.join(__dirname, 'worker.js');

/**
 * Decides the pool size for a given backlog.
 *
 * Pure, so the policy can be tested without spawning anything - the scaling
 * rule is the part worth getting right, and it is much easier to reason about
 * separated from process management.
 *
 * Scaling up is immediate and scaling down is delayed by the caller: a queue
 * that briefly empties between two waves of submissions shouldn't cost the
 * startup time of rebuilding the pool.
 */
function desiredWorkers(backlog, { min, max, perWorker }) {
  if (backlog <= 0) return min;
  const needed = Math.ceil(backlog / perWorker);
  return Math.min(max, Math.max(min, needed));
}

class WorkerPool {
  constructor(options = {}) {
    this.min = options.min ?? env.WORKER_POOL_MIN;
    this.max = options.max ?? env.WORKER_POOL_MAX;
    this.perWorker = options.perWorker ?? env.WORKER_POOL_BACKLOG_PER_WORKER;
    this.intervalMs = options.intervalMs ?? env.WORKER_POOL_INTERVAL_MS;
    this.scaleDownAfter = options.scaleDownAfter ?? env.WORKER_POOL_SCALE_DOWN_TICKS;

    this.workers = new Map(); // pid -> child process
    this.quietTicks = 0;
    this.stopping = false;
    this.queue = options.queue || new Queue('grading', { connection: createConnection() });
    this.nextRequestId = 1;
  }

  /**
   * This pool's own metrics, plus every child's.
   *
   * The grading counters live in the workers, so the supervisor asks each one
   * over IPC and merges the replies. A worker that does not answer within the
   * timeout is left out rather than failing the scrape - one wedged process
   * should cost one series, not the whole endpoint.
   */
  async collectMetrics(timeoutMs = 2000) {
    metrics.workerPoolSize.set(this.workers.size);

    const replies = await Promise.all(
      [...this.workers.values()].map(
        (child) =>
          new Promise((resolve) => {
            const id = this.nextRequestId++;
            const timer = setTimeout(() => {
              child.off('message', onMessage);
              resolve(null);
            }, timeoutMs);
            const onMessage = (message) => {
              if (message?.type !== 'metrics-response' || message.id !== id) return;
              clearTimeout(timer);
              child.off('message', onMessage);
              resolve(message.metrics);
            };
            child.on('message', onMessage);
            // The callback catches a closed channel, which `send` reports
            // asynchronously and a try/catch around it would miss.
            child.send({ type: 'metrics-request', id }, (err) => {
              if (!err) return;
              clearTimeout(timer);
              child.off('message', onMessage);
              resolve(null);
            });
          })
      )
    );

    const own = await metrics.register.getMetricsAsJSON();
    const registry = client.AggregatorRegistry.aggregate([own, ...replies.filter(Boolean)]);
    return registry.metrics();
  }

  spawnOne() {
    const child = fork(WORKER_SCRIPT, [], { env: process.env });
    this.workers.set(child.pid, child);

    child.on('exit', (code, signal) => {
      this.workers.delete(child.pid);
      if (this.stopping) return;
      // A worker that dies on its own (OOM, an unhandled rejection) is replaced,
      // otherwise the pool silently shrinks to nothing over a long term.
      logger.warn({ pid: child.pid, code, signal }, 'grading worker exited; replacing it');
      if (this.workers.size < this.min) this.spawnOne();
    });

    logger.info({ pid: child.pid, size: this.workers.size }, 'started grading worker');
    return child;
  }

  /** Stops one worker gracefully - it finishes the submission it is grading. */
  stopOne() {
    const [pid, child] = this.workers.entries().next().value || [];
    if (!child) return;
    this.workers.delete(pid);
    child.kill('SIGTERM');
    logger.info({ pid, size: this.workers.size }, 'stopping an idle grading worker');
  }

  async backlog() {
    const counts = await this.queue.getJobCounts('waiting', 'active');
    return (counts.waiting || 0) + (counts.active || 0);
  }

  async tick() {
    if (this.stopping) return;
    let backlog;
    try {
      backlog = await this.backlog();
    } catch (err) {
      // Redis being briefly unreachable is not a reason to tear down the pool.
      logger.error({ err }, 'could not read queue depth; leaving the pool as it is');
      return;
    }

    const target = desiredWorkers(backlog, {
      min: this.min,
      max: this.max,
      perWorker: this.perWorker,
    });
    const current = this.workers.size;

    if (target > current) {
      // Grow at once: the backlog is already waiting.
      for (let i = current; i < target; i++) this.spawnOne();
      this.quietTicks = 0;
      logger.info({ backlog, from: current, to: this.workers.size }, 'scaled up');
      return;
    }

    if (target < current) {
      // Shrink only after the backlog has stayed low for several ticks, so a
      // lull between two waves of submissions doesn't cost a rebuild.
      this.quietTicks++;
      if (this.quietTicks >= this.scaleDownAfter) {
        this.stopOne();
        this.quietTicks = 0;
        logger.info({ backlog, from: current, to: this.workers.size }, 'scaled down');
      }
      return;
    }
    this.quietTicks = 0;
  }

  async start() {
    for (let i = 0; i < this.min; i++) this.spawnOne();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    logger.info(
      { min: this.min, max: this.max, perWorker: this.perWorker },
      'grading worker pool started'
    );
  }

  async stop() {
    this.stopping = true;
    clearInterval(this.timer);
    // SIGTERM lets each worker finish the submission it is currently grading.
    for (const child of this.workers.values()) child.kill('SIGTERM');
    await this.queue.close().catch(() => {});
  }

  get size() {
    return this.workers.size;
  }
}

module.exports = { WorkerPool, desiredWorkers };

if (require.main === module) {
  metrics.init('worker-pool');
  const pool = new WorkerPool();
  pool.start();

  // One endpoint for the whole grading side. Without this, everything the
  // workers measure was written to a registry nobody could reach.
  startMetricsServer({
    port: env.WORKER_METRICS_PORT,
    collect: () => pool.collectMetrics(),
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`${signal} received, stopping the worker pool`);
    await pool.stop();
    // Give the workers their own graceful window before the supervisor exits.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
