/**
 * The grading side's metrics have to be reachable.
 *
 * Every counter the workers keep - grading duration, queue wait, verdicts,
 * grading failures - lived in a registry inside a forked process with no way to
 * read it, and `codecloud_worker_pool_size` was a gauge nothing ever wrote. The
 * dashboards built on those series would have drawn empty graphs, which reads
 * as "nothing is happening" rather than "this is not wired up".
 *
 * These tests use real forked children and a real HTTP request, because the
 * thing being checked is the IPC and the socket, and mocking either would only
 * test the mock.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { fork } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const CHILD = join(here, 'helpers', 'metricsChild.js');

let WorkerPool, startMetricsServer, metrics;

beforeAll(async () => {
  process.env.METRICS_TOKEN = 'worker-metrics-test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'worker-metrics-test';
  process.env.LOG_LEVEL = 'silent';
  ({ WorkerPool } = (await import('../src/workerPool.js')).default);
  ({ startMetricsServer } = (await import('../src/metricsServer.js')).default);
  metrics = (await import('../src/metrics.js')).default;
  metrics.init('worker-pool-test');
});

/** A pool with fake children that answer the metrics IPC, and no real queue. */
function poolWithChildren(count) {
  const pool = new WorkerPool({
    queue: { getJobCounts: async () => ({ waiting: 0, active: 0 }), close: async () => {} },
  });
  const children = [];
  for (let i = 0; i < count; i++) {
    const child = fork(CHILD, [String(i)], { env: { ...process.env, LOG_LEVEL: 'silent' } });
    children.push(child);
    pool.workers.set(child.pid, child);
  }
  return { pool, children };
}

describe('the pool aggregates its workers', () => {
  it('reports the pool size, which nothing used to write', async () => {
    const { pool, children } = poolWithChildren(2);
    try {
      const body = await pool.collectMetrics();
      expect(body).toMatch(/codecloud_worker_pool_size(\{[^}]*\})? 2/);
    } finally {
      for (const c of children) c.kill();
    }
  });

  it('includes counters that only exist inside the children', async () => {
    const { pool, children } = poolWithChildren(3);
    try {
      const body = await pool.collectMetrics();
      // Each child records one submission in a distinct language.
      expect(body).toContain('codecloud_verdicts_total');
      expect(body).toContain('language="python"');
      expect(body).toContain('language="java"');
      expect(body).toContain('language="go"');
    } finally {
      for (const c of children) c.kill();
    }
  });

  it('sums a counter across children rather than reporting one of them', async () => {
    const { pool, children } = poolWithChildren(3);
    try {
      const body = await pool.collectMetrics();
      const total = [...body.matchAll(/^codecloud_grading_failures_total\S* (\d+)$/gm)].reduce(
        (sum, [, n]) => sum + Number(n),
        0
      );
      // Each child increments it twice.
      expect(total).toBe(6);
    } finally {
      for (const c of children) c.kill();
    }
  });

  it('leaves out a worker that does not answer, rather than failing the scrape', async () => {
    const { pool, children } = poolWithChildren(2);
    // A child that is gone cannot reply; the endpoint must still serve.
    children[0].kill('SIGKILL');
    await new Promise((r) => setTimeout(r, 200));
    try {
      const body = await pool.collectMetrics(300);
      expect(body).toContain('codecloud_worker_pool_size');
    } finally {
      for (const c of children) c.kill();
    }
  });
});

describe('the metrics endpoint is fail-closed', () => {
  const request = (port, headers = {}) =>
    fetch(`http://127.0.0.1:${port}/metrics`, { headers }).then(async (r) => ({
      status: r.status,
      body: await r.text(),
    }));

  it('is not served at all without a token', () => {
    // Not merely unauthorised - no listener at all, the same fail-closed choice
    // the API makes by answering 404.
    expect(startMetricsServer({ port: 0, collect: async () => 'x', token: '' })).toBeNull();
    expect(startMetricsServer({ port: 0, collect: async () => 'x', token: undefined })).not.toBeNull();
  });

  it('refuses a request with the wrong token', async () => {
    const server = startMetricsServer({ port: 0, collect: async () => 'metric 1' });
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address();
    try {
      expect((await request(port)).status).toBe(401);
      expect((await request(port, { Authorization: 'Bearer wrong' })).status).toBe(401);
      const ok = await request(port, { Authorization: `Bearer ${process.env.METRICS_TOKEN}` });
      expect(ok.status).toBe(200);
      expect(ok.body).toBe('metric 1');
    } finally {
      server.close();
    }
  });

  it('serves nothing but /metrics', async () => {
    const server = startMetricsServer({ port: 0, collect: async () => 'x' });
    await new Promise((r) => server.once('listening', r));
    const { port } = server.address();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { Authorization: `Bearer ${process.env.METRICS_TOKEN}` },
      });
      expect(res.status).toBe(404);
    } finally {
      server.close();
    }
  });
});

afterAll(async () => {
  // The registry is process-wide; leaving default metrics collecting keeps a
  // timer alive and the run open.
  metrics.register.clear();
});
