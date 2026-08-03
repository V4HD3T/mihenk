/**
 * worker.js
 *
 * Standalone process that consumes grading jobs from the "grading" BullMQ
 * queue and runs them through the (synchronous, per-job) execution engine.
 * Run it separately from the API server:
 *
 *   npm run worker        # or: node src/worker.js
 *
 * This is intentionally a SEPARATE process from server.js - in production
 * you would run N of these (on the same machine or different ones) to
 * scale grading throughput horizontally; they all pull from the same
 * Redis-backed queue, so no coordination between them is needed.
 */

require('dotenv').config();
const { Worker } = require('bullmq');
const createConnection = require('./queue/redis');
const pool = require('./config/db');
const { runTestCases } = require('./services/codeExecution.service');

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY) || 4;

async function gradeSubmission(job) {
  const { submissionId } = job.data;

  await pool.query("UPDATE submissions SET status = 'running' WHERE id = $1", [submissionId]);

  const submissionResult = await pool.query('SELECT * FROM submissions WHERE id = $1', [submissionId]);
  const submission = submissionResult.rows[0];
  if (!submission) throw new Error(`Submission ${submissionId} not found`);

  const testCasesResult = await pool.query(
    'SELECT id, input, expected_output, is_sample FROM test_cases WHERE problem_id = $1 ORDER BY ord ASC',
    [submission.problem_id]
  );

  const gradeResult = await runTestCases(submission.language, submission.code, testCasesResult.rows);
  const totalTimeMs = gradeResult.results.reduce((sum, r) => sum + (r.executionTimeMs || 0), 0);

  // Same "hide hidden-test output from students" rule as the old synchronous endpoint.
  const visibleResults = gradeResult.results.map((r) => ({
    test_case_id: r.test_case_id,
    passed: r.passed,
    is_sample: r.is_sample,
    stdout: r.is_sample ? r.stdout : undefined,
    stderr: r.is_sample ? r.stderr : undefined,
    timedOut: r.timedOut,
  }));
  const resultsJson = { results: visibleResults, compileError: gradeResult.compileError || null };

  await pool.query(
    `UPDATE submissions
     SET status = $1, passed_count = $2, total_count = $3, execution_time_ms = $4, results_json = $5
     WHERE id = $6`,
    [
      gradeResult.compileError ? 'error' : 'completed',
      gradeResult.passedCount,
      gradeResult.totalCount,
      totalTimeMs,
      JSON.stringify(resultsJson),
      submissionId,
    ]
  );

  // This becomes the job's `returnvalue`, which the API process's QueueEvents
  // listener reads to know which user to push a WebSocket notification to.
  return {
    userId: submission.user_id,
    submissionId,
    passedCount: gradeResult.passedCount,
    totalCount: gradeResult.totalCount,
    status: gradeResult.compileError ? 'error' : 'completed',
    compileError: gradeResult.compileError || null,
    results: visibleResults,
  };
}

const worker = new Worker('grading', gradeSubmission, {
  connection: createConnection(),
  concurrency: CONCURRENCY,
});

worker.on('completed', (job) => {
  console.log(`[worker] graded submission ${job.data.submissionId}`);
});
worker.on('failed', async (job, err) => {
  console.error(`[worker] job for submission ${job?.data?.submissionId} failed:`, err.message);
  if (job?.data?.submissionId) {
    await pool.query("UPDATE submissions SET status = 'error' WHERE id = $1", [job.data.submissionId]).catch(() => {});
  }
});

console.log(`Grading worker started (concurrency=${CONCURRENCY})`);
