-- Mihenk - Cloud-Based Coding Education and Exam System
-- Database Schema (PostgreSQL 12+)
--
-- All point-in-time columns are TIMESTAMPTZ, not TIMESTAMP. The API writes
-- ISO-8601 instants; a naive TIMESTAMP column discards the offset on write and
-- is reinterpreted as local time on read, which shifted every instant by the
-- server's UTC offset (see migrations/006_timestamptz.sql).
--
-- This file is the COMPLETE current-state schema for a FRESH install: it already
-- contains everything the numbered files in ../../migrations/ add. Creating a
-- database with this file and then running `npm run migrate` is a no-op, because
-- the seed at the bottom records every shipped migration as already applied.
--
-- Adding a schema change? Put it in BOTH places: a new migrations/NNN_*.sql file
-- (for existing databases) and here (for fresh installs), then add its filename
-- to the schema_migrations seed at the bottom of this file.
--
-- WARNING: this drops and recreates every table. Never run it against a database
-- that has data you care about - use `npm run migrate` instead.

DROP TABLE IF EXISTS schema_migrations CASCADE;
DROP TABLE IF EXISTS integrity_events CASCADE;
DROP TABLE IF EXISTS auth_tokens CASCADE;
DROP TABLE IF EXISTS archived_submissions CASCADE;
DROP TABLE IF EXISTS submission_drafts CASCADE;
DROP TABLE IF EXISTS exam_grade_overrides CASCADE;
DROP TABLE IF EXISTS exam_accommodations CASCADE;
DROP TABLE IF EXISTS exam_assignments CASCADE;
DROP TABLE IF EXISTS exam_roster CASCADE;
DROP TABLE IF EXISTS enrollments CASCADE;
DROP TABLE IF EXISTS course_staff CASCADE;
DROP TABLE IF EXISTS courses CASCADE;
DROP TABLE IF EXISTS submissions CASCADE;
DROP TABLE IF EXISTS exam_problems CASCADE;
DROP TABLE IF EXISTS exams CASCADE;
DROP TABLE IF EXISTS test_cases CASCADE;
DROP TABLE IF EXISTS problems CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS user_role;
DROP TYPE IF EXISTS language_type;
DROP TYPE IF EXISTS submission_status;

CREATE TYPE user_role AS ENUM ('student', 'teacher');
CREATE TYPE language_type AS ENUM ('python', 'cpp', 'java', 'javascript', 'c', 'go');
CREATE TYPE submission_status AS ENUM ('completed', 'error', 'queued', 'running');

