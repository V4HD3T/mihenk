const express = require('express');
const pool = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { computeFingerprint, compareFingerprints, getMatchedSpans, computeClassReport } = require('../services/similarity.service');
const { validate } = require('../middleware/validate');
const schemas = require('../validation/schemas');
const access = require('../services/courseAccess.service');
const session = require('../services/examSession.service');
const logger = require('../logger');

const router = express.Router();

// Unlike the class report, there is no useful class-relative baseline here: the
// archive spans different cohorts and problems, so a fixed floor is used. It is
// deliberately high - this surfaces likely reuse for a human to look at, and a
// noisy cross-year report would just be ignored.
const ARCHIVE_MATCH_THRESHOLD = 70;

// A fingerprint this small carries no real signal. A one-line program yields
// about five hashes, and any of them appearing in a longer program would
// otherwise read as reuse.
const ARCHIVE_MIN_FINGERPRINT = 10;

/**
 * How alike two submissions are, for the purpose of accusing someone.
 *
 * compareFingerprints() reports max(percentA, percentB), which is right for the
 * class report - there, a uniformly high score across a trivial problem is
 * cancelled out by the class-relative median. The archive has no such baseline,
 * and max() is badly behaved when the two submissions differ in size: a short
 * program whose whole fingerprint happens to sit inside a longer one scores
 * 100%. Measured on a one-line program against a twelve-line solution that
 * shares the `map(int, input().split())` idiom: max 100%, min 14%. A genuine
 * renamed copy of the same solution scores 94% either way.
 *
 * So the archive requires the shared part to be a large fraction of *both*
 * submissions. A false accusation is far more costly here than a missed match.
 */
function archiveSimilarity(a, b) {
  if (a.length < ARCHIVE_MIN_FINGERPRINT || b.length < ARCHIVE_MIN_FINGERPRINT) return 0;
  const cmp = compareFingerprints(a, b);
  return Math.min(cmp.percentA, cmp.percentB);
}

// ---------------------------------------------------------------------------
// Code similarity ("plagiarism screening")
// ---------------------------------------------------------------------------

// GET /api/integrity/problem/:id/similarity - class-wide pairwise similarity report (teacher)
router.get('/problem/:id/similarity', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    if (!(await access.ownsProblem(req.user, req.params.id))) {
      return res.status(404).json({ error: 'Problem not found' });
    }
    // Latest submission per (student, language) for this problem - comparing a student's
    // own drafts against each other would be noise, and cross-language comparison is meaningless.
    const result = await pool.query(
      `SELECT DISTINCT ON (s.user_id, s.language)
              s.id AS submission_id, s.user_id, s.language, s.code, u.name AS user_name
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       WHERE s.problem_id = $1
       ORDER BY s.user_id, s.language, s.submitted_at DESC`,
      [req.params.id]
    );

    const byLanguage = {};
    for (const row of result.rows) {
      (byLanguage[row.language] ||= []).push({
        submissionId: row.submission_id,
        userId: row.user_id,
        userName: row.user_name,
        language: row.language,
        code: row.code,
      });
    }

    const groups = Object.entries(byLanguage)
      .filter(([, subs]) => subs.length >= 2)
      .map(([language, subs]) => ({ language, submissionCount: subs.length, ...computeClassReport(subs) }));

    res.json({ groups });
  } catch (err) {
    logger.error({ err }, 'Similarity report failed');
    res.status(500).json({ error: 'Failed to compute similarity report' });
  }
});

// GET /api/integrity/compare/:idA/:idB - side-by-side comparison with highlighted matches (teacher)
router.get('/compare/:idA/:idB', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    // Restricted to submissions inside this teacher's own courses, so a
    // guessed submission id can't be used to read another course's code.
    const result = await pool.query(
      `SELECT s.id, s.code, s.language, s.problem_id, u.name AS user_name
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       JOIN problems p ON p.id = s.problem_id
       JOIN courses c ON c.id = p.course_id AND c.created_by = $3
       WHERE s.id IN ($1, $2)`,
      [req.params.idA, req.params.idB, req.user.id]
    );
    if (result.rows.length !== 2) return res.status(404).json({ error: 'One or both submissions were not found' });

    const [a, b] = result.rows[0].id === Number(req.params.idA) ? result.rows : [result.rows[1], result.rows[0]];
    if (a.problem_id !== b.problem_id) {
      return res.status(400).json({ error: 'Submissions belong to different problems and cannot be compared' });
    }
    if (a.language !== b.language) {
      return res.status(400).json({ error: 'Submissions are in different languages and cannot be meaningfully compared' });
    }

    const fpA = computeFingerprint(a.code, a.language);
    const fpB = computeFingerprint(b.code, b.language);
    const cmp = compareFingerprints(fpA.fingerprints, fpB.fingerprints);

    res.json({
      similarity: Math.round(cmp.similarity * 10) / 10,
      submissionA: {
        id: a.id,
        userName: a.user_name,
        language: a.language,
        code: a.code,
        matchedSpans: getMatchedSpans(fpA.fingerprints, cmp.shared),
      },
      submissionB: {
        id: b.id,
        userName: b.user_name,
        language: b.language,
        code: b.code,
        matchedSpans: getMatchedSpans(fpB.fingerprints, cmp.shared),
      },
    });
  } catch (err) {
    logger.error({ err }, 'Comparison failed');
    res.status(500).json({ error: 'Failed to compare submissions' });
  }
});

