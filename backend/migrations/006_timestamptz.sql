-- Migration 006: Store instants as TIMESTAMPTZ (v0.0.6)
--
-- Bug fix, present since v0.0.1. Every point in time was stored as TIMESTAMP
-- (without time zone). The API writes ISO-8601 instants ("...Z"), which
-- PostgreSQL stored by discarding the offset and keeping the UTC wall clock;
-- reading them back, the pg driver interpreted that naive value as *local*
-- time. The round trip therefore shifted every instant by the app server's UTC
-- offset.
--
-- On a UTC server this is invisible, which is why it survived five releases.
-- Anywhere else it is not: with the server at UTC+3, an exam scheduled to end
-- at 17:00 stopped accepting submissions at 14:00. Verified by round-tripping
-- an instant through both column types against a real database.
--
-- Existing values were written as UTC wall clock, so that is how they are
-- reinterpreted here - no data moves in real terms.
--
-- Usage: npm run migrate

ALTER TABLE users        ALTER COLUMN created_at   TYPE TIMESTAMPTZ USING created_at   AT TIME ZONE 'UTC';
ALTER TABLE courses      ALTER COLUMN created_at   TYPE TIMESTAMPTZ USING created_at   AT TIME ZONE 'UTC';
ALTER TABLE enrollments  ALTER COLUMN enrolled_at  TYPE TIMESTAMPTZ USING enrolled_at  AT TIME ZONE 'UTC';
ALTER TABLE problems     ALTER COLUMN created_at   TYPE TIMESTAMPTZ USING created_at   AT TIME ZONE 'UTC';

-- The two that actually decide whether a student can sit an exam.
ALTER TABLE exams        ALTER COLUMN start_time   TYPE TIMESTAMPTZ USING start_time   AT TIME ZONE 'UTC';
ALTER TABLE exams        ALTER COLUMN end_time     TYPE TIMESTAMPTZ USING end_time     AT TIME ZONE 'UTC';
ALTER TABLE exams        ALTER COLUMN created_at   TYPE TIMESTAMPTZ USING created_at   AT TIME ZONE 'UTC';

ALTER TABLE submissions  ALTER COLUMN submitted_at TYPE TIMESTAMPTZ USING submitted_at AT TIME ZONE 'UTC';
ALTER TABLE integrity_events ALTER COLUMN occurred_at TYPE TIMESTAMPTZ USING occurred_at AT TIME ZONE 'UTC';
ALTER TABLE schema_migrations ALTER COLUMN applied_at TYPE TIMESTAMPTZ USING applied_at AT TIME ZONE 'UTC';

ALTER TABLE exam_assignments      ALTER COLUMN assigned_at TYPE TIMESTAMPTZ USING assigned_at AT TIME ZONE 'UTC';
ALTER TABLE exam_accommodations   ALTER COLUMN created_at  TYPE TIMESTAMPTZ USING created_at  AT TIME ZONE 'UTC';
ALTER TABLE exam_grade_overrides  ALTER COLUMN graded_at   TYPE TIMESTAMPTZ USING graded_at   AT TIME ZONE 'UTC';
ALTER TABLE submission_drafts     ALTER COLUMN updated_at  TYPE TIMESTAMPTZ USING updated_at  AT TIME ZONE 'UTC';
