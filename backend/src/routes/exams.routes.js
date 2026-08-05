const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const access = require('../services/courseAccess.service');
const session = require('../services/examSession.service');
const logger = require('../logger');

const router = express.Router();

// POST /api/exams - create a new exam (teacher)
router.post('/', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const { course_id, title, description, start_time, end_time, duration_minutes, problem_ids, problems_per_student } = req.body;
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
        `INSERT INTO exams (course_id, title, description, created_by, start_time, end_time, duration_minutes, problems_per_student)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          course_id,
          title.trim(),
          description || '',
          req.user.id,
          start_time,
          end_time,
          duration_minutes,
          // Only meaningful when it actually narrows the pool.
          problems_per_student && problems_per_student < problem_ids.length
            ? problems_per_student
            : null,
        ]
      );
      const exam = examResult.rows[0];
      // floor(100/n) threw the remainder away, so a three-problem paper was
      // marked out of 99 and a six-problem one out of 96. The leftover points
      // go to the first problems, one each, which keeps every problem within a
      // point of every other and the paper worth exactly 100.
      const base = Math.floor(100 / problem_ids.length);
      const remainder = 100 - base * problem_ids.length;
      for (const [index, problemId] of problem_ids.entries()) {
        await client.query(
          'INSERT INTO exam_problems (exam_id, problem_id, points) VALUES ($1, $2, $3)',
          [exam.id, problemId, base + (index < remainder ? 1 : 0)]
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

    // Students see only the problems they were dealt (identical to the full
    // pool unless the exam randomises); teachers see the whole pool.
    //
    // Nothing is dealt or listed before the exam opens. Calling
    // assignedProblemIds early would not just leak the titles: on a randomised
    // exam it writes the deal, so a student who looked the night before had
    // their personal subset settled and could revise only those.
    const started = req.user.role === 'teacher' || (await session.hasStarted(req.params.id));

    let problemsResult = { rows: [] };
    if (!started) {
      // Fall through with an empty list - the exam itself, and when it starts,
      // is information the student needs.
    } else if (req.user.role === 'student') {
      const assigned = await session.assignedProblemIds(req.params.id, req.user.id);
      problemsResult = await pool.query(
        `SELECT p.id, p.title, p.difficulty, ep.points
         FROM exam_problems ep JOIN problems p ON p.id = ep.problem_id
         WHERE ep.exam_id = $1 AND p.id = ANY($2::int[]) ORDER BY p.id ASC`,
        [req.params.id, assigned]
      );
    } else {
      problemsResult = await pool.query(
        `SELECT p.id, p.title, p.difficulty, ep.points
         FROM exam_problems ep JOIN problems p ON p.id = ep.problem_id
         WHERE ep.exam_id = $1 ORDER BY p.id ASC`,
        [req.params.id]
      );
    }

    let myProgress = [];
    if (req.user.role === 'student') {
      const progressResult = await pool.query(
        `SELECT problem_id, MAX(passed_count) AS best_passed, MAX(total_count) AS total_count
         FROM submissions WHERE exam_id = $1 AND user_id = $2 GROUP BY problem_id`,
        [req.params.id, req.user.id]
      );
      myProgress = progressResult.rows;
    }

    // The student's own deadline, which may include an accommodation. The
    // client counts down against this, not the exam's nominal end_time.
    const endsAt =
      req.user.role === 'student'
        ? await session.effectiveEndTime(req.params.id, req.user.id)
        : null;

    res.json({
      exam: examResult.rows[0],
      problems: problemsResult.rows,
      myProgress,
      endsAt,
    });
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
    // A manual override, where one exists, replaces the auto-graded score -
    // but the auto score is still returned alongside it so the teacher can see
    // what they changed and by how much.
    const result = await pool.query(
      `SELECT u.id AS user_id, u.name, u.email,
              p.id AS problem_id, p.title AS problem_title,
              MAX(s.passed_count) AS best_passed, MAX(s.total_count) AS total_count,
              o.score AS override_score, o.max_score AS override_max,
              o.feedback AS override_feedback, o.graded_at AS override_at
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       JOIN problems p ON p.id = s.problem_id
       LEFT JOIN exam_grade_overrides o
         ON o.exam_id = s.exam_id AND o.user_id = s.user_id AND o.problem_id = s.problem_id
       WHERE s.exam_id = $1
       GROUP BY u.id, u.name, u.email, p.id, p.title,
                o.score, o.max_score, o.feedback, o.graded_at
       ORDER BY u.name ASC, p.id ASC`,
      [req.params.id]
    );

    const results = result.rows.map((row) => ({
      ...row,
      // What the grade actually is, after any override.
      final_score: row.override_score ?? Number(row.best_passed),
      final_max: row.override_max ?? Number(row.total_count),
      is_overridden: row.override_score !== null,
    }));
    res.json({ results });
  } catch (err) {
    logger.error({ err }, 'Exam results failed');
    res.status(500).json({ error: 'Failed to fetch exam results' });
  }
});

// ---------------------------------------------------------------------------
// Accommodations, grade overrides and pool assignments (owning teacher)
// ---------------------------------------------------------------------------

// GET /api/exams/:id/accommodations - who has extra time on this exam
router.get(
  '/:id/accommodations',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.idParam }),
  async (req, res) => {
    try {
      if (!(await access.ownsExam(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Exam not found' });
      }
      const result = await pool.query(
        `SELECT a.user_id, u.name, u.email, a.extra_minutes, a.note, a.created_at
         FROM exam_accommodations a JOIN users u ON u.id = a.user_id
         WHERE a.exam_id = $1 ORDER BY u.name`,
        [req.params.id]
      );
      res.json({ accommodations: result.rows });
    } catch (err) {
      logger.error({ err }, 'Accommodation list failed');
      res.status(500).json({ error: 'Failed to fetch accommodations' });
    }
  }
);

// PUT /api/exams/:id/accommodations/:userId - grant or change extra time.
// extra_minutes = 0 removes it.
router.put(
  '/:id/accommodations/:userId',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.examUserParams, body: schemas.accommodation }),
  async (req, res) => {
    try {
      if (!(await access.ownsExam(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Exam not found' });
      }
      const { extra_minutes, note } = req.body;

      if (extra_minutes === 0) {
        await pool.query('DELETE FROM exam_accommodations WHERE exam_id = $1 AND user_id = $2', [
          req.params.id,
          req.params.userId,
        ]);
        return res.json({ removed: true });
      }

      const result = await pool.query(
        `INSERT INTO exam_accommodations (exam_id, user_id, extra_minutes, note, granted_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (exam_id, user_id)
         DO UPDATE SET extra_minutes = EXCLUDED.extra_minutes, note = EXCLUDED.note,
                       granted_by = EXCLUDED.granted_by, created_at = NOW()
         RETURNING *`,
        [req.params.id, req.params.userId, extra_minutes, note, req.user.id]
      );
      res.json({ accommodation: result.rows[0] });
    } catch (err) {
      logger.error({ err }, 'Granting accommodation failed');
      res.status(500).json({ error: 'Failed to save the accommodation' });
    }
  }
);

// PUT /api/exams/:id/grades/:userId/:problemId - override the automatic grade
router.put(
  '/:id/grades/:userId/:problemId',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.gradeParams, body: schemas.gradeOverride }),
  async (req, res) => {
    try {
      if (!(await access.ownsExam(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Exam not found' });
      }
      const { score, max_score, feedback } = req.body;
      if (score > max_score) {
        return res.status(400).json({ error: 'Score cannot be greater than the maximum' });
      }
      const result = await pool.query(
        `INSERT INTO exam_grade_overrides (exam_id, user_id, problem_id, score, max_score, feedback, graded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (exam_id, user_id, problem_id)
         DO UPDATE SET score = EXCLUDED.score, max_score = EXCLUDED.max_score,
                       feedback = EXCLUDED.feedback, graded_by = EXCLUDED.graded_by, graded_at = NOW()
         RETURNING *`,
        [req.params.id, req.params.userId, req.params.problemId, score, max_score, feedback, req.user.id]
      );
      res.json({ override: result.rows[0] });
    } catch (err) {
      logger.error({ err }, 'Grade override failed');
      res.status(500).json({ error: 'Failed to save the grade' });
    }
  }
);

// DELETE /api/exams/:id/grades/:userId/:problemId - fall back to the auto grade
router.delete(
  '/:id/grades/:userId/:problemId',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.gradeParams }),
  async (req, res) => {
    try {
      if (!(await access.ownsExam(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Exam not found' });
      }
      await pool.query(
        'DELETE FROM exam_grade_overrides WHERE exam_id = $1 AND user_id = $2 AND problem_id = $3',
        [req.params.id, req.params.userId, req.params.problemId]
      );
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'Removing grade override failed');
      res.status(500).json({ error: 'Failed to remove the grade override' });
    }
  }
);

// GET /api/exams/:id/assignments - who was dealt which problems, for auditing a
// randomised exam when a student questions their paper
router.get(
  '/:id/assignments',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.idParam }),
  async (req, res) => {
    try {
      if (!(await access.ownsExam(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Exam not found' });
      }
      const result = await pool.query(
        `SELECT a.user_id, u.name, u.email,
                ARRAY_AGG(p.title ORDER BY p.id) AS problems,
                ARRAY_AGG(p.id ORDER BY p.id) AS problem_ids
         FROM exam_assignments a
         JOIN users u ON u.id = a.user_id
         JOIN problems p ON p.id = a.problem_id
         WHERE a.exam_id = $1
         GROUP BY a.user_id, u.name, u.email
         ORDER BY u.name`,
        [req.params.id]
      );
      res.json({ assignments: result.rows });
    } catch (err) {
      logger.error({ err }, 'Assignment list failed');
      res.status(500).json({ error: 'Failed to fetch assignments' });
    }
  }
);

module.exports = router;
