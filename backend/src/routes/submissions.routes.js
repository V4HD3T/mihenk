const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { executeCode } = require('../services/codeExecution.service');
const gradingQueue = require('../queue/gradingQueue');

const router = express.Router();
const VALID_LANGUAGES = ['python', 'cpp', 'java', 'javascript', 'c'];

// POST /api/submissions/execute - "Run" button: single run with free-form stdin, not saved
router.post('/execute', requireAuth, async (req, res) => {
  try {
    const { language, code, stdin } = req.body;
    if (!VALID_LANGUAGES.includes(language)) {
      return res.status(400).json({ error: 'Invalid language. Must be python, cpp, java, javascript, or c' });
    }
    if (typeof code !== 'string' || code.trim() === '') {
      return res.status(400).json({ error: 'Code cannot be empty' });
    }
    const result = await executeCode(language, code, stdin || '');
    res.json(result);
  } catch (err) {
    console.error('Execution error:', err);
    res.status(500).json({ error: 'An error occurred while running the code' });
  }
});

// POST /api/submissions - "Submit" button: enqueue for grading, respond immediately.
// Grading itself happens asynchronously in a worker process (src/worker.js); the
// client is notified over WebSocket when it's done, and can also poll GET /:id.
router.post('/', requireAuth, async (req, res) => {
  try {
    const { problem_id, exam_id, language, code } = req.body;
    if (!VALID_LANGUAGES.includes(language)) {
      return res.status(400).json({ error: 'Invalid language. Must be python, cpp, java, javascript, or c' });
    }
    if (typeof code !== 'string' || code.trim() === '') {
      return res.status(400).json({ error: 'Code cannot be empty' });
    }

    const problemResult = await pool.query('SELECT id FROM problems WHERE id = $1', [problem_id]);
    if (problemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Problem not found' });
    }

    // For exam submissions, validate the time window
    if (exam_id) {
      const examResult = await pool.query('SELECT * FROM exams WHERE id = $1', [exam_id]);
      if (examResult.rows.length === 0) return res.status(404).json({ error: 'Exam not found' });
      const exam = examResult.rows[0];
      const now = new Date();
      if (now < new Date(exam.start_time) || now > new Date(exam.end_time)) {
        return res.status(403).json({ error: 'This exam is not currently active' });
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
      `INSERT INTO submissions (user_id, problem_id, exam_id, language, code, status, passed_count, total_count, execution_time_ms)
       VALUES ($1, $2, $3, $4, $5, 'queued', 0, $6, 0) RETURNING *`,
      [req.user.id, problem_id, exam_id || null, language, code, testCasesResult.rows.length]
    );
    const submission = insertResult.rows[0];

    await gradingQueue.add('grade', { submissionId: submission.id });

    // 202 Accepted: grading has been queued, not completed yet. The client
    // should wait for a WebSocket "submission_result" push or poll GET /:id.
    res.status(202).json({ submission, status: 'queued' });
  } catch (err) {
    console.error('Submission error:', err);
    res.status(500).json({ error: 'An error occurred while queueing the submission' });
  }
});

// GET /api/submissions/:id - poll a single submission's current status/result
// (fallback for clients that miss the WebSocket push, e.g. a dropped connection)
router.get('/:id', requireAuth, async (req, res) => {
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
    console.error('Submission lookup error:', err);
    res.status(500).json({ error: 'Failed to fetch submission' });
  }
});

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
    console.error('Submission history error:', err);
    res.status(500).json({ error: 'Failed to fetch submission history' });
  }
});

// GET /api/submissions/problem/:id - all submissions for a problem (teacher)
router.get('/problem/:id', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
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
    console.error('Problem submissions error:', err);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

module.exports = router;
