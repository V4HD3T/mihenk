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
 * Every function here is pure: no database, no filesystem, no clock. That is
 * deliberate - grading correctness is the thing most worth testing exhaustively,
 * and these tests run anywhere.
 */

const CHECKERS = ['exact', 'case_insensitive', 'float', 'unordered_lines', 'unordered_tokens', 'regex'];

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
  let pattern;
  try {
    // The whole output must match, not merely contain the pattern - otherwise
    // printing extra junk alongside the right answer would pass.
    pattern = new RegExp(`^(?:${expected.trim()})$`, config.flags || '');
  } catch (err) {
    return { passed: false, reason: `invalid checker pattern: ${err.message}` };
  }
  return pattern.test(normalize(actual))
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

module.exports = { check, normalize, tokens, lines, sameMultiset, numbersClose, CHECKERS };
