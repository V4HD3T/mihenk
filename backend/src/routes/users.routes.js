const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const logger = require('../logger');

const router = express.Router();

// GET /api/users/students - student list + summary stats for a teacher
router.get('/students', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    // Only students enrolled in this teacher's own courses. Before v0.0.5 this
    // returned every student account on the server to any teacher.
    //
    // The counts need the same restriction as the rows. Joining submissions on
    // user_id alone totalled a student's work across every course they take,
    // so a teacher could read off how busy a student was in a colleague's
    // class. The detail endpoint below scoped this correctly from the start.
    const result = await pool.query(`
      SELECT u.id, u.name, u.email, u.created_at,
             COUNT(s.id) AS submission_count,
             COUNT(DISTINCT s.problem_id) FILTER (WHERE s.passed_count = s.total_count) AS solved_count
      FROM users u
      JOIN enrollments e ON e.user_id = u.id
      JOIN courses c ON c.id = e.course_id AND c.created_by = $1
      LEFT JOIN submissions s ON s.user_id = u.id
        AND EXISTS (
          SELECT 1 FROM problems sp
          JOIN courses sc ON sc.id = sp.course_id
          WHERE sp.id = s.problem_id AND sc.created_by = $1
        )
      WHERE u.role = 'student'
      GROUP BY u.id
      ORDER BY u.name ASC
    `, [req.user.id]);
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
      `SELECT DISTINCT u.id, u.name, u.email, u.created_at FROM users u
       JOIN enrollments e ON e.user_id = u.id
       JOIN courses c ON c.id = e.course_id AND c.created_by = $2
       WHERE u.id = $1 AND u.role = 'student'`,
      [req.params.id, req.user.id]
    );
    if (studentResult.rows.length === 0) return res.status(404).json({ error: 'Student not found' });

    // Only their work inside this teacher's courses.
    const submissionsResult = await pool.query(
      `SELECT s.id, s.language, s.passed_count, s.total_count, s.submitted_at, p.title AS problem_title
       FROM submissions s
       JOIN problems p ON p.id = s.problem_id
       JOIN courses c ON c.id = p.course_id AND c.created_by = $2
       WHERE s.user_id = $1 ORDER BY s.submitted_at DESC LIMIT 50`,
      [req.params.id, req.user.id]
    );

    res.json({ student: studentResult.rows[0], submissions: submissionsResult.rows });
  } catch (err) {
    logger.error({ err }, 'Student detail failed');
    res.status(500).json({ error: 'Failed to fetch student detail' });
  }
});

module.exports = router;
