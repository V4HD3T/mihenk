const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const schemas = require('../validation/schemas');
const access = require('../services/courseAccess.service');
const logger = require('../logger');

const router = express.Router();

// GET /api/problems - problems in the caller's courses.
// Optional ?course_id=N narrows to one of them.
// Before v0.0.5 this returned every problem in the system to every user.
router.get('/', requireAuth, async (req, res) => {
  try {
    const scope = access.courseScope(req.user, 'p.course_id', 2);
    const courseId = Number(req.query.course_id) || null;
    // $1 is the caller, $2 the course scope, $3 the optional course filter, so
    // the visibility gate binds from $4.
    const seen = access.problemVisibility(req.user, 'p.id', 3 + scope.params.length);
    const result = await pool.query(
      `SELECT p.id, p.title, p.difficulty, p.created_at, p.course_id,
              c.title AS course_title, u.name AS created_by_name,
              COUNT(DISTINCT s.id) FILTER (WHERE s.user_id = $1 AND s.passed_count = s.total_count) > 0 AS solved_by_me
       FROM problems p
       JOIN courses c ON c.id = p.course_id
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN submissions s ON s.problem_id = p.id
       WHERE ${scope.sql} AND ${seen.sql}
             AND ($3::int IS NULL OR p.course_id = $3)
       GROUP BY p.id, c.title, u.name
       ORDER BY p.created_at DESC`,
      [req.user.id, ...scope.params, courseId, ...seen.params]
    );
    res.json({ problems: result.rows });
  } catch (err) {
    logger.error({ err }, 'Problem list failed');
    res.status(500).json({ error: 'Failed to fetch problems' });
  }
});

// GET /api/problems/:id - detail + sample test cases (hidden tests are not shown to students)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    // Scoped in the same query as the lookup: a problem in a course the caller
    // isn't in is indistinguishable from one that doesn't exist. The same goes
    // for an exam paper whose exam has not started - a student learns nothing
    // from the difference between "not yours" and "not yet".
    const scope = access.courseScope(req.user, 'p.course_id', 2);
    const seen = access.problemVisibility(req.user, 'p.id', 2 + scope.params.length);
    const problemResult = await pool.query(
      `SELECT p.* FROM problems p
       WHERE p.id = $1 AND ${scope.sql} AND ${seen.sql}`,
      [req.params.id, ...scope.params, ...seen.params]
    );
    if (problemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Problem not found' });
    }
    const problem = problemResult.rows[0];

    const showAllTests = req.user.role === 'teacher';
    // Weight and section are the marking scheme rather than the answer, so a
    // student sees them for hidden cases too - that is what lets the interface
    // say what a question is worth before it is attempted.
    const testCasesResult = await pool.query(
      `SELECT id, input, expected_output, is_sample, weight, group_label,
              checker, checker_config
       FROM test_cases
       WHERE problem_id = $1 ${showAllTests ? '' : 'AND is_sample = TRUE'}
       ORDER BY ord ASC, id ASC`,
      [req.params.id]
    );

    res.json({ problem, testCases: testCasesResult.rows });
  } catch (err) {
    logger.error({ err }, 'Problem detail failed');
    res.status(500).json({ error: 'Failed to fetch problem detail' });
  }
});

// POST /api/problems - create a new problem (teacher only)
router.post('/', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const { course_id, title, description, difficulty, starter_code_python, starter_code_cpp, starter_code_java, starter_code_javascript, starter_code_c, starter_code_go, testCases } = req.body;
    // How the output is judged, and how much room the problem gets.
    const grading = schemas.problemGrading.safeParse(req.body);
    if (!grading.success) {
      return res.status(400).json({ error: grading.error.issues[0].message });
    }
    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' });
    }
    if (!testCases || testCases.length === 0) {
      return res.status(400).json({ error: 'You must add at least one test case' });
    }
    // Parsed rather than trusted: weights and per-case checkers go straight into
    // a CHECK-constrained column, and a bad value should be a 400 here instead
    // of a constraint violation surfacing as a 500 halfway through the insert.
    const parsedCases = [];
    for (const raw of testCases) {
      const parsed = schemas.testCase.safeParse(raw);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0].message });
      }
      parsedCases.push(parsed.data);
    }
    if (!course_id) {
      return res.status(400).json({ error: 'A course is required' });
    }
    // A teacher can only add content to a course they own.
    // Assistants author content; only the owner administers the course itself.
    if (!(await access.teachesCourse(req.user, course_id))) {
      return res.status(404).json({ error: 'Course not found' });
    }
    if (await access.courseIsArchived(course_id)) {
      return res.status(403).json({ error: 'This course is archived and is no longer accepting changes' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const problemResult = await client.query(
        `INSERT INTO problems (course_id, title, description, difficulty, starter_code_python, starter_code_cpp,
                               starter_code_java, starter_code_javascript, starter_code_c, starter_code_go,
                               checker, checker_config, time_limit_sec, memory_limit_mb, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
        [
          course_id,
          title.trim(),
          description,
          difficulty || 'medium',
          starter_code_python || '',
          starter_code_cpp || '',
          starter_code_java || '',
          starter_code_javascript || '',
          starter_code_c || '',
          starter_code_go || '',
          grading.data.checker,
          JSON.stringify(grading.data.checker_config),
          grading.data.time_limit_sec ?? null,
          grading.data.memory_limit_mb ?? null,
          req.user.id,
        ]
      );
      const problem = problemResult.rows[0];

      for (let i = 0; i < parsedCases.length; i++) {
        const tc = parsedCases[i];
        await client.query(
          `INSERT INTO test_cases (problem_id, input, expected_output, is_sample, ord,
                                   weight, group_label, checker, checker_config)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            problem.id,
            tc.input || '',
            tc.expected_output,
            !!tc.is_sample,
            i,
            tc.weight ?? 1,
            tc.group_label || '',
            // Null rather than the problem's value: the case defers to the
            // problem, so changing the problem's checker later still moves it.
            tc.checker || null,
            tc.checker ? JSON.stringify(tc.checker_config || {}) : null,
          ]
        );
      }
      await client.query('COMMIT');
      res.status(201).json({ problem });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err }, 'Problem creation failed');
    res.status(500).json({ error: 'Failed to create problem' });
  }
});

