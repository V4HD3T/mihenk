/**
 * Grading correctness.
 *
 * These decide what mark a student gets, so they are tested harder than
 * anything else in the codebase. All pure - no database, no containers.
 */

import { describe, it, expect } from 'vitest';
import checker from '../src/services/checker.service.js';
import verdictModule from '../src/services/verdict.service.js';
import schemas from '../src/validation/schemas.js';

const { check, normalize, sameMultiset, numbersClose, CHECKERS, REGEX_TIMEOUT_MS } = checker;
const { classify, summarize, VERDICTS } = verdictModule;

const passes = (...args) => check(...args).passed;

describe('whitespace normalisation (applies to every checker)', () => {
  it('ignores trailing newlines and carriage returns', () => {
    expect(passes('42\n', '42')).toBe(true);
    expect(passes('42\r\n', '42')).toBe(true);
    expect(passes('42\n\n\n', '42')).toBe(true);
  });

  it('ignores trailing spaces on a line', () => {
    expect(passes('a   \nb\t\n', 'a\nb')).toBe(true);
  });

  it('does not ignore leading whitespace, which can be meaningful', () => {
    // Indentation matters when the answer is, say, a drawn triangle.
    expect(passes('  a', 'a')).toBe(false);
  });

  it('does not ignore differences between blank lines in the middle', () => {
    expect(passes('a\n\nb', 'a\nb')).toBe(false);
  });

  it('treats null and empty output the same', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });
});

describe('exact checker (the default, unchanged from before v0.0.7)', () => {
  it('accepts an identical answer', () => {
    expect(passes('hello world', 'hello world')).toBe(true);
  });

  it('rejects a different answer', () => {
    expect(passes('hello', 'world')).toBe(false);
  });

  it('is case sensitive', () => {
    expect(passes('YES', 'yes')).toBe(false);
  });

  it('rejects float representation differences - the reason other checkers exist', () => {
    expect(passes('0.30000000000000004', '0.3')).toBe(false);
  });

  it('falls back to exact for an unknown checker name rather than passing everything', () => {
    expect(check('a', 'b', 'no_such_checker').passed).toBe(false);
    expect(check('a', 'a', 'no_such_checker').passed).toBe(true);
  });

  it('explains itself when it fails', () => {
    expect(check('a', 'b').reason).toMatch(/differs/i);
  });
});

describe('case_insensitive checker', () => {
  it('accepts any casing', () => {
    expect(passes('YES', 'yes', 'case_insensitive')).toBe(true);
    expect(passes('Yes', 'yES', 'case_insensitive')).toBe(true);
  });

  it('still rejects a genuinely different answer', () => {
    expect(passes('no', 'yes', 'case_insensitive')).toBe(false);
  });
});

describe('float checker', () => {
  it('accepts the classic 0.1 + 0.2', () => {
    expect(passes('0.30000000000000004', '0.3', 'float')).toBe(true);
  });

  it('accepts scientific notation for the same value', () => {
    expect(passes('1e3', '1000', 'float')).toBe(true);
  });

  it('rejects a genuinely wrong number', () => {
    expect(passes('0.7', '0.3', 'float')).toBe(false);
  });

  it('respects a tighter tolerance', () => {
    expect(passes('1.0001', '1.0', 'float', { tolerance: 1e-2 })).toBe(true);
    expect(passes('1.0001', '1.0', 'float', { tolerance: 1e-9 })).toBe(false);
  });

  it('uses relative tolerance for large values', () => {
    // 1e12 vs 1e12+1 differs by 1 absolutely, which is nothing at that scale.
    expect(passes('1000000000001', '1000000000000', 'float')).toBe(true);
  });

  it('compares several numbers position by position', () => {
    expect(passes('1.0 2.0 3.0', '1 2 3', 'float')).toBe(true);
    expect(passes('1.0 2.0 9.0', '1 2 3', 'float')).toBe(false);
  });

  it('notices a missing or extra value', () => {
    const r = check('1 2', '1 2 3', 'float');
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/expected 3 values, got 2/);
  });

  it('compares non-numeric tokens literally, so labels can be mixed in', () => {
    expect(passes('area: 3.14159', 'area: 3.14159265', 'float', { tolerance: 1e-4 })).toBe(true);
    expect(passes('volume: 3.14', 'area: 3.14', 'float')).toBe(false);
  });

  it('rejects text where a number was expected', () => {
    const r = check('NaNsense', '3.0', 'float');
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/expected a number/);
  });

  it('says which value was wrong', () => {
    expect(check('1 2 9', '1 2 3', 'float').reason).toMatch(/token 3/);
  });

  it('treats infinities consistently', () => {
    expect(numbersClose(Infinity, Infinity, 1e-6)).toBe(true);
    expect(numbersClose(Infinity, 1, 1e-6)).toBe(false);
  });
});

