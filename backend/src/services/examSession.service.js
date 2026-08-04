/**
 * examSession.service.js
 *
 * What a particular student's sitting of an exam looks like: which problems
 * they were dealt, and when their personal window closes.
 *
 * Both answers must be identical everywhere they're consulted. If the exam view
 * dealt one set of problems and the submit endpoint checked another, a student
 * could be shown a problem they're then refused permission to answer; if extra
 * time were honoured when loading the exam but not when submitting, the
 * accommodation would be worthless. Hence one module.
 */

const pool = require('../config/db');

/**
 * The problems this student is expected to answer.
 *
 * When the exam doesn't randomise (`problems_per_student IS NULL`) that's simply
 * every problem in it. When it does, the student is dealt a random subset the
 * first time they look, and that deal is stored - so a reload, a second device
 * or a later grading pass all see the same set, and the teacher can audit who
 * got what.
 */
async function assignedProblemIds(examId, userId, client = pool) {
  const examResult = await client.query(
    'SELECT problems_per_student FROM exams WHERE id = $1',
    [examId]
  );
  if (examResult.rows.length === 0) return [];
  const perStudent = examResult.rows[0].problems_per_student;

  const poolResult = await client.query(
    'SELECT problem_id FROM exam_problems WHERE exam_id = $1 ORDER BY problem_id',
    [examId]
  );
  const poolIds = poolResult.rows.map((r) => r.problem_id);

  if (!perStudent || perStudent >= poolIds.length) return poolIds;

  const existing = await client.query(
    'SELECT problem_id FROM exam_assignments WHERE exam_id = $1 AND user_id = $2 ORDER BY problem_id',
    [examId, userId]
  );
  if (existing.rows.length > 0) return existing.rows.map((r) => r.problem_id);

  const chosen = pickRandom(poolIds, perStudent);
  // ON CONFLICT DO NOTHING covers the race where the student opens the exam in
  // two tabs at once: the first deal wins and the second is discarded, rather
  // than the student ending up with two different sets.
  for (const problemId of chosen) {
    await client.query(
      `INSERT INTO exam_assignments (exam_id, user_id, problem_id)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [examId, userId, problemId]
    );
  }
  const settled = await client.query(
    'SELECT problem_id FROM exam_assignments WHERE exam_id = $1 AND user_id = $2 ORDER BY problem_id',
    [examId, userId]
  );
  return settled.rows.map((r) => r.problem_id);
}

/** Fisher-Yates over a copy; `random` is injectable so tests can be deterministic. */
function pickRandom(items, count, random = Math.random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, count).sort((a, b) => a - b);
}

/**
 * When this student's exam window closes, including any granted extra time.
 * Returns null if the exam doesn't exist.
 */
async function effectiveEndTime(examId, userId, client = pool) {
  const { rows } = await client.query(
    `SELECT x.end_time,
            COALESCE(a.extra_minutes, 0) AS extra_minutes
     FROM exams x
     LEFT JOIN exam_accommodations a ON a.exam_id = x.id AND a.user_id = $2
     WHERE x.id = $1`,
    [examId, userId]
  );
  if (rows.length === 0) return null;
  const { end_time, extra_minutes } = rows[0];
  return new Date(new Date(end_time).getTime() + Number(extra_minutes) * 60_000);
}

/**
 * Is this student allowed to be working on this exam right now?
 * Their personal end time is what counts, not the exam's nominal one.
 */
async function isWindowOpen(examId, userId, client = pool) {
  const { rows } = await client.query('SELECT start_time FROM exams WHERE id = $1', [examId]);
  if (rows.length === 0) return { open: false, reason: 'not_found' };

  const now = new Date();
  if (now < new Date(rows[0].start_time)) return { open: false, reason: 'not_started' };

  const end = await effectiveEndTime(examId, userId, client);
  if (now > end) return { open: false, reason: 'ended' };
  return { open: true, endsAt: end };
}

module.exports = { assignedProblemIds, effectiveEndTime, isWindowOpen, pickRandom };
