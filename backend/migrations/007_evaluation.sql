-- Migration 007: Output checkers, per-problem limits and Go (v0.0.7)
-- Additive. Existing problems keep the pre-0.0.7 behaviour: checker 'exact'
-- (byte comparison after whitespace normalisation) and the global time/memory
-- limits.
-- Usage: npm run migrate

-- Sixth language.
ALTER TYPE language_type ADD VALUE IF NOT EXISTS 'go';
ALTER TABLE problems ADD COLUMN IF NOT EXISTS starter_code_go TEXT NOT NULL DEFAULT '';

-- How this problem's output is judged.
--
-- 'exact' was the only behaviour until now, and it fails plenty of correct
-- answers: any problem involving floats depends on the student formatting them
-- exactly as the author did, and any problem whose answer is a set has no
-- single correct ordering.
--
--   exact             byte comparison after whitespace normalisation (default)
--   case_insensitive  same, ignoring case
--   float             numeric comparison within checker_config.tolerance
--   unordered_lines   same lines, any order
--   unordered_tokens  same whitespace-separated values, any order
--   regex             expected_output is a pattern the whole output must match
ALTER TABLE problems ADD COLUMN IF NOT EXISTS checker VARCHAR(30) NOT NULL DEFAULT 'exact';
ALTER TABLE problems ADD COLUMN IF NOT EXISTS checker_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Per-problem execution limits. NULL means "use the server defaults", so a
-- deliberately heavy problem can be given more room without loosening the
-- limits for every other problem on the server.
ALTER TABLE problems ADD COLUMN IF NOT EXISTS time_limit_sec INTEGER;
ALTER TABLE problems ADD COLUMN IF NOT EXISTS memory_limit_mb INTEGER;

-- What actually went wrong, rather than a bare pass/fail:
-- accepted | wrong_answer | time_limit_exceeded | memory_limit_exceeded |
-- runtime_error | compile_error | output_limit_exceeded
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS verdict VARCHAR(30);

ALTER TABLE problems
  ADD CONSTRAINT problems_checker_known
  CHECK (checker IN ('exact', 'case_insensitive', 'float', 'unordered_lines', 'unordered_tokens', 'regex'))
  NOT VALID;

-- Sanity bounds, so a typo can't hand one problem the whole machine.
ALTER TABLE problems
  ADD CONSTRAINT problems_limits_sane
  CHECK (
    (time_limit_sec IS NULL OR (time_limit_sec BETWEEN 1 AND 60)) AND
    (memory_limit_mb IS NULL OR (memory_limit_mb BETWEEN 64 AND 2048))
  )
  NOT VALID;
