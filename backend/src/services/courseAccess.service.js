/**
 * courseAccess.service.js
 *
 * One place that answers "which courses may this user see?", so the rule can't
 * drift between the twenty-odd queries that need it.
 *
 * The rule:
 *   teacher - the courses they created
 *   student - the courses they are enrolled in
 *
 * Before v0.0.5 there was no such rule: every authenticated user could read
 * every problem, exam and analytics row in the system. Anything that returns
 * course-owned content must go through a filter from this module.
 */

const pool = require('../config/db');

/**
 * A SQL fragment restricting `courseColumn` to what `user` may see, plus the
 * parameter to bind. Returned as a fragment rather than applied here so the
 * caller keeps one round trip instead of two.
 *
 * @example
 *   const scope = courseScope(req.user, 'p.course_id', 2);
 *   pool.query(`SELECT ... WHERE p.id = $1 AND ${scope.sql}`, [id, ...scope.params]);
 */
function courseScope(user, courseColumn, nextParamIndex) {
  if (user.role === 'teacher') {
    return {
      sql: `EXISTS (SELECT 1 FROM courses c WHERE c.id = ${courseColumn} AND c.created_by = $${nextParamIndex})`,
      params: [user.id],
    };
  }
  return {
    sql: `EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = ${courseColumn} AND e.user_id = $${nextParamIndex})`,
    params: [user.id],
  };
}

/** Course ids the user may see, for the cases where a list is easier than a join. */
async function accessibleCourseIds(user) {
  const { rows } =
    user.role === 'teacher'
      ? await pool.query('SELECT id FROM courses WHERE created_by = $1', [user.id])
      : await pool.query('SELECT course_id AS id FROM enrollments WHERE user_id = $1', [user.id]);
  return rows.map((r) => r.id);
}

/** Can this user act on this course at all? */
async function canAccessCourse(user, courseId) {
  if (user.role === 'teacher') {
    const { rows } = await pool.query(
      'SELECT 1 FROM courses WHERE id = $1 AND created_by = $2',
      [courseId, user.id]
    );
    return rows.length > 0;
  }
  const { rows } = await pool.query(
    'SELECT 1 FROM enrollments WHERE course_id = $1 AND user_id = $2',
    [courseId, user.id]
  );
  return rows.length > 0;
}

/** Only the owning teacher may modify a course's content. */
async function ownsCourse(user, courseId) {
  if (user.role !== 'teacher') return false;
  const { rows } = await pool.query(
    'SELECT 1 FROM courses WHERE id = $1 AND created_by = $2',
    [courseId, user.id]
  );
  return rows.length > 0;
}

async function canAccessProblem(user, problemId) {
  const scope = courseScope(user, 'p.course_id', 2);
  const { rows } = await pool.query(
    `SELECT 1 FROM problems p WHERE p.id = $1 AND ${scope.sql}`,
    [problemId, ...scope.params]
  );
  return rows.length > 0;
}

/**
 * May this teacher modify this problem?
 *
 * Being a teacher is not enough - before v0.0.5 any teacher could edit or
 * delete any problem in the system, including another teacher's. Ownership
 * runs through the problem's course.
 */
async function ownsProblem(user, problemId) {
  if (user.role !== 'teacher') return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM problems p JOIN courses c ON c.id = p.course_id
     WHERE p.id = $1 AND c.created_by = $2`,
    [problemId, user.id]
  );
  return rows.length > 0;
}

/** Same rule for exams. */
async function ownsExam(user, examId) {
  if (user.role !== 'teacher') return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM exams x JOIN courses c ON c.id = x.course_id
     WHERE x.id = $1 AND c.created_by = $2`,
    [examId, user.id]
  );
  return rows.length > 0;
}

async function canAccessExam(user, examId) {
  const scope = courseScope(user, 'x.course_id', 2);
  const { rows } = await pool.query(
    `SELECT 1 FROM exams x WHERE x.id = $1 AND ${scope.sql}`,
    [examId, ...scope.params]
  );
  return rows.length > 0;
}

/**
 * Human-friendly, unambiguous join codes.
 *
 * Excludes characters that get misread when a code is copied off a slide or
 * read aloud in a lecture: 0/O, 1/I/L.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateJoinCode(length = 8, random = () => Math.random()) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** Generates a code that isn't already taken. */
async function allocateJoinCode() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateJoinCode();
    const { rows } = await pool.query('SELECT 1 FROM courses WHERE join_code = $1', [code]);
    if (rows.length === 0) return code;
  }
  throw new Error('Could not allocate an unused course join code');
}

module.exports = {
  courseScope,
  accessibleCourseIds,
  canAccessCourse,
  ownsCourse,
  ownsProblem,
  ownsExam,
  canAccessProblem,
  canAccessExam,
  generateJoinCode,
  allocateJoinCode,
  CODE_ALPHABET,
};
