const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/problems - list of all problems (visible to everyone)
router.get('/', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.title, p.difficulty, p.created_at, u.name AS created_by_name,
              COUNT(DISTINCT s.id) FILTER (WHERE s.user_id = $1 AND s.passed_count = s.total_count) > 0 AS solved_by_me
       FROM problems p
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN submissions s ON s.problem_id = p.id
       GROUP BY p.id, u.name
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json({ problems: result.rows });
  } catch (err) {
    console.error('Problem list error:', err);
    res.status(500).json({ error: 'Failed to fetch problems' });
  }
});

// GET /api/problems/:id - detail + sample test cases (hidden tests are not shown to students)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const problemResult = await pool.query('SELECT * FROM problems WHERE id = $1', [req.params.id]);
    if (problemResult.rows.length === 0) {
      return res.status(404).json({ error: 'Problem not found' });
    }
    const problem = problemResult.rows[0];

    const showAllTests = req.user.role === 'teacher';
    const testCasesResult = await pool.query(
      `SELECT id, input, expected_output, is_sample FROM test_cases
       WHERE problem_id = $1 ${showAllTests ? '' : 'AND is_sample = TRUE'}
       ORDER BY ord ASC, id ASC`,
      [req.params.id]
    );

    res.json({ problem, testCases: testCasesResult.rows });
  } catch (err) {
    console.error('Problem detail error:', err);
    res.status(500).json({ error: 'Failed to fetch problem detail' });
  }
});

// POST /api/problems - create a new problem (teacher only)
router.post('/', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const { title, description, difficulty, starter_code_python, starter_code_cpp, starter_code_java, testCases } = req.body;
    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' });
    }
    if (!testCases || testCases.length === 0) {
      return res.status(400).json({ error: 'You must add at least one test case' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const problemResult = await client.query(
        `INSERT INTO problems (title, description, difficulty, starter_code_python, starter_code_cpp, starter_code_java, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          title.trim(),
          description,
          difficulty || 'medium',
          starter_code_python || '',
          starter_code_cpp || '',
          starter_code_java || '',
          req.user.id,
        ]
      );
      const problem = problemResult.rows[0];

      for (let i = 0; i < testCases.length; i++) {
        const tc = testCases[i];
        await client.query(
          `INSERT INTO test_cases (problem_id, input, expected_output, is_sample, ord)
           VALUES ($1, $2, $3, $4, $5)`,
          [problem.id, tc.input || '', tc.expected_output, !!tc.is_sample, i]
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
    console.error('Problem creation error:', err);
    res.status(500).json({ error: 'Failed to create problem' });
  }
});

// PUT /api/problems/:id - update a problem (teacher only)
router.put('/:id', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const { title, description, difficulty, starter_code_python, starter_code_cpp, starter_code_java } = req.body;
    const result = await pool.query(
      `UPDATE problems SET title = $1, description = $2, difficulty = $3,
       starter_code_python = $4, starter_code_cpp = $5, starter_code_java = $6
       WHERE id = $7 RETURNING *`,
      [title, description, difficulty, starter_code_python || '', starter_code_cpp || '', starter_code_java || '', req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Problem not found' });
    res.json({ problem: result.rows[0] });
  } catch (err) {
    console.error('Problem update error:', err);
    res.status(500).json({ error: 'Failed to update problem' });
  }
});

// DELETE /api/problems/:id (teacher only)
router.delete('/:id', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    await pool.query('DELETE FROM problems WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Problem deletion error:', err);
    res.status(500).json({ error: 'Failed to delete problem (it may be in use by an active exam)' });
  }
});

// POST /api/problems/:id/testcases - add a test case to a problem (teacher)
router.post('/:id/testcases', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const { input, expected_output, is_sample } = req.body;
    if (!expected_output) return res.status(400).json({ error: 'Expected output is required' });
    const result = await pool.query(
      `INSERT INTO test_cases (problem_id, input, expected_output, is_sample, ord)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(MAX(ord), -1) + 1 FROM test_cases WHERE problem_id = $1))
       RETURNING *`,
      [req.params.id, input || '', expected_output, !!is_sample]
    );
    res.status(201).json({ testCase: result.rows[0] });
  } catch (err) {
    console.error('Test case creation error:', err);
    res.status(500).json({ error: 'Failed to add test case' });
  }
});

// DELETE /api/problems/:id/testcases/:tcId (teacher)
router.delete('/:id/testcases/:tcId', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    await pool.query('DELETE FROM test_cases WHERE id = $1 AND problem_id = $2', [req.params.tcId, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Test case deletion error:', err);
    res.status(500).json({ error: 'Failed to delete test case' });
  }
});

module.exports = router;
