const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const logger = require('../logger');

const router = express.Router();

// GET /api/users/students - student list + summary stats for a teacher
router.get('/students', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.created_at,
             COUNT(s.id) AS submission_count,
             COUNT(DISTINCT s.problem_id) FILTER (WHERE s.passed_count = s.total_count) AS solved_count
      FROM users u
      LEFT JOIN submissions s ON s.user_id = u.id
      WHERE u.role = 'student'
      GROUP BY u.id
      ORDER BY u.name ASC
    `);
    res.json({ students: result.rows });
  } catch (err) {
    logger.error({ err }, 'Student list failed');
    res.status(500).json({ error: 'Failed to fetch student list' });
  }
});

// GET /api/users/students/:id - detailed progress for a single student (teacher)
router.get('/students/:id', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const studentResult = await pool.query(
      "SELECT id, name, email, created_at FROM users WHERE id = $1 AND role = 'student'",
      [req.params.id]
    );
    if (studentResult.rows.length === 0) return res.status(404).json({ error: 'Student not found' });

    const submissionsResult = await pool.query(
      `SELECT s.id, s.language, s.passed_count, s.total_count, s.submitted_at, p.title AS problem_title
       FROM submissions s JOIN problems p ON p.id = s.problem_id
       WHERE s.user_id = $1 ORDER BY s.submitted_at DESC LIMIT 50`,
      [req.params.id]
    );

    res.json({ student: studentResult.rows[0], submissions: submissionsResult.rows });
  } catch (err) {
    logger.error({ err }, 'Student detail failed');
    res.status(500).json({ error: 'Failed to fetch student detail' });
  }
});

module.exports = router;