describe('unordered_lines checker', () => {
  it('accepts the same lines in a different order', () => {
    expect(passes('6\n3\n2\n1', '1\n2\n3\n6', 'unordered_lines')).toBe(true);
  });

  it('rejects a missing line', () => {
    expect(passes('1\n2', '1\n2\n3', 'unordered_lines')).toBe(false);
  });

  it('rejects a duplicated line - it is a multiset, not a set', () => {
    expect(passes('1\n1\n2', '1\n2\n2', 'unordered_lines')).toBe(false);
  });

  it('ignores per-line surrounding whitespace', () => {
    expect(passes('  b  \n a ', 'a\nb', 'unordered_lines')).toBe(true);
  });
});

describe('unordered_tokens checker', () => {
  it('ignores both order and line breaks', () => {
    expect(passes('3 1 2', '1\n2\n3', 'unordered_tokens')).toBe(true);
  });

  it('is still count-sensitive', () => {
    expect(passes('1 1 2', '1 2 2', 'unordered_tokens')).toBe(false);
  });
});

describe('regex checker', () => {
  it('must match the whole output, not merely appear in it', () => {
    expect(passes('451', '\\d{3}', 'regex')).toBe(true);
    // Printing the right answer plus noise is not a correct answer.
    expect(passes('the answer is 451', '\\d{3}', 'regex')).toBe(false);
  });

  it('supports alternation', () => {
    expect(passes('YES', 'YES|NO', 'regex')).toBe(true);
    expect(passes('NO', 'YES|NO', 'regex')).toBe(true);
    expect(passes('MAYBE', 'YES|NO', 'regex')).toBe(false);
  });

  it('accepts flags from the checker config', () => {
    expect(passes('yes', 'YES', 'regex', { flags: 'i' })).toBe(true);
  });

  it('fails safely on an invalid pattern instead of throwing', () => {
    const r = check('anything', '([unclosed', 'regex');
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/invalid checker pattern/i);
  });

  // The checker is the one place a teacher's input runs outside the sandbox.
  // Before v2.0.1 it ran with no bound at all, so a pattern like these - which
  // a person writes by accident, not by malice - pinned a grading worker for
  // as long as the process lived. With the pool sized to the queue, a handful
  // of them during an exam is a stopped queue.
  describe('catastrophic backtracking is bounded', () => {
    // Each of these is exponential in the length of the input. Deliberately
    // sized so that an unbounded match would not finish during this century,
    // making "the test passed quickly" the only outcome that can mean the
    // deadline works. A time assertion alone would not: it also passes if the
    // pattern happens to be fast.
    const catastrophic = [
      ['nested quantifier', '(a+)+', 'a'.repeat(64) + '!'],
      ['overlapping alternation', '(a|a)*', 'a'.repeat(64) + '!'],
      ['quantified word chars', '(\\w+\\s?)*', 'x'.repeat(48) + '!'],
      ['adjacent quantifiers', '(x+x+)+y', 'x'.repeat(64)],
    ];

    it.each(catastrophic)('stops "%s" and says so', (_name, pattern, output) => {
      const started = Date.now();
      const r = check(output, pattern, 'regex');
      const elapsed = Date.now() - started;

      expect(r.passed).toBe(false);
      expect(r.reason).toMatch(/did not finish/i);
      // Names the problem rather than the student: the submission was never
      // judged, and whoever reads the failure needs to know that.
      expect(r.reason).toMatch(/fault in the problem/i);
      // Slack for a loaded CI runner; the point is that it returned at all.
      expect(elapsed).toBeLessThan(REGEX_TIMEOUT_MS * 8);
    });

    it('goes on grading correctly after a pattern has been stopped', () => {
      // The deadline shares one compiled script and one context across every
      // check, so an interrupted match must not leave that machinery unusable
      // for the next student in the queue.
      expect(check('a'.repeat(64) + '!', '(a+)+', 'regex').passed).toBe(false);
      expect(passes('451', '\\d{3}', 'regex')).toBe(true);
      expect(passes('yes', 'YES', 'regex', { flags: 'i' })).toBe(true);
      expect(passes('the answer is 451', '\\d{3}', 'regex')).toBe(false);
    });

    it('does not charge an honest pattern for the machinery', () => {
      const started = Date.now();
      for (let i = 0; i < 500; i++) passes('4510', '\\d{4}', 'regex');
      expect(Date.now() - started).toBeLessThan(REGEX_TIMEOUT_MS);
    });
  });
});

