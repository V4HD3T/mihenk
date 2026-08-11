const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const access = require('../services/courseAccess.service');
const logger = require('../logger');

const router = express.Router();

// GET /api/courses - courses the caller can see (taught, or enrolled in)
router.get('/', requireAuth, async (req, res) => {
  try {
    const result =
      req.user.role === 'teacher'
        ? await pool.query(
            // Courses they own, plus the ones they assist with. `is_owner` is
            // returned because the interface has to know which of the two it is
            // showing - an assistant sees no course settings.
            `SELECT c.*, (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id) AS student_count,
                    (SELECT COUNT(*) FROM problems p WHERE p.course_id = c.id) AS problem_count,
                    (c.created_by = $1) AS is_owner
             FROM courses c
             WHERE c.created_by = $1
                OR EXISTS (SELECT 1 FROM course_staff cs
                           WHERE cs.course_id = c.id AND cs.user_id = $1)
             ORDER BY c.archived ASC, c.created_at DESC`,
            [req.user.id]
          )
        : await pool.query(
            `SELECT c.id, c.title, c.description, c.term, c.archived, c.created_at,
                    u.name AS teacher_name,
                    (SELECT COUNT(*) FROM problems p WHERE p.course_id = c.id) AS problem_count
             FROM courses c
             JOIN enrollments e ON e.course_id = c.id AND e.user_id = $1
             LEFT JOIN users u ON u.id = c.created_by
             ORDER BY c.archived ASC, c.created_at DESC`,
            [req.user.id]
          );
    res.json({ courses: result.rows });
  } catch (err) {
    logger.error({ err }, 'Course list failed');
    res.status(500).json({ error: 'Failed to fetch courses' });
  }
});

