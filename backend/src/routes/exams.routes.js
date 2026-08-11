const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const access = require('../services/courseAccess.service');
const session = require('../services/examSession.service');
const logger = require('../logger');

const router = express.Router();

/**
 * Writes the paper: which problems, in what order, worth how much.
 *
 * Points are hand-set when supplied and otherwise divided evenly - `floor(100/n)`
 * threw the remainder away, so a three-problem paper was marked out of 99 and a
 * six-problem one out of 96. The leftover goes to the first problems, one each,
 * which keeps every problem within a point of every other and the paper worth
 * exactly 100.
 *
 * Position is the index in `problemIds`, so the array the teacher sent *is* the
 * order of the paper and no separate ordering field can drift out of step with it.
 */
async function writePaper(client, examId, problemIds, points) {
  const base = Math.floor(100 / problemIds.length);
  const remainder = 100 - base * problemIds.length;
  await client.query('DELETE FROM exam_problems WHERE exam_id = $1', [examId]);
  for (const [index, problemId] of problemIds.entries()) {
    const value = points ? points[index] : base + (index < remainder ? 1 : 0);
    await client.query(
      'INSERT INTO exam_problems (exam_id, problem_id, points, position) VALUES ($1, $2, $3, $4)',
      [examId, problemId, value, index]
    );
  }
}

/** Every problem on a paper must belong to the exam's own course. */
async function problemsBelongToCourse(problemIds, courseId) {
  const { rows } = await pool.query(
    'SELECT COUNT(DISTINCT id)::int AS n FROM problems WHERE id = ANY($1::int[]) AND course_id = $2',
    [problemIds, courseId]
  );
  return rows[0].n === new Set(problemIds).size;
}

/**
 * A roster may only name students enrolled in the exam's course.
 *
 * Otherwise it becomes a second, quieter enrolment path: adding an arbitrary
 * user id to a roster would hand them a course's paper without ever putting
 * them in the course.
 */
