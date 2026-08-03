const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const access = require('../services/courseAccess.service');
const logger = require('../logger');

const router = express.Router();

// POST /api/exams - create a new exam (teacher)
router.post('/', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const { course_id, title, description, start_time, end_time, duration_minutes, problem_ids } = req.body;
    if (!course_id) {
      return res.status(400).json({ error: 'A course is required' });
    }
    if (!(await access.ownsCourse(req.user, course_id))) {
      return res.status(404).json({ error: 'Course not found' });
    }
    if (!title || !start_time || !end_time || !duration_minutes) {
      return res.status(400).json({ error: 'Title, start/end time, and duration are required' });
    }
    if (!problem_ids || problem_ids.length === 0) {
      return res.status(400).json({ error: 'You must add at least one problem to the exam' });
    }
    if (new Date(start_time) >= new Date(end_time)) {
      return res.status(400).json({ error: 'End time must be after start time' });
    }

    // An exam may only contain problems from its own course - otherwise a
    // teacher could pull another course's problem into their exam and expose it.
    const problemCheck = await pool.query(
      'SELECT COUNT(*)::int AS n FROM problems WHERE id = ANY($1::int[]) AND course_id = $2',
      [problem_ids, course_id]
    );
    if (problemCheck.rows[0].n !== problem_ids.length) {
      return res.status(400).json({ error: 'Every problem in an exam must belong to the same course' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const examResult = await client.query(
        `INSERT INTO exams (course_id, title, description, created_by, start_time, end_time, duration_minutes)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [course_id, title.trim(), description || '', req.user.id, start_time, end_time, duration_minutes]
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
      query = `SELECT e.*, c.title AS course_title,
                      COUNT(DISTINCT ep.problem_id) AS problem_count,
                      COUNT(DISTINCT s.user_id) AS participant_count
               FROM exams e
               JOIN courses c ON c.id = e.course_id
               LEFT JOIN exam_problems ep ON ep.exam_id = e.id
               LEFT JOIN submissions s ON s.exam_id = e.id
               WHERE c.created_by = $1
               GROUP BY e.id, c.title ORDER BY e.start_time DESC`;
      params = [req.user.id];
    } else {
      // Students see exams only for courses they are enrolled in. Before
      // v0.0.5 this listed every upcoming exam in the system to every student.
      query = `SELECT e.*, c.title AS course_title, COUNT(DISTINCT ep.problem_id) AS problem_count
               FROM exams e
               JOIN courses c ON c.id = e.course_id
               JOIN enrollments en ON en.course_id = e.course_id AND en.user_id = $1
               LEFT JOIN exam_problems ep ON ep.exam_id = e.id
               WHERE e.end_time >= NOW() - INTERVAL '1 day'
               GROUP BY e.id, c.title ORDER BY e.start_time ASC`;
      params = [req.user.id];
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
    const scope = access.courseScope(req.user, 'x.course_id', 2);
    const examResult = await pool.query(
      `SELECT x.* FROM exams x WHERE x.id = $1 AND ${scope.sql}`,
      [req.params.id, ...scope.params]
    );
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
    if (!(await access.ownsExam(req.user, req.params.id))) {
      return res.status(404).json({ error: 'Exam not found' });
    }
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
