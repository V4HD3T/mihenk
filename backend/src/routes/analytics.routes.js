const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const logger = require('../logger');

const router = express.Router();

// GET /api/analytics/overview - class-wide statistics for a teacher
router.get('/overview', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const totals = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM problems WHERE created_by = $1) AS problem_count,
        (SELECT COUNT(*) FROM exams WHERE created_by = $1) AS exam_count,
        (SELECT COUNT(DISTINCT user_id) FROM submissions s JOIN problems p ON p.id = s.problem_id WHERE p.created_by = $1) AS active_students,
        (SELECT COUNT(*) FROM submissions s JOIN problems p ON p.id = s.problem_id WHERE p.created_by = $1) AS submission_count
    `, [req.user.id]);

    const dailySubmissions = await pool.query(`
      SELECT DATE(s.submitted_at) AS day, COUNT(*) AS count,
             COUNT(*) FILTER (WHERE s.passed_count = s.total_count) AS passed_count
      FROM submissions s JOIN problems p ON p.id = s.problem_id
      WHERE p.created_by = $1 AND s.submitted_at >= NOW() - INTERVAL '14 days'
      GROUP BY DATE(s.submitted_at) ORDER BY day ASC
    `, [req.user.id]);

    const languageDistribution = await pool.query(`
      SELECT s.language, COUNT(*) AS count
      FROM submissions s JOIN problems p ON p.id = s.problem_id
      WHERE p.created_by = $1
      GROUP BY s.language
    `, [req.user.id]);

    const problemSuccessRates = await pool.query(`
      SELECT p.id, p.title,
             COUNT(s.id) AS attempt_count,
             COUNT(s.id) FILTER (WHERE s.passed_count = s.total_count) AS solved_count
      FROM problems p LEFT JOIN submissions s ON s.problem_id = p.id
      WHERE p.created_by = $1
      GROUP BY p.id, p.title ORDER BY attempt_count DESC LIMIT 10
    `, [req.user.id]);

    res.json({
      totals: totals.rows[0],
      dailySubmissions: dailySubmissions.rows,
      languageDistribution: languageDistribution.rows,
      problemSuccessRates: problemSuccessRates.rows,
    });
  } catch (err) {
    logger.error({ err }, 'Analytics failed');
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
});

// GET /api/analytics/me - personal progress for a student
router.get('/me', requireAuth, async (req, res) => {
  try {
    const totals = await pool.query(`
      SELECT
        COUNT(*) AS submission_count,
        COUNT(DISTINCT problem_id) FILTER (WHERE passed_count = total_count) AS solved_count,
        COUNT(DISTINCT problem_id) AS attempted_count
      FROM submissions WHERE user_id = $1
    `, [req.user.id]);

    const dailyActivity = await pool.query(`
      SELECT DATE(submitted_at) AS day, COUNT(*) AS count
      FROM submissions WHERE user_id = $1 AND submitted_at >= NOW() - INTERVAL '14 days'
      GROUP BY DATE(submitted_at) ORDER BY day ASC
    `, [req.user.id]);

    const languageBreakdown = await pool.query(`
      SELECT language, COUNT(*) AS count FROM submissions WHERE user_id = $1 GROUP BY language
    `, [req.user.id]);

    const totalProblems = await pool.query('SELECT COUNT(*) AS count FROM problems');

    res.json({
      totals: totals.rows[0],
      dailyActivity: dailyActivity.rows,
      languageBreakdown: languageBreakdown.rows,
      totalProblems: Number(totalProblems.rows[0].count),
    });
  } catch (err) {
    logger.error({ err }, 'Personal analytics failed');
    res.status(500).json({ error: 'Failed to fetch analytics data' });
  }
});

module.exports = router;
