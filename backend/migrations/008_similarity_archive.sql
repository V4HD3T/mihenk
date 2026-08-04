-- Migration 008: Cross-semester similarity archive (v0.0.8)
-- Additive. Nothing is archived until a teacher explicitly archives a course.
-- Usage: npm run migrate

-- Submissions kept for plagiarism screening after their course is over.
--
-- Until now the similarity report only compared a student against their own
-- classmates, so a solution handed down from last year's cohort was invisible -
-- which is the most common way work gets reused in a course that runs every
-- term.
--
-- The code is copied rather than referenced because the point is to keep it
-- after the original course, its problems and its enrolments are deleted. It is
-- kept only for the teacher who archived it, and only for their own courses.
CREATE TABLE IF NOT EXISTS archived_submissions (
  id SERIAL PRIMARY KEY,
  -- Free text, e.g. "Algorithms - 2025 Spring". This is what the teacher sees
  -- next to a match, and it survives the course being deleted.
  source_label VARCHAR(200) NOT NULL,
  problem_title VARCHAR(200) NOT NULL,
  student_label VARCHAR(200) NOT NULL DEFAULT '',
  language language_type NOT NULL,
  code TEXT NOT NULL,
  -- The winnowing fingerprint, stored so a screening run doesn't have to
  -- re-tokenise the whole archive every time a report is opened.
  fingerprints JSONB NOT NULL,
  -- Who may screen against this row. The archive is not shared between
  -- teachers: it is one teacher's record of their own past courses.
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_archived_owner ON archived_submissions(owner_id);
CREATE INDEX IF NOT EXISTS idx_archived_problem_title ON archived_submissions(problem_title);
CREATE INDEX IF NOT EXISTS idx_archived_language ON archived_submissions(language);