// ---------------------------------------------------------------------------
// Exam-session monitoring (tab-switches, pastes)
// ---------------------------------------------------------------------------

// POST /api/integrity/events - the client reports one of its own integrity events
router.post('/events', requireAuth, validate({ body: schemas.integrityEvent }), async (req, res) => {
  try {
    const { exam_id, problem_id, event_type, detail } = req.body;

    const scope = access.courseScope(req.user, 'x.course_id', 2);
    const examResult = await pool.query(
      `SELECT x.* FROM exams x WHERE x.id = $1 AND ${scope.sql}`,
      [exam_id, ...scope.params]
    );
    if (examResult.rows.length === 0) return res.status(404).json({ error: 'Exam not found' });

    // Uses the student's effective window, so a student working in granted
    // extra time is still monitored rather than silently unlogged.
    const window = await session.isWindowOpen(exam_id, req.user.id);
    if (!window.open) {
      // Outside the exam window: silently accept without logging, nothing to monitor.
      return res.status(204).end();
    }

    await pool.query(
      `INSERT INTO integrity_events (user_id, exam_id, problem_id, event_type, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user.id, exam_id, problem_id || null, event_type, detail ? String(detail).slice(0, 500) : null]
    );
    res.status(201).json({ success: true });
  } catch (err) {
    logger.error({ err }, 'Integrity event logging failed');
    res.status(500).json({ error: 'Failed to log integrity event' });
  }
});

// ---------------------------------------------------------------------------
// Cross-semester archive
// ---------------------------------------------------------------------------

// POST /api/integrity/archive/course/:id - keep a finished course's submissions
// for screening future cohorts against.
router.post(
  '/archive/course/:id',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.idParam, body: schemas.archiveCourse }),
  async (req, res) => {
    try {
      if (!(await access.ownsCourse(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Course not found' });
      }

      const course = await pool.query('SELECT title, term FROM courses WHERE id = $1', [
        req.params.id,
      ]);
      const label =
        req.body.source_label ||
        [course.rows[0].title, course.rows[0].term].filter(Boolean).join(' - ');

      // Latest submission per (student, problem, language): a student's own
      // earlier drafts add nothing but noise to a future comparison.
      const submissions = await pool.query(
        `SELECT DISTINCT ON (s.user_id, s.problem_id, s.language)
                s.code, s.language, p.title AS problem_title, u.name AS user_name
         FROM submissions s
         JOIN problems p ON p.id = s.problem_id
         JOIN users u ON u.id = s.user_id
         WHERE p.course_id = $1
         ORDER BY s.user_id, s.problem_id, s.language, s.submitted_at DESC`,
        [req.params.id]
      );

      let archived = 0;
      for (const row of submissions.rows) {
        const { fingerprints } = computeFingerprint(row.code, row.language);
        if (!fingerprints.length) continue;
        await pool.query(
          `INSERT INTO archived_submissions
             (source_label, problem_title, student_label, language, code, fingerprints, owner_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            label,
            row.problem_title,
            // Kept for the teacher to recognise a repeat offender; the archive
            // is theirs alone and is not shown to students.
            row.user_name,
            row.language,
            row.code,
            JSON.stringify(fingerprints),
            req.user.id,
          ]
        );
        archived++;
      }

      res.status(201).json({ archived, sourceLabel: label });
    } catch (err) {
      logger.error({ err }, 'Archiving course failed');
      res.status(500).json({ error: 'Failed to archive the course' });
    }
  }
);

