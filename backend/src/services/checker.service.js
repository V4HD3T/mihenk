/**
 * checker.service.js
 *
 * Decides whether a submission's output is correct.
 *
 * Until v0.0.7 this was one line: normalise whitespace, then compare strings
 * exactly. That marks plenty of correct answers wrong:
 *
 *   - "0.1 + 0.2" prints 0.30000000000000004 in most languages, so any problem
 *     involving floats fails everyone who doesn't happen to format identically
 *   - "print the divisors of 12" has no single correct order, but only one
 *     order was accepted
 *   - "YES"/"Yes" differ, though nothing in the problem said which
 *
 * A checker is chosen per problem. `exact` remains the default, so existing
 * problems behave exactly as before.
 *
 * No database and no filesystem: grading correctness is the thing most worth
 * testing exhaustively, and these tests run anywhere. Everything except the
 * regex checker is also pure - that one holds a deadline, for the reason given
 * above `boundedTest`.
 */

const vm = require('node:vm');

const CHECKERS = ['exact', 'case_insensitive', 'float', 'unordered_lines', 'unordered_tokens', 'regex'];

/**
 * How long one pattern gets to decide.
 *
 * Generous: a test case already spends ~159 ms starting its container, and an
 * honest pattern answers in microseconds against a page of output. The number
 * only has to sit below "a person notices grading has stopped".
 */
const REGEX_TIMEOUT_MS = 250;

// Compiled once, at load. The pattern and the output cross into the context as
// *data* and never as source text - interpolating a teacher's pattern into this
// snippet would turn a checker into an eval.
const MATCH_SCRIPT = new vm.Script('matched = new RegExp(source, flags).test(subject)');
const matchContext = vm.createContext({ source: '', flags: '', subject: '', matched: false });

/**
 * Runs one match under a deadline.
 *
 * V8 does not yield while matching, so a catastrophically backtracking pattern
 * cannot be bounded by anything written in ordinary JavaScript: no timer, no
 * AbortSignal, no Promise.race, because none of them get to run until the match
 * has already returned. `vm`'s timeout is a watchdog inside the isolate, and
 * V8's regex engine does check for termination, so this is the one mechanism
 * that actually interrupts it. Verified against four catastrophic shapes on
 * Node 22 (what the images run) and Node 24 (what CI runs).
 *
 * Reusing one context across calls is not a race. Writing the inputs, running
 * the script and reading the result is a single synchronous block, and
 * JavaScript will not interleave a second submission's grading into the middle
 * of it. The cost is ~42 us per check over a bare `RegExp.test`.
 */
