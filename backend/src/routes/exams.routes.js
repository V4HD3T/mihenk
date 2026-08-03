const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const logger = require('../logger');

const router = express.Router();

// POST /api/exams - create a new exam (teacher)
router.post('/', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const { title, description, start_time, end_time, duration_minutes, problem_ids } = req.body;
    if (!title || !start_time || !end_time || !duration_minutes) {
      return res.status(400).json({ error: 'Title, start/end time, and duration are required' });
    }
    if (!problem_ids || problem_ids.length === 0) {
      return res.status(400).json({ error: 'You must add at least one problem to the exam' });
    }
    if (new Date(start_time) >= new Date(end_time)) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const examResult = await client.query(
        `INSERT INTO exams (title, description, created_by, start_time, end_time, duration_minutes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [title.trim(), description || '', req.user.id, start_time, end_time, duration_minutes]
      );
      const exam = examResult.rows[0];
      for (const problemId of problem_ids) {
        await client.query(
          'INSERT INTO exam_problems (exam_id, problem_id, points) VALUES ($1, $2, $3)',
          [exam.id, problemId, Math.floor(100 / problem_ids.length)]
        );
      }
      await client.query('COMMIT');
      res.status(201).json({ exam });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, 'Exam creation failed');
    res.status(500).json({ error: 'Failed to create exam' });
  }
});

// GET /api/exams - teacher sees exams they created, student sees active/upcoming exams
router.get('/', requireAuth, async (req, res) => {
  try {
    let query, params;
    if (req.user.role === 'teacher') {
      query = `SELECT e.*, COUNT(DISTINCT ep.problem_id) AS problem_count,
                      COUNT(DISTINCT s.user_id) AS participant_count
               FROM exams e
               LEFT JOIN exam_problems ep ON ep.exam_id = e.id
               LEFT JOIN submissions s ON s.exam_id = e.id
               WHERE e.created_by = $1
               GROUP BY e.id ORDER BY e.start_time DESC`;
      params = [req.user.id];
    } else {
      query = `SELECT e.*, COUNT(DISTINCT ep.problem_id) AS problem_count
               FROM exams e
               LEFT JOIN exam_problems ep ON ep.exam_id = e.id
               WHERE e.end_time >= NOW() - INTERVAL '1 day'
               GROUP BY e.id ORDER BY e.start_time ASC`;
      params = [];
    }
    const result = await pool.query(query, params);
    res.json({ exams: result.rows });
  } catch (err) {
    logger.error({ err }, 'Exam list failed');
    res.status(500).json({ error: 'Failed to fetch exams' });
  }
});

// GET /api/exams/:id - exam detail + problem list
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const examResult = await pool.query('SELECT * FROM exams WHERE id = $1', [req.params.id]);
    if (examResult.rows.length === 0) return res.status(404).json({ error: 'Exam not found' });

    const problemsResult = await pool.query(
      `SELECT p.id, p.title, p.difficulty, ep.points
       FROM exam_problems ep JOIN problems p ON p.id = ep.problem_id
       WHERE ep.exam_id = $1 ORDER BY p.id ASC`,
      [req.params.id]
    );

    let myProgress = [];
    if (req.user.role === 'student') {
      const progressResult = await pool.query(
        `SELECT problem_id, MAX(passed_count) AS best_passed, MAX(total_count) AS total_count
         FROM submissions WHERE exam_id = $1 AND user_id = $2 GROUP BY problem_id`,
        [req.params.id, req.user.id]
      );
      myProgress = progressResult.rows;
    }

    res.json({ exam: examResult.rows[0], problems: problemsResult.rows, myProgress });
  } catch (err) {
    logger.error({ err }, 'Exam detail failed');
    res.status(500).json({ error: 'Failed to fetch exam detail' });
  }
});

// GET /api/exams/:id/results - exam results table (teacher)
router.get('/:id/results', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id AS user_id, u.name, u.email,
              p.id AS problem_id, p.title AS problem_title,
              MAX(s.passed_count) AS best_passed, MAX(s.total_count) AS total_count
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       JOIN problems p ON p.id = s.problem_id
       WHERE s.exam_id = $1
       GROUP BY u.id, u.name, u.email, p.id, p.title
       ORDER BY u.name ASC, p.id ASC`,
      [req.params.id]
    );
    res.json({ results: result.rows });
  } catch (err) {
    logger.error({ err }, 'Exam results failed');
    res.status(500).json({ error: 'Failed to fetch exam results' });
  }
});

module.exports = router;