// GET /api/integrity/archive - what this teacher has archived
router.get('/archive', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT source_label, COUNT(*)::int AS submissions,
              COUNT(DISTINCT problem_title)::int AS problems, MAX(archived_at) AS archived_at
       FROM archived_submissions WHERE owner_id = $1
       GROUP BY source_label ORDER BY MAX(archived_at) DESC`,
      [req.user.id]
    );
    res.json({ archives: result.rows });
  } catch (err) {
    logger.error({ err }, 'Archive listing failed');
    res.status(500).json({ error: 'Failed to list the archive' });
  }
});

// DELETE /api/integrity/archive/:label - drop one archived cohort
router.delete('/archive/:label', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM archived_submissions WHERE owner_id = $1 AND source_label = $2 RETURNING id',
      [req.user.id, req.params.label]
    );
    res.json({ deleted: result.rows.length });
  } catch (err) {
    logger.error({ err }, 'Archive deletion failed');
    res.status(500).json({ error: 'Failed to delete from the archive' });
  }
});

// GET /api/integrity/problem/:id/archive-matches - screen this problem's current
// submissions against previous cohorts.
router.get(
  '/problem/:id/archive-matches',
  requireAuth,
  requireRole('teacher'),
  validate({ params: schemas.idParam }),
  async (req, res) => {
    try {
      if (!(await access.ownsProblem(req.user, req.params.id))) {
        return res.status(404).json({ error: 'Problem not found' });
      }

      const current = await pool.query(
        `SELECT DISTINCT ON (s.user_id, s.language)
                s.id AS submission_id, s.user_id, s.language, s.code, u.name AS user_name
         FROM submissions s JOIN users u ON u.id = s.user_id
         WHERE s.problem_id = $1
         ORDER BY s.user_id, s.language, s.submitted_at DESC`,
        [req.params.id]
      );
      if (current.rows.length === 0) return res.json({ matches: [] });

      // Only this teacher's archive, and only the same language - comparing
      // across languages is meaningless for a token-based fingerprint.
      const languages = [...new Set(current.rows.map((r) => r.language))];
      const archive = await pool.query(
        `SELECT id, source_label, problem_title, student_label, language, fingerprints
         FROM archived_submissions
         WHERE owner_id = $1 AND language = ANY($2::language_type[])`,
        [req.user.id, languages]
      );

      const matches = [];
      for (const sub of current.rows) {
        const mine = computeFingerprint(sub.code, sub.language).fingerprints;
        for (const old of archive.rows) {
          if (old.language !== sub.language) continue;
          const similarity = archiveSimilarity(mine, old.fingerprints);
          if (similarity >= ARCHIVE_MATCH_THRESHOLD) {
            matches.push({
              submissionId: sub.submission_id,
              userId: sub.user_id,
              userName: sub.user_name,
              language: sub.language,
              similarity: Math.round(similarity * 10) / 10,
              archivedFrom: old.source_label,
              archivedProblem: old.problem_title,
              archivedStudent: old.student_label,
            });
          }
        }
      }

      matches.sort((a, b) => b.similarity - a.similarity);
      res.json({ matches, archiveSize: archive.rows.length, threshold: ARCHIVE_MATCH_THRESHOLD });
    } catch (err) {
      logger.error({ err }, 'Archive screening failed');
      res.status(500).json({ error: 'Failed to screen against the archive' });
    }
  }
);

// GET /api/integrity/exam/:id - per-student integrity summary for an exam (teacher)
router.get('/exam/:id', requireAuth, requireRole('teacher'), async (req, res) => {
  try {
    if (!(await access.ownsExam(req.user, req.params.id))) {
      return res.status(404).json({ error: 'Exam not found' });
    }
    const result = await pool.query(
      `SELECT u.id AS user_id, u.name, u.email,
              COUNT(*) FILTER (WHERE ie.event_type = 'tab_hidden') AS tab_hidden_count,
              COUNT(*) FILTER (WHERE ie.event_type = 'paste') AS paste_count,
              COUNT(*) FILTER (WHERE ie.event_type = 'fullscreen_exit') AS fullscreen_exit_count,
              MAX(ie.occurred_at) AS last_event_at
       FROM integrity_events ie
       JOIN users u ON u.id = ie.user_id
       WHERE ie.exam_id = $1
       GROUP BY u.id, u.name, u.email
       ORDER BY COUNT(*) DESC`,
      [req.params.id]
    );
    res.json({ summary: result.rows });
  } catch (err) {
    logger.error({ err }, 'Exam integrity summary failed');
    res.status(500).json({ error: 'Failed to fetch exam integrity summary' });
  }
});

module.exports = router;
