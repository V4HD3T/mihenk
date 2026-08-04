/**
 * verdict.service.js
 *
 * Turns "the program exited with code 137" into something a student can act on.
 *
 * Before v0.0.7 a test either passed or didn't, and the only extra signal was a
 * `timedOut` flag. A student whose program was OOM-killed, crashed with a null
 * dereference, or printed the right answer in the wrong order all saw the same
 * blank failure. The verdict says which it was.
 */

const VERDICTS = {
  ACCEPTED: 'accepted',
  WRONG_ANSWER: 'wrong_answer',
  TIME_LIMIT: 'time_limit_exceeded',
  MEMORY_LIMIT: 'memory_limit_exceeded',
  RUNTIME_ERROR: 'runtime_error',
  COMPILE_ERROR: 'compile_error',
  OUTPUT_LIMIT: 'output_limit_exceeded',
};

const LABELS = {
  [VERDICTS.ACCEPTED]: 'Accepted',
  [VERDICTS.WRONG_ANSWER]: 'Wrong answer',
  [VERDICTS.TIME_LIMIT]: 'Time limit exceeded',
  [VERDICTS.MEMORY_LIMIT]: 'Memory limit exceeded',
  [VERDICTS.RUNTIME_ERROR]: 'Runtime error',
  [VERDICTS.COMPILE_ERROR]: 'Compile error',
  [VERDICTS.OUTPUT_LIMIT]: 'Too much output',
};

// 128 + signal number: how a shell reports a process killed by a signal.
const SIGKILL_EXIT = 137; // 128 + 9  - what the cgroup OOM killer produces
const SIGSEGV_EXIT = 139; // 128 + 11
const SIGABRT_EXIT = 134; // 128 + 6

/**
 * Did the container's memory cap kill this run?
 *
 * A SIGKILL that we did not ask for is almost always the OOM killer inside the
 * container. Language runtimes that manage their own heap say so in stderr
 * instead of dying, so those are matched by message.
 */
function looksLikeMemoryExhaustion(result) {
  if (result.exitCode === SIGKILL_EXIT && !result.timedOut) return true;
  const stderr = result.stderr || '';
  return (
    /java\.lang\.OutOfMemoryError/.test(stderr) ||
    /JavaScript heap out of memory/.test(stderr) ||
    /MemoryError/.test(stderr) ||
    /std::bad_alloc/.test(stderr) ||
    /runtime: out of memory/.test(stderr) || // Go
    /memory allocation of \d+ bytes failed/.test(stderr) // Rust
  );
}

/**
 * Classifies one test-case run.
 *
 * @param {object} result   what the execution engine returned
 * @param {object} checkResult  from checker.service.check()
 * @returns {{verdict: string, label: string, reason?: string}}
 */
function classify(result, checkResult) {
  if (result.timedOut) {
    return { verdict: VERDICTS.TIME_LIMIT, label: LABELS[VERDICTS.TIME_LIMIT] };
  }
  if (result.outputTruncated) {
    return {
      verdict: VERDICTS.OUTPUT_LIMIT,
      label: LABELS[VERDICTS.OUTPUT_LIMIT],
      reason: 'The program printed far more than the expected output - check for a runaway loop.',
    };
  }
  if (looksLikeMemoryExhaustion(result)) {
    return { verdict: VERDICTS.MEMORY_LIMIT, label: LABELS[VERDICTS.MEMORY_LIMIT] };
  }
  if (result.exitCode !== 0) {
    return {
      verdict: VERDICTS.RUNTIME_ERROR,
      label: LABELS[VERDICTS.RUNTIME_ERROR],
      reason: describeExit(result.exitCode),
    };
  }
  if (!checkResult.passed) {
    return {
      verdict: VERDICTS.WRONG_ANSWER,
      label: LABELS[VERDICTS.WRONG_ANSWER],
      reason: checkResult.reason,
    };
  }
  return { verdict: VERDICTS.ACCEPTED, label: LABELS[VERDICTS.ACCEPTED] };
}

function describeExit(exitCode) {
  if (exitCode === SIGSEGV_EXIT) return 'Segmentation fault - an invalid memory access.';
  if (exitCode === SIGABRT_EXIT) return 'The program aborted (an uncaught exception or failed assertion).';
  if (exitCode === SIGKILL_EXIT) return 'The program was killed.';
  return `The program exited with code ${exitCode}.`;
}

/** The verdict for a whole submission: the first thing that went wrong. */
function summarize(results, compileError) {
  if (compileError) return VERDICTS.COMPILE_ERROR;
  const failing = results.find((r) => r.verdict && r.verdict !== VERDICTS.ACCEPTED);
  return failing ? failing.verdict : VERDICTS.ACCEPTED;
}

module.exports = { VERDICTS, LABELS, classify, summarize, looksLikeMemoryExhaustion, describeExit };
