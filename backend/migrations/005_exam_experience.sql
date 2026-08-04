-- Migration 005: Exam experience (v0.0.6)
-- Additive. Existing exams keep behaving exactly as before: problems_per_student
-- is NULL (everyone gets every problem), nobody has an accommodation, and no
-- grade is overridden.
-- Usage: npm run migrate

-- NULL = every student sees every problem in the exam (the pre-0.0.6 behaviour).
-- A number = each student is dealt that many problems at random from the pool.
ALTER TABLE exams ADD COLUMN IF NOT EXISTS problems_per_student INTEGER;

-- Which problems a given student was actually dealt.
--
-- Stored rather than derived from a seeded shuffle: the teacher has to be able
-- to see who got what when a grade is questioned, and the assignment must not
-- silently change if the exam's problem list is edited mid-exam.
CREATE TABLE IF NOT EXISTS exam_assignments (
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (exam_id, user_id, problem_id)
);

-- Per-student extra time, for students with an accessibility accommodation.
-- Applied wherever the exam window is enforced, so it cannot be honoured on one
-- endpoint and ignored on another.
CREATE TABLE IF NOT EXISTS exam_accommodations (
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  extra_minutes INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (exam_id, user_id)
);

-- A teacher-set score that wins over the automatic one.
--
-- Auto-grading compares stdout exactly, so it is unforgiving about a trailing
-- format difference in an otherwise correct answer. This is the escape hatch,
-- and it records who changed the grade and why.
CREATE TABLE IF NOT EXISTS exam_grade_overrides (
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  max_score INTEGER NOT NULL,
  feedback TEXT NOT NULL DEFAULT '',
  graded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  graded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (exam_id, user_id, problem_id)
);

-- In-progress code, saved as the student types.
--
-- Without this, a refresh, a dropped connection or a browser crash during an
-- exam loses everything written since the last submit.
CREATE TABLE IF NOT EXISTS submission_drafts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE,
  language language_type NOT NULL,
  code TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- One draft per (student, problem, exam-or-practice). COALESCE keeps practice
-- drafts (exam_id IS NULL) distinct from exam drafts without a sentinel value,
-- and gives ON CONFLICT something to target.
CREATE UNIQUE INDEX IF NOT EXISTS idx_drafts_unique
  ON submission_drafts (user_id, problem_id, COALESCE(exam_id, 0));

CREATE INDEX IF NOT EXISTS idx_exam_assignments_user ON exam_assignments(exam_id, user_id);
CREATE INDEX IF NOT EXISTS idx_grade_overrides_exam ON exam_grade_overrides(exam_id);
