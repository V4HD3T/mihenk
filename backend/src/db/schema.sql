-- CodeCloud - Cloud-Based Coding Education and Exam System
-- Database Schema (PostgreSQL 12+)
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
CREATE TYPE language_type AS ENUM ('python', 'cpp', 'java', 'javascript', 'c');
CREATE TYPE submission_status AS ENUM ('completed', 'error', 'queued', 'running');

-- Users (student / teacher)
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'student',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Coding problems / exercises
CREATE TABLE problems (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  difficulty VARCHAR(20) NOT NULL DEFAULT 'medium',
  starter_code_python TEXT NOT NULL DEFAULT '',
  starter_code_cpp TEXT NOT NULL DEFAULT '',
  starter_code_java TEXT NOT NULL DEFAULT '',
  starter_code_javascript TEXT NOT NULL DEFAULT '',
  starter_code_c TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Test cases for each problem (input / expected output)
CREATE TABLE test_cases (
  id SERIAL PRIMARY KEY,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  input TEXT NOT NULL DEFAULT '',
  expected_output TEXT NOT NULL,
  is_sample BOOLEAN NOT NULL DEFAULT FALSE,
  ord INTEGER NOT NULL DEFAULT 0
);

-- Exams
CREATE TABLE exams (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  duration_minutes INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Exam <-> Problem relationship (an exam can contain multiple problems)
CREATE TABLE exam_problems (
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 100,
  PRIMARY KEY (exam_id, problem_id)
);

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
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Academic-integrity signals captured during an active exam (tab-switches, pastes, ...)
CREATE TABLE integrity_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  problem_id INTEGER REFERENCES problems(id) ON DELETE SET NULL,
  event_type VARCHAR(30) NOT NULL, -- 'tab_hidden' | 'paste'
  detail TEXT,
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_submissions_user ON submissions(user_id);
CREATE INDEX idx_submissions_problem ON submissions(problem_id);
CREATE INDEX idx_submissions_exam ON submissions(exam_id);
CREATE INDEX idx_test_cases_problem ON test_cases(problem_id);
CREATE INDEX idx_exam_problems_exam ON exam_problems(exam_id);
CREATE INDEX idx_integrity_events_exam ON integrity_events(exam_id);
CREATE INDEX idx_integrity_events_user ON integrity_events(user_id);

-- Which numbered migrations have been applied to this database. `npm run migrate`
-- reads this table, applies whatever is missing, and records it here.
CREATE TABLE schema_migrations (
  filename VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- A database created from this file already contains every shipped migration,
-- so mark them applied - otherwise `npm run migrate` would try to re-run them.
INSERT INTO schema_migrations (filename) VALUES
  ('002_academic_integrity.sql'),
  ('003_cloud_execution.sql');