// PUT /api/problems/:id - update a problem (teacher only)
router.put('/:id', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    if (!(await access.ownsProblem(req.user, req.params.id))) {
      return res.status(404).json({ error: 'Problem not found' });
    }
    const { title, description, difficulty, starter_code_python, starter_code_cpp, starter_code_java, starter_code_javascript, starter_code_c, starter_code_go } = req.body;
    const grading = schemas.problemGrading.safeParse(req.body);
    if (!grading.success) {
      return res.status(400).json({ error: grading.error.issues[0].message });
    }
    const result = await pool.query(
      `UPDATE problems SET title = $1, description = $2, difficulty = $3,
       starter_code_python = $4, starter_code_cpp = $5, starter_code_java = $6,
       starter_code_javascript = $7, starter_code_c = $8, starter_code_go = $9,
       checker = $10, checker_config = $11, time_limit_sec = $12, memory_limit_mb = $13
       WHERE id = $14 RETURNING *`,
      [
        title, description, difficulty,
        starter_code_python || '', starter_code_cpp || '', starter_code_java || '',
        starter_code_javascript || '', starter_code_c || '', starter_code_go || '',
        grading.data.checker,
        JSON.stringify(grading.data.checker_config),
        grading.data.time_limit_sec ?? null,
        grading.data.memory_limit_mb ?? null,
        req.params.id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Problem not found' });
    res.json({ problem: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Problem update failed');
    res.status(500).json({ error: 'Failed to update problem' });
  }
});

// DELETE /api/problems/:id (teacher only)
router.delete('/:id', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    if (!(await access.ownsProblem(req.user, req.params.id))) {
      return res.status(404).json({ error: 'Problem not found' });
    }
    await pool.query('DELETE FROM problems WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Problem deletion failed');
    res.status(500).json({ error: 'Failed to delete problem (it may be in use by an active exam)' });
  }
});

// POST /api/problems/:id/testcases - add a test case to a problem (teacher)
router.post('/:id/testcases', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    if (!(await access.ownsProblem(req.user, req.params.id))) {
      return res.status(404).json({ error: 'Problem not found' });
    }
    const { input, expected_output, is_sample, weight, group_label, checker, checker_config } = req.body;
    if (!expected_output) return res.status(400).json({ error: 'Expected output is required' });
    if (checker && !schemas.CHECKERS.includes(checker)) {
      return res.status(400).json({ error: 'Unknown checker' });
    }
    if (weight != null && (!Number.isInteger(Number(weight)) || weight < 0 || weight > 1000)) {
      return res.status(400).json({ error: 'Weight must be a whole number between 0 and 1000' });
    }
    const result = await pool.query(
      `INSERT INTO test_cases (problem_id, input, expected_output, is_sample, ord,
                               weight, group_label, checker, checker_config)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(ord), -1) + 1 FROM test_cases WHERE problem_id = $1),
               $5, $6, $7, $8)
       RETURNING *`,
      [
        req.params.id,
        input || '',
        expected_output,
        !!is_sample,
        weight ?? 1,
        (group_label || '').slice(0, 60),
        checker || null,
        checker ? JSON.stringify(checker_config || {}) : null,
      ]
    );
    res.status(201).json({ testCase: result.rows[0] });
  } catch (err) {
    logger.error({ err }, 'Test case creation failed');
    res.status(500).json({ error: 'Failed to add test case' });
  }
});

// DELETE /api/problems/:id/testcases/:tcId (teacher)
router.delete('/:id/testcases/:tcId', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    if (!(await access.ownsProblem(req.user, req.params.id))) {
      return res.status(404).json({ error: 'Problem not found' });
    }
    await pool.query('DELETE FROM test_cases WHERE id = $1 AND problem_id = $2', [req.params.tcId, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Test case deletion failed');
    res.status(500).json({ error: 'Failed to delete test case' });
  }
});

module.exports = router;
