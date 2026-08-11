-- Migration 012: Teaching assistants, and archiving that reaches the content
-- (v2.3.0)
--
-- Additive. A course with no staff rows behaves exactly as it did: one owning
-- teacher, which is every course that exists today.
-- Usage: npm run migrate

-- ---------------------------------------------------------------------------
-- Who else teaches this course
-- ---------------------------------------------------------------------------
-- A course has had exactly one teacher since v0.0.5 - the person who created
-- it - and that has been listed as a limitation ever since. A class with a
-- lecturer and two assistants had to share one account, which makes every
-- grade override, every accommodation and every integrity decision attributable
-- to nobody in particular.
--
-- The owner stays on courses.created_by and is deliberately NOT copied in here.
-- Two places recording the same fact is two places to disagree about it; this
-- table holds assistants only, and "may teach" is the union of the two.
CREATE TABLE IF NOT EXISTS course_staff (
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (course_id, user_id)
);

-- Every course-scoped read asks "which courses may this user see", and for a
-- teacher that is now created_by plus this. Indexed by user first because that
-- is the direction the scope query runs.
CREATE INDEX IF NOT EXISTS idx_course_staff_user ON course_staff (user_id, course_id);

-- ---------------------------------------------------------------------------
-- Archiving that means something
-- ---------------------------------------------------------------------------
-- `archived` has existed since v0.0.5 and stopped exactly one thing: joining.
-- The course's problems stayed solvable, its exams stayed open and its
-- submissions kept queueing, so archiving last term's course left it running.
--
-- No column is added: the flag was always the right one, it simply was not
-- consulted anywhere else. This migration exists to record that the *meaning*
-- of the existing column changed in this release, which is the kind of change
-- that is invisible in a schema diff and expensive to discover from behaviour.
--
-- Anyone who archived a course expecting it to be inert now gets that. Anyone
-- who archived one to hide it from new joiners while a straggler finished an
-- exam does not, and has to unarchive it - which is why it is called out here
-- and in the changelog rather than left to be found.
COMMENT ON COLUMN courses.archived IS
  'Read-only from v2.3.0: no new enrolments, submissions, problems or exams.';
