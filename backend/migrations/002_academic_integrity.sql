-- Migration 002: Academic integrity features (v0.0.2)
-- Safe to run against an existing v0.0.1 database - purely additive, no data is dropped.
-- Usage: psql -U postgres -d mihenk -f backend/migrations/002_academic_integrity.sql

CREATE TABLE IF NOT EXISTS integrity_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  problem_id INTEGER REFERENCES problems(id) ON DELETE SET NULL,
  event_type VARCHAR(30) NOT NULL,
  detail TEXT,
  occurred_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrity_events_exam ON integrity_events(exam_id);
CREATE INDEX IF NOT EXISTS idx_integrity_events_user ON integrity_events(user_id);