// POST /api/courses - create a course (teacher)
router.post(
  '/',
  requireAuth,
  requireRole('teacher'),
  validate({ body: schemas.createCourse }),
  async (req, res) => {
    try {
      const { title, description, term } = req.body;
      const joinCode = await access.allocateJoinCode();
      const result = await pool.query(
        `INSERT INTO courses (title, description, term, join_code, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [title, description, term, joinCode, req.user.id]
      );
      res.status(201).json({ course: result.rows[0] });
    } catch (err) {
      logger.error({ err }, 'Course creation failed');
      res.status(500).json({ error: 'Failed to create course' });
    }
  }
);

// GET /api/courses/:id - one course, if the caller may see it
router.get('/:id', requireAuth, validate({ params: schemas.idParam }), async (req, res) => {
  try {
    if (!(await access.canAccessCourse(req.user, req.params.id))) {
      return res.status(404).json({ error: 'Course not found' });
    }
    const result = await pool.query(
      `SELECT c.*, u.name AS teacher_name FROM courses c
       LEFT JOIN users u ON u.id = c.created_by WHERE c.id = $1`,
      [req.params.id]
    );
    const course = result.rows[0];
    // The join code is the credential for entering the course, so only the
    // teacher who owns it ever sees it.
    if (req.user.role !== 'teacher') delete course.join_code;
    res.json({ course });
  } catch (err) {
    logger.error({ err }, 'Course detail failed');
    res.status(500).json({ error: 'Failed to fetch course' });
  }
});

// PUT /api/courses/:id - update a course (owning teacher)
router.put(
  '/:id',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.idParam, body: schemas.updateCourse }),
  async (req, res) => {
    try {
      if (!(await access.ownsCourse(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Course not found' });
      }
      const { title, description, term, archived } = req.body;
      const result = await pool.query(
        `UPDATE courses SET title = COALESCE($2, title), description = COALESCE($3, description),
                            term = COALESCE($4, term), archived = COALESCE($5, archived)
         WHERE id = $1 RETURNING *`,
        [req.params.id, title, description, term, archived]
      );
      res.json({ course: result.rows[0] });
    } catch (err) {
      logger.error({ err }, 'Course update failed');
      res.status(500).json({ error: 'Failed to update course' });
    }
  }
);

// ---------------------------------------------------------------------------
// Teaching staff (owner only)
// ---------------------------------------------------------------------------

// GET /api/courses/:id/staff - who teaches this course besides the owner
router.get(
  '/:id/staff',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.idParam }),
  async (req, res) => {
    try {
      // Assistants may read the staff list - they need to know who else is on
      // it - but only the owner may change it.
      if (!(await access.teachesCourse(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Course not found' });
      }
      const result = await pool.query(
        `SELECT u.id AS user_id, u.name, u.email, s.added_at
         FROM course_staff s JOIN users u ON u.id = s.user_id
         WHERE s.course_id = $1 ORDER BY u.name`,
        [req.params.id]
      );
      const owner = await pool.query(
        `SELECT u.id AS user_id, u.name, u.email
         FROM courses c JOIN users u ON u.id = c.created_by WHERE c.id = $1`,
        [req.params.id]
      );
      res.json({ owner: owner.rows[0] || null, assistants: result.rows });
    } catch (err) {
      logger.error({ err }, 'Staff list failed');
      res.status(500).json({ error: 'Failed to fetch the teaching staff' });
    }
  }
);

// POST /api/courses/:id/staff - appoint an assistant (owner only)
router.post(
  '/:id/staff',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.idParam, body: schemas.addStaff }),
  async (req, res) => {
    try {
      // Owner, not merely staff: letting an assistant appoint assistants turns
      // a delegation into a takeover, and there would be no way back for the
      // owner short of the database.
      if (!(await access.ownsCourse(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Course not found' });
      }
      const email = req.body.email.trim().toLowerCase();
      const found = await pool.query('SELECT id, name, email, role FROM users WHERE email = $1', [
        email,
      ]);
      if (found.rows.length === 0) {
        return res.status(404).json({ error: 'No account with that address' });
      }
      const candidate = found.rows[0];

      // A student account cannot be staff. It would be able to read every
      // paper in the course before sitting it, and the seal that stops exactly
      // that is keyed on the role.
      if (candidate.role !== 'teacher') {
        return res.status(400).json({ error: 'Only a teacher account can assist with a course' });
      }
      const enrolled = await pool.query(
        'SELECT 1 FROM enrollments WHERE course_id = $1 AND user_id = $2',
        [req.params.id, candidate.id]
      );
      if (enrolled.rows.length > 0) {
        return res.status(400).json({ error: 'This person is enrolled in the course as a student' });
      }
      const { rows: courseRows } = await pool.query('SELECT created_by FROM courses WHERE id = $1', [
        req.params.id,
      ]);
      if (courseRows[0].created_by === candidate.id) {
        return res.status(400).json({ error: 'This person already owns the course' });
      }

      await pool.query(
        `INSERT INTO course_staff (course_id, user_id, added_by) VALUES ($1, $2, $3)
         ON CONFLICT (course_id, user_id) DO NOTHING`,
        [req.params.id, candidate.id, req.user.id]
      );
      res.status(201).json({
        assistant: { user_id: candidate.id, name: candidate.name, email: candidate.email },
      });
    } catch (err) {
      logger.error({ err }, 'Adding staff failed');
      res.status(500).json({ error: 'Failed to add the assistant' });
    }
  }
);

// DELETE /api/courses/:id/staff/:userId - stand an assistant down (owner only)
router.delete(
  '/:id/staff/:userId',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.courseUserParams }),
  async (req, res) => {
    try {
      if (!(await access.ownsCourse(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Course not found' });
      }
      await pool.query('DELETE FROM course_staff WHERE course_id = $1 AND user_id = $2', [
        req.params.id,
        req.params.userId,
      ]);
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'Removing staff failed');
      res.status(500).json({ error: 'Failed to remove the assistant' });
    }
  }
);

// POST /api/courses/:id/roster/import - enrol a list of students by email
//
// Enrols accounts that already exist and reports the addresses that do not.
// It deliberately does not create accounts: minting logins for people who have
// not signed up means choosing passwords for them and deciding on their behalf
// that they are in this system at all, which is a bigger step than a roster
// import should take on its own.
router.post(
  '/:id/roster/import',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.idParam, body: schemas.rosterImport }),
  async (req, res) => {
    try {
      if (!(await access.teachesCourse(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Course not found' });
      }
      if (await access.courseIsArchived(req.params.id)) {
        return res.status(403).json({ error: 'This course is archived and is no longer accepting changes' });
      }

      const emails = [...new Set(req.body.emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
      const found = await pool.query(
        `SELECT id, email, role FROM users WHERE email = ANY($1::text[])`,
        [emails]
      );
      const byEmail = new Map(found.rows.map((r) => [r.email, r]));

      const enrolled = [];
      const notFound = [];
      const notStudents = [];
      for (const email of emails) {
        const user = byEmail.get(email);
        if (!user) {
          notFound.push(email);
          continue;
        }
        // A teacher account in the student roster would be given a student's
        // view of a course they may also teach, which is two answers to the
        // same question.
        if (user.role !== 'student') {
          notStudents.push(email);
          continue;
        }
        const result = await pool.query(
          `INSERT INTO enrollments (course_id, user_id) VALUES ($1, $2)
           ON CONFLICT (course_id, user_id) DO NOTHING RETURNING user_id`,
          [req.params.id, user.id]
        );
        // Already enrolled counts as enrolled: importing the same list twice
        // must not read as a failure.
        if (result.rows.length > 0) enrolled.push(email);
      }

      res.json({
        enrolled,
        alreadyEnrolled: emails.length - enrolled.length - notFound.length - notStudents.length,
        notFound,
        notStudents,
      });
    } catch (err) {
      logger.error({ err }, 'Roster import failed');
      res.status(500).json({ error: 'Failed to import the roster' });
    }
  }
);

// POST /api/courses/join - a student enrolls with the code the teacher gave out
router.post('/join', requireAuth, validate({ body: schemas.joinCourse }), async (req, res) => {
  try {
    const joinCode = req.body.joinCode.trim().toUpperCase();
    const found = await pool.query('SELECT * FROM courses WHERE join_code = $1', [joinCode]);
    if (found.rows.length === 0) {
      return res.status(404).json({ error: 'No course found with that code' });
    }
    const course = found.rows[0];
    if (course.archived) {
      return res.status(403).json({ error: 'This course is archived and is not accepting new students' });
    }
    if (course.created_by === req.user.id) {
      return res.status(400).json({ error: 'You already teach this course' });
    }

    await pool.query(
      `INSERT INTO enrollments (course_id, user_id) VALUES ($1, $2)
       ON CONFLICT (course_id, user_id) DO NOTHING`,
      [course.id, req.user.id]
    );
    res.status(201).json({
      course: { id: course.id, title: course.title, description: course.description, term: course.term },
    });
  } catch (err) {
    logger.error({ err }, 'Course join failed');
    res.status(500).json({ error: 'Failed to join course' });
  }
});

// GET /api/courses/:id/roster - who is enrolled (owning teacher)
router.get(
  '/:id/roster',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.idParam }),
  async (req, res) => {
    try {
      if (!(await access.teachesCourse(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Course not found' });
      }
      const result = await pool.query(
        `SELECT u.id, u.name, u.email, e.enrolled_at,
                (SELECT COUNT(*) FROM submissions s
                  JOIN problems p ON p.id = s.problem_id
                  WHERE s.user_id = u.id AND p.course_id = $1) AS submission_count
         FROM enrollments e JOIN users u ON u.id = e.user_id
         WHERE e.course_id = $1
         ORDER BY u.name`,
        [req.params.id]
      );
      res.json({ students: result.rows });
    } catch (err) {
      logger.error({ err }, 'Roster fetch failed');
      res.status(500).json({ error: 'Failed to fetch roster' });
    }
  }
);

// DELETE /api/courses/:id/roster/:userId - unenroll a student (owning teacher)
router.delete(
  '/:id/roster/:userId',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.courseUserParams }),
  async (req, res) => {
    try {
      if (!(await access.teachesCourse(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Course not found' });
      }
      const result = await pool.query(
        'DELETE FROM enrollments WHERE course_id = $1 AND user_id = $2 RETURNING user_id',
        [req.params.id, req.params.userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'That student is not enrolled in this course' });
      }
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, 'Unenroll failed');
      res.status(500).json({ error: 'Failed to remove the student' });
    }
  }
);

// POST /api/courses/:id/regenerate-code - invalidate a leaked join code (owning teacher)
router.post(
  '/:id/regenerate-code',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.idParam }),
  async (req, res) => {
    try {
      if (!(await access.ownsCourse(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Course not found' });
      }
      const joinCode = await access.allocateJoinCode();
      const result = await pool.query(
        'UPDATE courses SET join_code = $2 WHERE id = $1 RETURNING join_code',
        [req.params.id, joinCode]
      );
      res.json({ joinCode: result.rows[0].join_code });
    } catch (err) {
      logger.error({ err }, 'Join code regeneration failed');
      res.status(500).json({ error: 'Failed to regenerate the join code' });
    }
  }
);

module.exports = router;
