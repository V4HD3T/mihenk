const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const access = require('../services/courseAccess.service');
const session = require('../services/examSession.service');
const { executeCode } = require('../services/codeExecution.service');
const { enqueueGrading } = require('../queue/gradingQueue');
const logger = require('../logger');
const metrics = require('../metrics');

const router = express.Router();

// POST /api/submissions/execute - "Run" button: single run with free-form stdin, not saved
router.post(
  '/execute',
  requireAuth,
  validate({ body: schemas.executeCode }),
  async (req, res) => {
    try {
      const { language, code, stdin } = req.body;
      const result = await executeCode(language, code, stdin);
      res.json(result);
    } catch (err) {
      logger.error({ err }, 'Code execution failed');
      res.status(500).json({ error: 'An error occurred while running the code' });
    }
  }
);

// POST /api/submissions - "Submit" button: enqueue for grading, respond immediately.
// Grading itself happens asynchronously in a worker process (src/worker.js); the
// client is notified over WebSocket when it's done, and can also poll GET /:id.
router.post('/', requireAuth, validate({ body: schemas.createSubmission }), async (req, res) => {
  try {
    const { problem_id, exam_id, language, code } = req.body;

    // Scoped: submitting to a problem in a course you're not enrolled in is a
    // 404, the same as a problem that doesn't exist.
    //
    // The visibility gate belongs here too, and not only in the exam branch
    // below. A submission carrying no exam_id skipped the window check
    // entirely, so "practise" against tomorrow's paper ran its hidden tests and
    // reported which ones passed - a better oracle than simply reading it.
    const scope = access.courseScope(req.user, 'p.course_id', 2);
    const seen = access.problemVisibility(req.user, 'p.id', 2 + scope.params.length);
    const problemResult = await pool.query(
      `SELECT p.id FROM problems p
       WHERE p.id = $1 AND ${scope.sql} AND ${seen.sql}`,
      [problem_id, ...scope.params, ...seen.params]
    );
    if (problemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Problem not found' });
    }

    // For exam submissions, validate the window and the student's own problem set
    let late = { isLate: false, penaltyPercent: 0 };
    if (exam_id) {
      // Not sitting this exam is a 404, exactly like not being in the course:
      // a student on the main sitting learns nothing about the make-up paper,
      // including that it exists.
      if (!(await access.canAccessExam(req.user, exam_id))) {
        return res.status(404).json({ error: 'Exam not found' });
      }

      // Uses the student's *effective* deadline, so a granted accommodation is
      // honoured here and not only when the exam page loads.
      const window = await session.isWindowOpen(exam_id, req.user.id);
      if (!window.open) {
        return res.status(403).json({
          error:
            window.reason === 'not_started'
              ? 'This exam has not started yet'
              : 'This exam is no longer accepting submissions',
        });
      }
      // Accepted, but after the deadline and inside the exam's late window. The
      // penalty in force right now is stamped onto the row rather than looked up
      // at read time, so a teacher who changes it later does not silently
      // re-mark work that was already graded under the old one.
      late = { isLate: Boolean(window.late), penaltyPercent: window.latePenaltyPercent || 0 };

      // With a randomised pool, answering a problem you weren't dealt would
      // otherwise be a way to see the whole pool.
      const assigned = await session.assignedProblemIds(exam_id, req.user.id);
      if (!assigned.includes(Number(problem_id))) {
        return res.status(403).json({ error: 'This problem is not part of your exam' });
      }
    }

    const testCasesResult = await pool.query(
      'SELECT id FROM test_cases WHERE problem_id = $1',
      [problem_id]
    );
    if (testCasesResult.rows.length === 0) {
      return res.status(400).json({ error: 'This problem has no test cases defined' });
    }

    const insertResult = await pool.query(
      `INSERT INTO submissions (user_id, problem_id, exam_id, language, code, status, passed_count, total_count, execution_time_ms, is_late, late_penalty_percent)
       VALUES ($1, $2, $3, $4, $5, 'queued', 0, $6, 0, $7, $8) RETURNING *`,
      [
        req.user.id,
        problem_id,
        exam_id || null,
        language,
        code,
        testCasesResult.rows.length,
        late.isLate,
        late.penaltyPercent,
      ]
    );
    const submission = insertResult.rows[0];

    try {
      await enqueueGrading(submission.id);
    } catch (err) {
      // The row exists but nothing will ever grade it, so don't leave it
      // sitting in 'queued' forever pretending otherwise.
      metrics.enqueueFailuresTotal.inc();
      logger.error({ err, submissionId: submission.id }, 'Could not enqueue grading job');
      await pool
        .query("UPDATE submissions SET status = 'error' WHERE id = $1", [submission.id])
        .catch(() => {});
      return res.status(503).json({
        error: 'The grading service is unavailable right now. Your code was not lost - please submit again shortly.',
      });
    }

    metrics.submissionsTotal.inc({ language });

    // 202 Accepted: grading has been queued, not completed yet. The client
    // should wait for a WebSocket "submission_result" push or poll GET /:id.
    res.status(202).json({ submission, status: 'queued' });
  } catch (err) {
    logger.error({ err }, 'Queueing submission failed');
    res.status(500).json({ error: 'An error occurred while queueing the submission' });
  }
});

