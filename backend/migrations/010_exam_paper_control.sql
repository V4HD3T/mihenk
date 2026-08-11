-- Migration 010: Per-exam rosters, paper ordering, hand-set points and a late
-- window (v2.1.0)
--
-- Additive throughout. Every column has a default that reproduces the previous
-- behaviour exactly, and an exam with no roster row is sat by the whole course -
-- which is what every exam that exists today is.
-- Usage: npm run migrate

-- ---------------------------------------------------------------------------
-- Who sits this exam
-- ---------------------------------------------------------------------------
-- v0.1.2 sealed an exam's problems until it starts, and recorded what it could
-- not fix: an exam has no roster, so "has it started" is asked of the course
-- rather than of the sitting. Two sittings of one paper - a make-up a day later
-- - therefore share visibility, and the first one opening publishes the paper
-- to everyone still due to take it.
--
-- Emptiness is meaningful here. No rows means the whole course sits the exam,
-- which keeps every existing exam behaving as it does today; rows mean exactly
-- those students sit it and nobody else in the course can see it at all.
CREATE TABLE IF NOT EXISTS exam_roster (
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (exam_id, user_id)
);

-- The gate asks "does this student sit an exam holding this problem, and has it
-- started" on every problem read, so both directions of the lookup are hot.
CREATE INDEX IF NOT EXISTS idx_exam_roster_user ON exam_roster (user_id, exam_id);

-- ---------------------------------------------------------------------------
-- The order of the paper
-- ---------------------------------------------------------------------------
-- Problems came back ordered by primary key, so a paper ran in the order its
-- questions happened to be written rather than the order the teacher wanted to
-- ask them - and a warm-up added last sorted to the end.
ALTER TABLE exam_problems ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

-- Backfill preserves what existing papers currently look like: ordering by
-- position then problem_id leaves an all-zero exam in exactly the order it is
-- displayed in today, but writing the ranks out means a teacher editing an old
-- exam gets a paper that is already in a definite order rather than one that
-- silently reshuffles on first save.
WITH ranked AS (
  SELECT exam_id, problem_id,
         ROW_NUMBER() OVER (PARTITION BY exam_id ORDER BY problem_id) - 1 AS rank
  FROM exam_problems
)
UPDATE exam_problems ep
SET position = ranked.rank
FROM ranked
WHERE ep.exam_id = ranked.exam_id AND ep.problem_id = ranked.problem_id;

-- ---------------------------------------------------------------------------
-- Late submissions
-- ---------------------------------------------------------------------------
-- Until now an exam either accepted a submission or refused it, so a student
-- whose upload landed forty seconds after the deadline was in the same position
-- as one who never wrote anything. Both columns default to the old behaviour:
-- no grace period, no penalty.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS late_window_minutes INTEGER NOT NULL DEFAULT 0
  CHECK (late_window_minutes >= 0 AND late_window_minutes <= 1440);
ALTER TABLE exams ADD COLUMN IF NOT EXISTS late_penalty_percent INTEGER NOT NULL DEFAULT 0
  CHECK (late_penalty_percent >= 0 AND late_penalty_percent <= 100);

-- Recorded per submission rather than recomputed from timestamps at read time:
-- the accommodation that made a particular submission late (or not) can be
-- changed afterwards, and a grade that moves because someone edited an
-- accommodation weeks later is not a grade anyone can defend.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS is_late BOOLEAN NOT NULL DEFAULT FALSE;

-- The penalty in force when it was accepted, for the same reason. A teacher who
-- lowers the penalty after the exam does not silently restore marks on work
-- that was already graded under the old one.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS late_penalty_percent INTEGER NOT NULL DEFAULT 0;