function boundedTest(source, flags, subject) {
  matchContext.source = source;
  matchContext.flags = flags;
  matchContext.subject = subject;
  matchContext.matched = false;
  try {
    MATCH_SCRIPT.runInContext(matchContext, { timeout: REGEX_TIMEOUT_MS });
  } catch (err) {
    if (err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') return { timedOut: true };
    throw err;
  }
  return { matched: matchContext.matched };
}

/** Trailing whitespace and line-ending differences are never meaningful. */
function normalize(text) {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

function tokens(text) {
  return normalize(text).split(/\s+/).filter(Boolean);
}

function lines(text) {
  return normalize(text)
    .split('\n')
    .map((l) => l.trim());
}

/** Multiset comparison - order-independent but count-sensitive. */
function sameMultiset(a, b) {
  if (a.length !== b.length) return false;
  const counts = new Map();
  for (const item of a) counts.set(item, (counts.get(item) || 0) + 1);
  for (const item of b) {
    const n = counts.get(item);
    if (!n) return false;
    counts.set(item, n - 1);
  }
  return true;
}

/**
 * Compares two numeric tokens within a tolerance.
 *
 * Relative tolerance matters as much as absolute: 1e-6 absolute is meaningless
 * when the answer is 1e12, and 1e-6 relative is meaningless near zero. A token
 * passes if it is within *either*, which is the usual judge convention.
 */
function numbersClose(a, b, tolerance) {
  if (Number.isNaN(a) && Number.isNaN(b)) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return a === b;
  const diff = Math.abs(a - b);
  if (diff <= tolerance) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale > 0 && diff / scale <= tolerance;
}

function checkFloat(actual, expected, config) {
  const tolerance = Number(config.tolerance ?? 1e-6);
  const a = tokens(actual);
  const e = tokens(expected);
  if (a.length !== e.length) {
    return { passed: false, reason: `expected ${e.length} values, got ${a.length}` };
  }
  for (let i = 0; i < e.length; i++) {
    const expectedNum = Number(e[i]);
    const actualNum = Number(a[i]);
    // A non-numeric token in the expected output is compared literally, so a
    // problem can mix labels and numbers ("area: 3.14").
    if (Number.isNaN(expectedNum)) {
      if (a[i] !== e[i]) {
        return { passed: false, reason: `token ${i + 1}: expected "${e[i]}", got "${a[i]}"` };
      }
      continue;
    }
    if (Number.isNaN(actualNum)) {
      return { passed: false, reason: `token ${i + 1}: expected a number, got "${a[i]}"` };
    }
    if (!numbersClose(actualNum, expectedNum, tolerance)) {
      return {
        passed: false,
        reason: `token ${i + 1}: expected ${e[i]}, got ${a[i]} (tolerance ${tolerance})`,
      };
    }
  }
  return { passed: true };
}

function checkRegex(actual, expected, config) {
  // The whole output must match, not merely contain the pattern - otherwise
  // printing extra junk alongside the right answer would pass.
  const source = `^(?:${expected.trim()})$`;
  const flags = config.flags || '';

  try {
    // Compiling is linear in the length of the pattern and cannot run away;
    // only matching can. Rejecting a malformed pattern out here, before the
    // deadline, keeps that failure worded exactly as it always was.
    new RegExp(source, flags);
  } catch (err) {
    return { passed: false, reason: `invalid checker pattern: ${err.message}` };
  }

  const outcome = boundedTest(source, flags, normalize(actual));
  if (outcome.timedOut) {
    // Fails closed, like a malformed pattern does - we did not learn whether
    // the answer was right, and guessing "correct" would hide the fault. The
    // wording says whose fault it is, because the student reads this too and a
    // teacher can lift it with a grade override.
    return {
      passed: false,
      reason:
        `the checker pattern did not finish within ${REGEX_TIMEOUT_MS}ms and was stopped - ` +
        'it backtracks catastrophically on this output. This is a fault in the problem, not in the submission.',
    };
  }
  return outcome.matched
    ? { passed: true }
    : { passed: false, reason: 'output did not match the expected pattern' };
}

/**
 * @param {string} actual    what the program printed
 * @param {string} expected  the test case's expected output
 * @param {string} [checker] one of CHECKERS; unknown names fall back to exact
 * @param {object} [config]  checker options, e.g. { tolerance: 1e-9 }
 * @returns {{passed: boolean, reason?: string}}
 */
function check(actual, expected, checker = 'exact', config = {}) {
  const cfg = config || {};
  switch (checker) {
    case 'case_insensitive':
      return normalize(actual).toLowerCase() === normalize(expected).toLowerCase()
        ? { passed: true }
        : { passed: false, reason: 'output differs (ignoring case)' };

    case 'float':
      return checkFloat(actual, expected, cfg);

    case 'unordered_lines':
      return sameMultiset(lines(actual), lines(expected))
        ? { passed: true }
        : { passed: false, reason: 'the same set of lines was expected, in any order' };

    case 'unordered_tokens':
      return sameMultiset(tokens(actual), tokens(expected))
        ? { passed: true }
        : { passed: false, reason: 'the same set of values was expected, in any order' };

    case 'regex':
      return checkRegex(actual, expected, cfg);

    case 'exact':
    default:
      return normalize(actual) === normalize(expected)
        ? { passed: true }
        : { passed: false, reason: 'output differs from the expected output' };
  }
}

module.exports = {
  check,
  normalize,
  tokens,
  lines,
  sameMultiset,
  numbersClose,
  CHECKERS,
  REGEX_TIMEOUT_MS,
};