// NOTE ON ROUTE ORDER: the literal paths below must stay above the '/:id'
// route. Express matches in registration order, so a '/:id' registered first
// swallows '/my' as id="my" - which is exactly what happened in v0.0.2 and
// made this endpoint return 500 for every caller.

// GET /api/submissions/my - current user's own submission history
router.get('/my', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.language, s.status, s.passed_count, s.total_count, s.submitted_at,
              p.id AS problem_id, p.title AS problem_title
       FROM submissions s JOIN problems p ON p.id = s.problem_id
       WHERE s.user_id = $1
       ORDER BY s.submitted_at DESC LIMIT 100`,
      [req.user.id]
    );
    res.json({ submissions: result.rows });
  } catch (err) {
    logger.error({ err }, 'Fetching submission history failed');
    res.status(500).json({ error: 'Failed to fetch submission history' });
  }
});

// GET /api/submissions/problem/:id - all submissions for a problem (teacher)
router.get(
  '/problem/:id',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.idParam }),
  async (req, res) => {
    try {
      // A teacher may only read submissions for problems in their own courses.
      if (!(await access.ownsProblem(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Problem not found' });
      }
      const result = await pool.query(
        `SELECT s.id, s.language, s.status, s.passed_count, s.total_count, s.submitted_at,
                u.id AS user_id, u.name AS user_name, u.email AS user_email
         FROM submissions s JOIN users u ON u.id = s.user_id
         WHERE s.problem_id = $1
         ORDER BY s.submitted_at DESC`,
        [req.params.id]
      );
      res.json({ submissions: result.rows });
    } catch (err) {
      logger.error({ err }, 'Fetching problem submissions failed');
      res.status(500).json({ error: 'Failed to fetch submissions' });
    }
  }
);

// GET /api/submissions/:id - poll a single submission's current status/result
// (fallback for clients that miss the WebSocket push, e.g. a dropped connection).
// Registered last so it can't shadow the literal routes above.
router.get('/:id', requireAuth, validate({ params: schemas.idParam }), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM submissions WHERE id = $1 AND user_id = $2', [
      req.params.id,
      req.user.id,
    ]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Submission not found' });
    const submission = result.rows[0];
    const detail = submission.results_json || {};
    res.json({
      submission,
      status: submission.status,
      passedCount: submission.passed_count,
      totalCount: submission.total_count,
      results: detail.results,
      compileError: detail.compileError,
    });
  } catch (err) {
    logger.error({ err }, 'Submission lookup failed');
    res.status(500).json({ error: 'Failed to fetch submission' });
  }
});

module.exports = router;
