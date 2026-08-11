-- Migration 011: Per-test-case checkers, weighted test cases and rubric
-- sections (v2.2.0)
--
-- Additive throughout. Every column defaults to the behaviour before it: a NULL
-- checker means "whatever the problem says", and a weight of 1 on every test
-- case makes the weighted score identical to the count it replaces.
-- Usage: npm run migrate

-- ---------------------------------------------------------------------------
-- A checker per test case
-- ---------------------------------------------------------------------------
-- v0.0.7 made the checker a property of the problem, which is right for most
-- of them and wrong for any problem that asks for more than one kind of answer.
-- "Print the mean, then the sorted values" wants a float tolerance on the first
-- line and an exact comparison on the rest, and could have neither.
--
-- NULL means "use the problem's", which is what every existing test case does.
-- It is deliberately nullable rather than defaulted to 'exact': a default would
-- silently override the problem's choice on every row that already exists.
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS checker VARCHAR(30)
  CHECK (checker IS NULL OR checker IN
    ('exact', 'case_insensitive', 'float', 'unordered_lines', 'unordered_tokens', 'regex'));
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS checker_config JSONB;

-- ---------------------------------------------------------------------------
-- Weight, and what it is for
-- ---------------------------------------------------------------------------
-- Grading counted test cases, so every case was worth the same: a one-line
-- edge case counted as much as the case that checks the algorithm, and a
-- student who solved the problem but missed an empty-input check scored the
-- same as one who got the algorithm wrong and happened to handle empty input.
--
-- Default 1 on every row makes the weighted score exactly the old count, so no
-- existing problem is re-marked by this migration.
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS weight INTEGER NOT NULL DEFAULT 1
  CHECK (weight >= 0 AND weight <= 1000);

-- The rubric: a name a group of test cases share, so a failure reads as "edge
-- cases: 1/3" rather than as five anonymous red dots. Empty means ungrouped,
-- which is every test case that exists today.
ALTER TABLE test_cases ADD COLUMN IF NOT EXISTS group_label VARCHAR(60) NOT NULL DEFAULT '';

-- ---------------------------------------------------------------------------
-- The weighted score on the submission
-- ---------------------------------------------------------------------------
-- passed_count and total_count keep their meaning exactly - they count test
-- cases, they are on the public API, and plenty of the interface reads them.
-- The weighted score is recorded beside them rather than instead of them.
--
-- NULL marks a submission graded before this release: its weighted score is
-- unknown rather than zero, and readers fall back to the counts. Backfilling
-- would be a lie about work that was never weighed.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS earned_weight INTEGER;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS total_weight INTEGER;
