const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { computeFingerprint, compareFingerprints, getMatchedSpans, computeClassReport } = require('../services/similarity.service');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const logger = require('../logger');

const router = express.Router();

// ---------------------------------------------------------------------------
// Code similarity ("plagiarism screening")
// ---------------------------------------------------------------------------

// GET /api/integrity/problem/:id/similarity - class-wide pairwise similarity report (teacher)
router.get('/problem/:id/similarity', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    // Latest submission per (student, language) for this problem - comparing a student's
    // own drafts against each other would be noise, and cross-language comparison is meaningless.
    const result = await pool.query(
      `SELECT DISTINCT ON (s.user_id, s.language)
              s.id AS submission_id, s.user_id, s.language, s.code, u.name AS user_name
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       WHERE s.problem_id = $1
       ORDER BY s.user_id, s.language, s.submitted_at DESC`,
      [req.params.id]
    );

    const byLanguage = {};
    for (const row of result.rows) {
      (byLanguage[row.language] ||= []).push({
        submissionId: row.submission_id,
        userId: row.user_id,
        userName: row.user_name,
        language: row.language,
        code: row.code,
      });
    }

    const groups = Object.entries(byLanguage)
      .filter(([, subs]) => subs.length >= 2)
      .map(([language, subs]) => ({ language, submissionCount: subs.length, ...computeClassReport(subs) }));

    res.json({ groups });
  } catch (err) {
    logger.error({ err }, 'Similarity report failed');
    res.status(500).json({ error: 'Failed to compute similarity report' });
  }
});

// GET /api/integrity/compare/:idA/:idB - side-by-side comparison with highlighted matches (teacher)
router.get('/compare/:idA/:idB', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.id, s.code, s.language, s.problem_id, u.name AS user_name
       FROM submissions s JOIN users u ON u.id = s.user_id
       WHERE s.id IN ($1, $2)`,
      [req.params.idA, req.params.idB]
    );
    if (result.rows.length !== 2) return res.status(404).json({ error: 'One or both submissions were not found' });

    const [a, b] = result.rows[0].id === Number(req.params.idA) ? result.rows : [result.rows[1], result.rows[0]];
    if (a.problem_id !== b.problem_id) {
      return res.status(400).json({ error: 'Submissions belong to different problems and cannot be compared' });
    }
    if (a.language !== b.language) {
      return res.status(400).json({ error: 'Submissions are in different languages and cannot be meaningfully compared' });
    }

    const fpA = computeFingerprint(a.code, a.language);
    const fpB = computeFingerprint(b.code, b.language);
    const cmp = compareFingerprints(fpA.fingerprints, fpB.fingerprints);

    res.json({
      similarity: Math.round(cmp.similarity * 10) / 10,
      submissionA: {
        id: a.id,
        userName: a.user_name,
        language: a.language,
        code: a.code,
        matchedSpans: getMatchedSpans(fpA.fingerprints, cmp.shared),
      },
      submissionB: {
        id: b.id,
        userName: b.user_name,
        language: b.language,
        code: b.code,
        matchedSpans: getMatchedSpans(fpB.fingerprints, cmp.shared),
      },
    });
  } catch (err) {
    logger.error({ err }, 'Comparison failed');
    res.status(500).json({ error: 'Failed to compare submissions' });
  }
});

// ---------------------------------------------------------------------------
// Exam-session monitoring (tab-switches, pastes)
// ---------------------------------------------------------------------------

// POST /api/integrity/events - the client reports one of its own integrity events
router.post('/events', requireAuth, validate({ body: schemas.integrityEvent }), async (req, res) => {
  try {
    const { exam_id, problem_id, event_type, detail } = req.body;

    const examResult = await pool.query('SELECT * FROM exams WHERE id = $1', [exam_id]);
    if (examResult.rows.length === 0) return res.status(404).json({ error: 'Exam not found' });
    const exam = examResult.rows[0];
    const now = new Date();
    if (now < new Date(exam.start_time) || now > new Date(exam.end_time)) {
      // Outside the exam window: silently accept without logging, nothing to monitor.
      return res.status(204).end();
    }

    await pool.query(
      `INSERT INTO integrity_events (user_id, exam_id, problem_id, event_type, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, exam_id, problem_id || null, event_type, detail ? String(detail).slice(0, 500) : null]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Integrity event logging failed');
    res.status(500).json({ error: 'Failed to log integrity event' });
  }
});

// GET /api/integrity/exam/:id - per-student integrity summary for an exam (teacher)
router.get('/exam/:id', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id AS user_id, u.name, u.email,
              COUNT(*) FILTER (WHERE ie.event_type = 'tab_hidden') AS tab_hidden_count,
              COUNT(*) FILTER (WHERE ie.event_type = 'paste') AS paste_count,
              MAX(ie.occurred_at) AS last_event_at
       FROM integrity_events ie
       JOIN users u ON u.id = ie.user_id
       WHERE ie.exam_id = $1
       GROUP BY u.id, u.name, u.email
       ORDER BY (COUNT(*) FILTER (WHERE ie.event_type = 'tab_hidden') + COUNT(*) FILTER (WHERE ie.event_type = 'paste')) DESC`,
      [req.params.id]
    );
    res.json({ summary: result.rows });
  } catch (err) {
    logger.error({ err }, 'Exam integrity summary failed');
    res.status(500).json({ error: 'Failed to fetch exam integrity summary' });
  }
});

module.exports = router;