describe('sameMultiset', () => {
  it('is order-independent but count-sensitive', () => {
    expect(sameMultiset(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameMultiset(['a', 'a'], ['a', 'b'])).toBe(false);
    expect(sameMultiset(['a'], ['a', 'a'])).toBe(false);
    expect(sameMultiset([], [])).toBe(true);
  });
});

describe('verdicts', () => {
  const ok = { exitCode: 0, timedOut: false, outputTruncated: false, stderr: '' };
  const good = { passed: true };
  const bad = { passed: false, reason: 'output differs' };

  it('accepts a clean run with correct output', () => {
    expect(classify(ok, good).verdict).toBe(VERDICTS.ACCEPTED);
  });

  it('reports wrong answer when the program ran fine but the output is wrong', () => {
    const v = classify(ok, bad);
    expect(v.verdict).toBe(VERDICTS.WRONG_ANSWER);
    expect(v.reason).toBe('output differs');
  });

  it('prefers the timeout over anything else', () => {
    expect(classify({ ...ok, timedOut: true }, bad).verdict).toBe(VERDICTS.TIME_LIMIT);
  });

  it('detects an OOM kill by its exit code', () => {
    expect(classify({ ...ok, exitCode: 137 }, bad).verdict).toBe(VERDICTS.MEMORY_LIMIT);
  });

  it('detects a runtime-reported out-of-memory', () => {
    for (const stderr of [
      'java.lang.OutOfMemoryError: Java heap space',
      'FATAL ERROR: JavaScript heap out of memory',
      'MemoryError',
      "terminate called after throwing an instance of 'std::bad_alloc'",
      'runtime: out of memory',
    ]) {
      expect(classify({ ...ok, exitCode: 1, stderr }, bad).verdict).toBe(VERDICTS.MEMORY_LIMIT);
    }
  });

  it('does not mistake a killed-for-timeout run for an OOM', () => {
    expect(classify({ ...ok, exitCode: 137, timedOut: true }, bad).verdict).toBe(VERDICTS.TIME_LIMIT);
  });

  it('reports too much output', () => {
    const v = classify({ ...ok, outputTruncated: true }, bad);
    expect(v.verdict).toBe(VERDICTS.OUTPUT_LIMIT);
    expect(v.reason).toMatch(/runaway loop/i);
  });

  it('explains a segfault in words', () => {
    const v = classify({ ...ok, exitCode: 139 }, good);
    expect(v.verdict).toBe(VERDICTS.RUNTIME_ERROR);
    expect(v.reason).toMatch(/segmentation fault/i);
  });

  it('reports a plain non-zero exit as a runtime error', () => {
    const v = classify({ ...ok, exitCode: 3 }, good);
    expect(v.verdict).toBe(VERDICTS.RUNTIME_ERROR);
    expect(v.reason).toMatch(/exited with code 3/);
  });

  it('summarises a submission by its first failure', () => {
    expect(summarize([{ verdict: 'accepted' }, { verdict: 'accepted' }], null)).toBe('accepted');
    expect(summarize([{ verdict: 'accepted' }, { verdict: 'wrong_answer' }], null)).toBe('wrong_answer');
    expect(summarize([{ verdict: 'accepted' }], 'error text')).toBe(VERDICTS.COMPILE_ERROR);
  });
});

describe('checker list stays in sync', () => {
  it('validation offers exactly the checkers the engine implements', () => {
    expect([...schemas.CHECKERS].sort()).toEqual([...CHECKERS].sort());
  });

  it('every advertised checker is actually reachable', () => {
    for (const name of CHECKERS) {
      // Identical strings must pass under every checker except regex, where the
      // expected value is a pattern rather than a literal.
      const expected = name === 'regex' ? 'abc' : 'abc';
      expect(check('abc', expected, name).passed).toBe(true);
    }
  });
});