async function rosterNamesEnrolledStudents(userIds, courseId) {
  if (userIds.length === 0) return true;
  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT e.user_id)::int AS n
     FROM enrollments e JOIN users u ON u.id = e.user_id
     WHERE e.course_id = $1 AND e.user_id = ANY($2::int[]) AND u.role = 'student'`,
    [courseId, userIds]
  );
  return rows[0].n === new Set(userIds).size;
}

// POST /api/exams - create a new exam (teacher)
router.post('/', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const { course_id, title, description, start_time, end_time, duration_minutes, problem_ids, problems_per_student, points, late_window_minutes, late_penalty_percent, user_ids } = req.body;
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
    if (points && points.length !== problem_ids.length) {
      return res.status(400).json({ error: 'Give a mark for every problem, or none at all' });
    }

    // An exam may only contain problems from its own course - otherwise a
    // teacher could pull another course's problem into their exam and expose it.
    if (!(await problemsBelongToCourse(problem_ids, course_id))) {
      return res.status(400).json({ error: 'Every problem in an exam must belong to the same course' });
    }
    if (user_ids && !(await rosterNamesEnrolledStudents(user_ids, course_id))) {
      return res.status(400).json({ error: 'Everyone sitting an exam must be enrolled in its course' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const examResult = await client.query(
        `INSERT INTO exams (course_id, title, description, created_by, start_time, end_time, duration_minutes, problems_per_student, late_window_minutes, late_penalty_percent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
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
          late_window_minutes || 0,
          late_penalty_percent || 0,
        ]
      );
      const exam = examResult.rows[0];
      await writePaper(client, exam.id, problem_ids, points);
      for (const userId of user_ids || []) {
        await client.query(
          'INSERT INTO exam_roster (exam_id, user_id, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [exam.id, userId, req.user.id]
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
      //
      // And, since v2.1.0, only the sittings that are theirs: an exam with a
      // roster they are not on is not listed at all. Listing it without its
      // problems would still tell the main cohort that a second sitting of
      // their paper is scheduled, and when.
      query = `SELECT e.*, c.title AS course_title, COUNT(DISTINCT ep.problem_id) AS problem_count
               FROM exams e
               JOIN courses c ON c.id = e.course_id
               JOIN enrollments en ON en.course_id = e.course_id AND en.user_id = $1
               LEFT JOIN exam_problems ep ON ep.exam_id = e.id
               WHERE e.end_time >= NOW() - INTERVAL '1 day'
                 AND ${access.examRosterSql('e.id', '$1')}
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
    // A student not on the roster gets the same 404 as a student in another
    // course: "not yours" and "does not exist" stay indistinguishable.
    const roster =
      req.user.role === 'teacher'
        ? 'TRUE'
        : access.examRosterSql('x.id', `$${2 + scope.params.length}`);
    const examResult = await pool.query(
      `SELECT x.* FROM exams x WHERE x.id = $1 AND ${scope.sql} AND ${roster}`,
      req.user.role === 'teacher'
        ? [req.params.id, ...scope.params]
        : [req.params.id, ...scope.params, req.user.id]
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
      // The teacher's order, not the primary key's. A randomised paper keeps
      // the relative order of whatever subset the student was dealt.
      problemsResult = await pool.query(
        `SELECT p.id, p.title, p.difficulty, ep.points
         FROM exam_problems ep JOIN problems p ON p.id = ep.problem_id
         WHERE ep.exam_id = $1 AND p.id = ANY($2::int[])
         ORDER BY ep.position ASC, p.id ASC`,
        [req.params.id, assigned]
      );
    } else {
      problemsResult = await pool.query(
        `SELECT p.id, p.title, p.difficulty, ep.points
         FROM exam_problems ep JOIN problems p ON p.id = ep.problem_id
         WHERE ep.exam_id = $1 ORDER BY ep.position ASC, p.id ASC`,
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

// PUT /api/exams/:id - edit an exam (owning teacher)
//
// The paper is rewritten wholesale rather than diffed: a partial update of an
// ordered list is where "save" and "what is on screen" drift apart.
router.put(
  '/:id',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.idParam, body: schemas.updateExam }),
  async (req, res) => {
    try {
      if (!(await access.ownsExam(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Exam not found' });
      }
      const { title, description, start_time, end_time, duration_minutes, problem_ids, points, problems_per_student, late_window_minutes, late_penalty_percent } = req.body;
      if (new Date(start_time) >= new Date(end_time)) {
        return res.status(400).json({ error: 'End time must be after start time' });
      }
      if (points && points.length !== problem_ids.length) {
        return res.status(400).json({ error: 'Give a mark for every problem, or none at all' });
      }

      const { rows: examRows } = await pool.query('SELECT course_id FROM exams WHERE id = $1', [
        req.params.id,
      ]);
      const courseId = examRows[0].course_id;
      if (!(await problemsBelongToCourse(problem_ids, courseId))) {
        return res.status(400).json({ error: 'Every problem in an exam must belong to the same course' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const updated = await client.query(
          `UPDATE exams SET title = $1, description = $2, start_time = $3, end_time = $4,
                            duration_minutes = $5, problems_per_student = $6,
                            late_window_minutes = $7, late_penalty_percent = $8
           WHERE id = $9 RETURNING *`,
          [
            title.trim(),
            description || '',
            start_time,
            end_time,
            duration_minutes,
            problems_per_student && problems_per_student < problem_ids.length
              ? problems_per_student
              : null,
            late_window_minutes || 0,
            late_penalty_percent || 0,
            req.params.id,
          ]
        );
        await writePaper(client, req.params.id, problem_ids, points);
        // A problem dropped from the paper leaves deals behind that name it, and
        // a student holding one would be shown a question no longer on the exam.
        await client.query(
          'DELETE FROM exam_assignments WHERE exam_id = $1 AND NOT (problem_id = ANY($2::int[]))',
          [req.params.id, problem_ids]
        );
        await client.query('COMMIT');
        res.json({ exam: updated.rows[0] });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      logger.error({ err }, 'Exam update failed');
      res.status(500).json({ error: 'Failed to update the exam' });
    }
  }
);

// GET /api/exams/:id/roster - who sits this exam (owning teacher)
router.get(
  '/:id/roster',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.idParam }),
  async (req, res) => {
    try {
      if (!(await access.ownsExam(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Exam not found' });
      }
      const result = await pool.query(
        `SELECT r.user_id, u.name, u.email, r.added_at
         FROM exam_roster r JOIN users u ON u.id = r.user_id
         WHERE r.exam_id = $1 ORDER BY u.name`,
        [req.params.id]
      );
      // whole_course is the difference between "nobody sits this" and "everybody
      // does", which an empty array alone cannot say.
      res.json({ roster: result.rows, whole_course: result.rows.length === 0 });
    } catch (err) {
      logger.error({ err }, 'Roster list failed');
      res.status(500).json({ error: 'Failed to fetch the roster' });
    }
  }
);

// PUT /api/exams/:id/roster - set who sits this exam. An empty list hands the
// exam back to the whole course.
router.put(
  '/:id/roster',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.idParam, body: schemas.examRoster }),
  async (req, res) => {
    try {
      if (!(await access.ownsExam(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Exam not found' });
      }
      const userIds = [...new Set(req.body.user_ids)];
      const { rows: examRows } = await pool.query('SELECT course_id FROM exams WHERE id = $1', [
        req.params.id,
      ]);
      if (!(await rosterNamesEnrolledStudents(userIds, examRows[0].course_id))) {
        return res.status(400).json({ error: 'Everyone sitting an exam must be enrolled in its course' });
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM exam_roster WHERE exam_id = $1', [req.params.id]);
        for (const userId of userIds) {
          await client.query(
            'INSERT INTO exam_roster (exam_id, user_id, added_by) VALUES ($1, $2, $3)',
            [req.params.id, userId, req.user.id]
          );
        }
        // Someone taken off the roster keeps neither their deal nor their extra
        // time: leaving the deal behind would re-deal them the same subset if
        // they were added back, which is a way to choose a student's questions.
        await client.query(
          'DELETE FROM exam_assignments WHERE exam_id = $1 AND NOT (user_id = ANY($2::int[]))',
          [req.params.id, userIds]
        );
        await client.query('COMMIT');
        res.json({ roster: userIds, whole_course: userIds.length === 0 });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      logger.error({ err }, 'Roster update failed');
      res.status(500).json({ error: 'Failed to save the roster' });
    }
  }
);

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
              o.feedback AS override_feedback, o.graded_at AS override_at,
              -- The penalty that applies is the one attached to the best
              -- attempt, not the worst thing the student ever did: a late
              -- resubmission does not retroactively dock an on-time answer.
              (ARRAY_AGG(s.is_late ORDER BY s.passed_count DESC, s.submitted_at ASC))[1] AS is_late,
              (ARRAY_AGG(s.late_penalty_percent ORDER BY s.passed_count DESC, s.submitted_at ASC))[1] AS late_penalty_percent
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

    const results = result.rows.map((row) => {
      const autoScore = Number(row.best_passed);
      const penalty = row.is_late ? Number(row.late_penalty_percent || 0) : 0;
      // Rounded up, so a penalty never costs more than it says it does.
      const afterPenalty = Math.ceil(autoScore * (1 - penalty / 100));
      return {
        ...row,
        is_late: Boolean(row.is_late),
        late_penalty_percent: penalty,
        // Kept beside the penalised figure so a teacher can see what the
        // lateness cost before deciding whether to waive it.
        auto_score: autoScore,
        // What the grade actually is, after the late penalty and any override.
        // An override is a deliberate human decision and outranks the penalty -
        // it is how a teacher waives one.
        final_score: row.override_score ?? afterPenalty,
        final_max: row.override_max ?? Number(row.total_count),
        is_overridden: row.override_score !== null,
      };
    });
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
