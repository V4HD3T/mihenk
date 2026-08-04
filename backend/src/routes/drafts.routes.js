const express = require('express');
const pool = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const access = require('../services/courseAccess.service');
const logger = require('../logger');

const router = express.Router();

/**
 * In-progress code, saved as the student types.
 *
 * Drafts are strictly private to the person who wrote them - a draft is
 * unsubmitted work, and during an exam it is answers-in-progress. Nothing here
 * lets one user read another's, not even a teacher.
 */

// PUT /api/drafts - save (or overwrite) the draft for one problem
router.put('/', requireAuth, validate({ body: schemas.saveDraft }), async (req, res) => {
  try {
    const { problem_id, exam_id, language, code } = req.body;

    // Same course rule as everywhere else: no writing drafts against a problem
    // you can't reach.
    if (!(await access.canAccessProblem(req.user, problem_id))) {
      return res.status(404).json({ error: 'Problem not found' });
    }

    const result = await pool.query(
      `INSERT INTO submission_drafts (user_id, problem_id, exam_id, language, code, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id, problem_id, COALESCE(exam_id, 0))
       DO UPDATE SET language = EXCLUDED.language, code = EXCLUDED.code, updated_at = NOW()
       RETURNING id, updated_at`,
      [req.user.id, problem_id, exam_id || null, language, code]
    );
    res.json({ saved: true, updatedAt: result.rows[0].updated_at });
  } catch (err) {
    logger.error({ err }, 'Saving draft failed');
    res.status(500).json({ error: 'Failed to save the draft' });
  }
});

// GET /api/drafts?problem_id=&exam_id= - restore what the student was writing
router.get('/', requireAuth, validate({ query: schemas.draftQuery }), async (req, res) => {
  try {
    const { problem_id, exam_id } = req.validatedQuery;
    const result = await pool.query(
      `SELECT language, code, updated_at FROM submission_drafts
       WHERE user_id = $1 AND problem_id = $2
         AND COALESCE(exam_id, 0) = COALESCE($3::int, 0)`,
      [req.user.id, problem_id, exam_id ?? null]
    );
    res.json({ draft: result.rows[0] || null });
  } catch (err) {
    logger.error({ err }, 'Fetching draft failed');
    res.status(500).json({ error: 'Failed to fetch the draft' });
  }
});

// DELETE /api/drafts?problem_id=&exam_id= - discard, e.g. after a successful submit
router.delete('/', requireAuth, validate({ query: schemas.draftQuery }), async (req, res) => {
  try {
    const { problem_id, exam_id } = req.validatedQuery;
    await pool.query(
      `DELETE FROM submission_drafts
       WHERE user_id = $1 AND problem_id = $2
         AND COALESCE(exam_id, 0) = COALESCE($3::int, 0)`,
      [req.user.id, problem_id, exam_id ?? null]
    );
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Deleting draft failed');
    res.status(500).json({ error: 'Failed to delete the draft' });
  }
});

module.exports = router;
