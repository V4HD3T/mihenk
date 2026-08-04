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
const logger = require('./logger');
const { config } = require('./config/env');

const CONCURRENCY = config().WORKER_CONCURRENCY;

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

  // How this problem wants its output judged, and how much room it gets.
  const problemResult = await pool.query(
    'SELECT checker, checker_config, time_limit_sec, memory_limit_mb FROM problems WHERE id = $1',
    [submission.problem_id]
  );
  const problem = problemResult.rows[0] || {};

  const gradeResult = await runTestCases(submission.language, submission.code, testCasesResult.rows, {
    checker: problem.checker || 'exact',
    checkerConfig: problem.checker_config || {},
    limits: {
      timeLimitSec: problem.time_limit_sec || undefined,
      memoryMb: problem.memory_limit_mb || undefined,
    },
  });
  const totalTimeMs = gradeResult.results.reduce((sum, r) => sum + (r.executionTimeMs || 0), 0);

  // Same "hide hidden-test output from students" rule as the old synchronous endpoint.
  const visibleResults = gradeResult.results.map((r) => ({
    test_case_id: r.test_case_id,
    passed: r.passed,
    // The verdict is safe to show for hidden tests too: it says *how* the run
    // failed, not what the expected output was.
    verdict: r.verdict,
    verdictLabel: r.verdictLabel,
    verdictReason: r.verdictReason,
    is_sample: r.is_sample,
    stdout: r.is_sample ? r.stdout : undefined,
    stderr: r.is_sample ? r.stderr : undefined,
    timedOut: r.timedOut,
  }));
  const resultsJson = { results: visibleResults, compileError: gradeResult.compileError || null };

  await pool.query(
    `UPDATE submissions
     SET status = $1, passed_count = $2, total_count = $3, execution_time_ms = $4,
         results_json = $5, verdict = $6
     WHERE id = $7`,
    [
      gradeResult.compileError ? 'error' : 'completed',
      gradeResult.passedCount,
      gradeResult.totalCount,
      totalTimeMs,
      JSON.stringify(resultsJson),
      gradeResult.verdict || null,
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
    verdict: gradeResult.verdict || null,
    compileError: gradeResult.compileError || null,
    results: visibleResults,
  };
}

const worker = new Worker('grading', gradeSubmission, {
  connection: createConnection(),
  concurrency: CONCURRENCY,
});

worker.on('completed', (job) => {
  logger.info({ submissionId: job.data.submissionId }, 'graded submission');
});
worker.on('failed', async (job, err) => {
  logger.error({ err, submissionId: job?.data?.submissionId }, 'grading job failed');
  if (job?.data?.submissionId) {
    await pool.query("UPDATE submissions SET status = 'error' WHERE id = $1", [job.data.submissionId]).catch(() => {});
  }
});

logger.info(`Grading worker started (concurrency=${CONCURRENCY})`);

/**
 * Finish the submissions already being graded before exiting.
 *
 * worker.close() stops taking new jobs and waits for in-flight ones, so a
 * restart no longer strands submissions in the 'running' state with a student
 * watching a spinner that will never resolve.
 */
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, finishing in-flight jobs before exit`);

  const timer = setTimeout(() => {
    logger.error('Worker shutdown timed out, forcing exit');
    process.exit(1);
  }, 30000);
  timer.unref();

  try {
    await worker.close();
    await pool.end();
    logger.info('Worker shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during worker shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
