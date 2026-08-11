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

const crypto = require('crypto');
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

/**
 * A SQL fragment matching the exams `userParam` actually sits.
 *
 * An empty roster means the whole course sits the exam. That is not a special
 * case bolted on for compatibility - it is the common one, since most exams are
 * simply "everybody", and it means adding this table changed no existing exam.
 *
 * Written as a fragment against an exam-id column so it can be dropped into the
 * visibility gate, the exam list and the exam lookup without three subtly
 * different versions of the same rule.
 */
function examRosterSql(examIdColumn, userParam) {
  return `(
    NOT EXISTS (SELECT 1 FROM exam_roster sit_r WHERE sit_r.exam_id = ${examIdColumn})
    OR EXISTS (
      SELECT 1 FROM exam_roster sit_r2
      WHERE sit_r2.exam_id = ${examIdColumn} AND sit_r2.user_id = ${userParam}
    )
  )`;
}

/**
 * A SQL fragment that hides a scheduled exam's problems until it starts.
 *
 * Course membership alone is the wrong test for an exam paper: an exam's
 * problems belong to the course by construction, so every enrolled student
 * could read tomorrow's questions today - and, for a randomised exam, lock in
 * their deal early and revise exactly those. Course scope answers "may this
 * person ever see this?"; this answers "may they see it yet?".
 *
 * The rule: a problem in no exam is ordinary practice material and always
 * visible. A problem in one or more exams becomes visible once an exam holding
 * it *that this student sits* has started, and stays visible afterwards so they
 * can review their paper. Teachers are never gated - they write the things.
 *
 * The roster clause is what v0.1.2 could not write. Without it the question was
 * asked of the course rather than of the sitting, so a make-up exam a day later
 * had its paper published the moment the first sitting opened - to exactly the
 * students who had not taken it yet.
 *
 * Takes one bind parameter (the reader's user id), so callers pass the next
 * free index the way they already do for courseScope.
 */
function examGateSql(problemIdColumn, userParam) {
  return `(
    NOT EXISTS (SELECT 1 FROM exam_problems gate_ep WHERE gate_ep.problem_id = ${problemIdColumn})
    OR EXISTS (
      SELECT 1 FROM exam_problems gate_ep2
      JOIN exams gate_x ON gate_x.id = gate_ep2.exam_id
      WHERE gate_ep2.problem_id = ${problemIdColumn}
        AND gate_x.start_time <= NOW()
        AND ${examRosterSql('gate_x.id', userParam)}
    )
  )`;
}

/**
 * The gate, or an always-true fragment for teachers.
 *
 * Returns `{ sql, params }` like courseScope. Before v2.1.0 this returned a
 * bare string with no parameters; the roster clause needs to know who is
 * reading, and binding that is not optional in an authorisation path.
 */
function problemVisibility(user, problemIdColumn, nextParamIndex) {
  if (user.role === 'teacher') return { sql: 'TRUE', params: [] };
  return { sql: examGateSql(problemIdColumn, `$${nextParamIndex}`), params: [user.id] };
}

/**
 * Whether this user is entitled to sit this exam at all.
 *
 * Teachers are asked the ownership question instead: an exam they created is
 * theirs whether or not they appear on its roster.
 */
async function sitsExam(user, examId, client = pool) {
  if (user.role === 'teacher') return ownsExam(user, examId);
  const { rows } = await client.query(
    `SELECT 1 FROM exams x WHERE x.id = $1 AND ${examRosterSql('x.id', '$2')}`,
    [examId, user.id]
  );
  return rows.length > 0;
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
  const seen = problemVisibility(user, 'p.id', 2 + scope.params.length);
  const { rows } = await pool.query(
    `SELECT 1 FROM problems p
     WHERE p.id = $1 AND ${scope.sql} AND ${seen.sql}`,
    [problemId, ...scope.params, ...seen.params]
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

/**
 * Course scope and, for a student, the roster. An exam someone is not sitting
 * is not theirs to see at all - not its title, not when it runs. Anything less
 * would tell the main cohort that a second sitting of their paper exists.
 */
async function canAccessExam(user, examId) {
  const scope = courseScope(user, 'x.course_id', 2);
  const roster =
    user.role === 'teacher' ? 'TRUE' : examRosterSql('x.id', `$${2 + scope.params.length}`);
  const { rows } = await pool.query(
    `SELECT 1 FROM exams x WHERE x.id = $1 AND ${scope.sql} AND ${roster}`,
    user.role === 'teacher' ? [examId, ...scope.params] : [examId, ...scope.params, user.id]
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

/**
 * A join code is a capability: holding one enrols you in the course and opens
 * its problems and exams. That makes Math.random() the wrong source - V8's
 * generator is fast, not unpredictable, and its internal state can be
 * recovered from a handful of outputs, so a teacher who hands out several
 * codes would be publishing the seed for the next one. Guessing was never the
 * threat here (31^8 codes against a 300-request budget); predicting was.
 *
 * crypto.randomInt rejection-samples, so the 31-character alphabet stays
 * uniform - taking a random byte modulo 31 would quietly favour the first
 * eight letters.
 */
function generateJoinCode(length = 8) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
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
  examGateSql,
  examRosterSql,
  problemVisibility,
  sitsExam,
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
