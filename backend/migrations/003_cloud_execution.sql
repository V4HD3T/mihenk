-- Migration 003: Cloud-native execution architecture (v0.0.2)
-- Safe to run against an existing v0.0.1 database - purely additive.
-- Usage: psql -U postgres -d mihenk -f backend/migrations/003_cloud_execution.sql

-- New submission lifecycle states for the async grading queue.
ALTER TYPE submission_status ADD VALUE IF NOT EXISTS 'queued';
ALTER TYPE submission_status ADD VALUE IF NOT EXISTS 'running';

-- Two new supported languages (both use toolchains already required by v0.0.1: node, gcc).
ALTER TYPE language_type ADD VALUE IF NOT EXISTS 'javascript';
ALTER TYPE language_type ADD VALUE IF NOT EXISTS 'c';

-- Per-test-case results, persisted so both the WebSocket push and a later
-- GET /api/submissions/:id (polling fallback) can return the same detail.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS results_json JSONB;

-- Starter code for the two new languages.
ALTER TABLE problems ADD COLUMN IF NOT EXISTS starter_code_javascript TEXT NOT NULL DEFAULT '';
ALTER TABLE problems ADD COLUMN IF NOT EXISTS starter_code_c TEXT NOT NULL DEFAULT '';