-- Users (student / teacher)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'student',
  -- NULL until the address is confirmed. Verification is advisory by default:
  -- see REQUIRE_EMAIL_VERIFICATION.
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Short-lived secrets for password reset and email verification.
--
-- Only the SHA-256 hash of each token is stored. A leaked database would
-- otherwise hand over working reset links for every pending request.
CREATE TABLE auth_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose VARCHAR(30) NOT NULL CHECK (purpose IN ('password_reset', 'email_verification')),
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  -- Set when redeemed, so a token works exactly once.
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Courses (a class/section). Problems and exams belong to exactly one course,
-- and students only ever see the courses they are enrolled in.
CREATE TABLE courses (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  join_code VARCHAR(16) UNIQUE NOT NULL,
  term VARCHAR(50) NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Which students are in which course.
-- Teaching assistants.
--
-- The owner stays on courses.created_by and is not duplicated here: two places
-- recording the same fact is two places to disagree about it. "May teach this
-- course" is the union of the owner and these rows.
CREATE TABLE course_staff (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (course_id, user_id)
);

CREATE INDEX idx_course_staff_user ON course_staff (user_id, course_id);

CREATE TABLE enrollments (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (course_id, user_id)
);

-- Coding problems / exercises
CREATE TABLE problems (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  difficulty VARCHAR(20) NOT NULL DEFAULT 'medium',
  starter_code_python TEXT NOT NULL DEFAULT '',
  starter_code_cpp TEXT NOT NULL DEFAULT '',
  starter_code_java TEXT NOT NULL DEFAULT '',
  starter_code_javascript TEXT NOT NULL DEFAULT '',
  starter_code_c TEXT NOT NULL DEFAULT '',
  starter_code_go TEXT NOT NULL DEFAULT '',
  -- How this problem's output is judged. 'exact' is a byte comparison after
  -- whitespace normalisation; the others exist because that fails plenty of
  -- correct answers (float formatting, set-valued answers with no fixed order).
  checker VARCHAR(30) NOT NULL DEFAULT 'exact'
    CHECK (checker IN ('exact', 'case_insensitive', 'float', 'unordered_lines', 'unordered_tokens', 'regex')),
  checker_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- NULL = use the server defaults.
  time_limit_sec INTEGER CHECK (time_limit_sec IS NULL OR (time_limit_sec BETWEEN 1 AND 60)),
  memory_limit_mb INTEGER CHECK (memory_limit_mb IS NULL OR (memory_limit_mb BETWEEN 64 AND 2048)),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Test cases for each problem (input / expected output)
CREATE TABLE test_cases (
  id SERIAL PRIMARY KEY,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  input TEXT NOT NULL DEFAULT '',
  expected_output TEXT NOT NULL,
  is_sample BOOLEAN NOT NULL DEFAULT FALSE,
  ord INTEGER NOT NULL DEFAULT 0,
  -- NULL means "judge this one the way the problem says". Set, it overrides the
  -- problem's checker for this case alone - for a problem whose output has a
  -- float on one line and an exact string on the next.
  checker VARCHAR(30)
    CHECK (checker IS NULL OR checker IN
      ('exact', 'case_insensitive', 'float', 'unordered_lines', 'unordered_tokens', 'regex')),
  checker_config JSONB,
  -- What this case is worth. Grading counted cases before v2.2.0, so a one-line
  -- edge case counted as much as the case that checks the algorithm.
  weight INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 0 AND weight <= 1000),
  -- The rubric section this case belongs to, so a failure reads as
  -- "edge cases: 1/3" rather than as anonymous red dots. Empty = ungrouped.
  group_label VARCHAR(60) NOT NULL DEFAULT ''
);

-- Exams
CREATE TABLE exams (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL,
  -- NULL = every student sees every problem. A number deals each student that
  -- many problems at random from the exam's pool.
  problems_per_student INTEGER,
  -- How long after the deadline a submission is still accepted, and what it
  -- costs. 0/0 is the pre-v2.1.0 behaviour: nothing is accepted late.
  late_window_minutes INTEGER NOT NULL DEFAULT 0
    CHECK (late_window_minutes >= 0 AND late_window_minutes <= 1440),
  late_penalty_percent INTEGER NOT NULL DEFAULT 0
    CHECK (late_penalty_percent >= 0 AND late_penalty_percent <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Exam <-> Problem relationship (an exam can contain multiple problems)
CREATE TABLE exam_problems (
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 100,
  -- The order the teacher wants to ask the questions in. Without it a paper ran
  -- in primary-key order, so a warm-up written last sorted to the end.
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (exam_id, problem_id)
);

-- Who sits this exam.
--
-- Emptiness is meaningful: no rows means the whole course sits it, which is how
-- every exam behaved before v2.1.0. Rows mean exactly those students sit it, and
-- the paper is invisible to everyone else in the course - which is what makes a
-- make-up sitting of the same paper safe to schedule.
CREATE TABLE exam_roster (
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (exam_id, user_id)
);

CREATE INDEX idx_exam_roster_user ON exam_roster (user_id, exam_id);

-- Code submissions (both free practice and exam submissions)
CREATE TABLE submissions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  exam_id INTEGER REFERENCES exams(id) ON DELETE SET NULL,
  language language_type NOT NULL,
  code TEXT NOT NULL,
  status submission_status NOT NULL DEFAULT 'completed',
  passed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  execution_time_ms INTEGER NOT NULL DEFAULT 0,
  results_json JSONB,
  -- accepted | wrong_answer | time_limit_exceeded | memory_limit_exceeded |
  -- runtime_error | compile_error | output_limit_exceeded
  verdict VARCHAR(30),
  -- Whether this one landed in the exam's late window, and the penalty in force
  -- when it did. Both are recorded rather than recomputed at read time, so a
  -- grade cannot move because someone edited an accommodation or lowered the
  -- penalty weeks after the paper was graded.
  is_late BOOLEAN NOT NULL DEFAULT FALSE,
  late_penalty_percent INTEGER NOT NULL DEFAULT 0,
  -- The weighted score, beside the counts rather than instead of them:
  -- passed_count and total_count count test cases and are on the public API.
  -- NULL means graded before weights existed - unknown, not zero.
  earned_weight INTEGER,
  total_weight INTEGER,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Which problems a student was actually dealt, when the exam randomises its pool.
-- Stored rather than re-derived so the teacher can audit it and so it cannot
-- change under a student mid-exam.
CREATE TABLE exam_assignments (
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (exam_id, user_id, problem_id)
);

-- Per-student extra time (accessibility accommodations).
CREATE TABLE exam_accommodations (
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  extra_minutes INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (exam_id, user_id)
);

-- A teacher-set score that wins over the automatic one.
CREATE TABLE exam_grade_overrides (
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  max_score INTEGER NOT NULL,
  feedback TEXT NOT NULL DEFAULT '',
  graded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  graded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (exam_id, user_id, problem_id)
);

-- In-progress code, saved as the student types, so a refresh or a dropped
-- connection during an exam doesn't lose everything since the last submit.
CREATE TABLE submission_drafts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE,
  language language_type NOT NULL,
  code TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Submissions kept for plagiarism screening after their course is over, so this
-- term's work can be checked against previous terms and not only against
-- classmates. The code is copied rather than referenced so it survives the
-- original course being deleted; it belongs to the teacher who archived it.
CREATE TABLE archived_submissions (
  id SERIAL PRIMARY KEY,
  source_label VARCHAR(200) NOT NULL,
  problem_title VARCHAR(200) NOT NULL,
  student_label VARCHAR(200) NOT NULL DEFAULT '',
  language language_type NOT NULL,
  code TEXT NOT NULL,
  fingerprints JSONB NOT NULL,
  owner_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Academic-integrity signals captured during an active exam (tab-switches, pastes, ...)
CREATE TABLE integrity_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  problem_id INTEGER REFERENCES problems(id) ON DELETE SET NULL,
  event_type VARCHAR(30) NOT NULL, -- 'tab_hidden' | 'paste'
  detail TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_submissions_user ON submissions(user_id);
CREATE INDEX idx_submissions_problem ON submissions(problem_id);
CREATE INDEX idx_submissions_exam ON submissions(exam_id);
CREATE INDEX idx_test_cases_problem ON test_cases(problem_id);
CREATE INDEX idx_exam_problems_exam ON exam_problems(exam_id);
CREATE INDEX idx_integrity_events_exam ON integrity_events(exam_id);
CREATE INDEX idx_integrity_events_user ON integrity_events(user_id);
CREATE INDEX idx_problems_course ON problems(course_id);
CREATE INDEX idx_exams_course ON exams(course_id);
CREATE INDEX idx_enrollments_user ON enrollments(user_id);
CREATE INDEX idx_courses_created_by ON courses(created_by);
CREATE INDEX idx_exam_assignments_user ON exam_assignments(exam_id, user_id);
CREATE INDEX idx_grade_overrides_exam ON exam_grade_overrides(exam_id);
CREATE INDEX idx_archived_owner ON archived_submissions(owner_id);
CREATE INDEX idx_archived_problem_title ON archived_submissions(problem_title);
CREATE INDEX idx_archived_language ON archived_submissions(language);
CREATE UNIQUE INDEX idx_auth_tokens_hash ON auth_tokens(token_hash);
CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id, purpose);
CREATE INDEX idx_auth_tokens_expiry ON auth_tokens(expires_at);
-- COALESCE keeps practice drafts (exam_id IS NULL) distinct from exam drafts
-- without needing a sentinel value, and gives ON CONFLICT something to target.
CREATE UNIQUE INDEX idx_drafts_unique
  ON submission_drafts (user_id, problem_id, COALESCE(exam_id, 0));

-- Which numbered migrations have been applied to this database. `npm run migrate`
-- reads this table, applies whatever is missing, and records it here.
CREATE TABLE schema_migrations (
  filename VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A database created from this file already contains every shipped migration,
-- so mark them applied - otherwise `npm run migrate` would try to re-run them.
INSERT INTO schema_migrations (filename) VALUES
  ('002_academic_integrity.sql'),
  ('003_cloud_execution.sql'),
  ('004_courses.sql'),
  ('005_exam_experience.sql'),
  ('006_timestamptz.sql'),
  ('007_evaluation.sql'),
  ('008_similarity_archive.sql'),
  ('009_account_recovery.sql'),
  ('010_exam_paper_control.sql'),
  ('011_weighted_grading.sql'),
  ('012_course_staff.sql');
