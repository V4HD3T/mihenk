-- Migration 004: Courses and enrollments (v0.0.5)
-- Safe to run against an existing v0.0.1-v0.0.4 database - additive, and no
-- content or access is lost: everything that exists today is moved into one
-- "General" course that every current user is enrolled in, which reproduces
-- the previous "everyone sees everything" behaviour exactly.
-- Usage: npm run migrate

CREATE TABLE IF NOT EXISTS courses (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Students enroll by entering this instead of being added by hand.
  join_code VARCHAR(16) UNIQUE NOT NULL,
  term VARCHAR(50) NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS enrollments (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrolled_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (course_id, user_id)
);

ALTER TABLE problems ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE;

-- Backfill: park existing content in one course so nothing becomes invisible.
-- Only runs when there is something to migrate and no such course exists yet,
-- so re-running the migration is harmless.
DO $$
DECLARE
  general_id INTEGER;
  owner_id INTEGER;
BEGIN
  IF EXISTS (SELECT 1 FROM problems WHERE course_id IS NULL)
     OR EXISTS (SELECT 1 FROM exams WHERE course_id IS NULL) THEN

    SELECT id INTO general_id FROM courses WHERE join_code = 'GENERAL';

    IF general_id IS NULL THEN
      -- Prefer the teacher who created the most content as the owner; a
      -- database with no teacher at all leaves it NULL, which is allowed.
      SELECT created_by INTO owner_id
      FROM problems
      WHERE created_by IS NOT NULL
      GROUP BY created_by
      ORDER BY COUNT(*) DESC
      LIMIT 1;

      INSERT INTO courses (title, description, join_code, term, created_by)
      VALUES (
        'General',
        'Content that existed before courses were introduced in v0.0.5.',
        'GENERAL',
        '',
        owner_id
      )
      RETURNING id INTO general_id;
    END IF;

    UPDATE problems SET course_id = general_id WHERE course_id IS NULL;
    UPDATE exams SET course_id = general_id WHERE course_id IS NULL;

    -- Everyone who exists today keeps seeing what they saw yesterday.
    INSERT INTO enrollments (course_id, user_id)
    SELECT general_id, id FROM users
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Every problem and exam now belongs to exactly one course.
ALTER TABLE problems ALTER COLUMN course_id SET NOT NULL;
ALTER TABLE exams ALTER COLUMN course_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_problems_course ON problems(course_id);
CREATE INDEX IF NOT EXISTS idx_exams_course ON exams(course_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments(user_id);
CREATE INDEX IF NOT EXISTS idx_courses_created_by ON courses(created_by);
