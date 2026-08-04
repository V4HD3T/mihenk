/**
 * codeExecution.service.js
 *
 * Compiles and runs Python, C++, Java, JavaScript, and C code in an
 * isolated temporary directory, applying time and memory limits
 * ("sandbox" runner).
 *
 * WHERE the code runs is decided by ./sandbox.js:
 *
 *   docker (default when a daemon is reachable) - every compile and every test
 *     case runs in its own throwaway container: no network, read-only root
 *     filesystem, memory/CPU caps, --pids-limit for genuine process-count
 *     containment, all capabilities dropped, unprivileged uid. This is the
 *     isolation boundary a multi-tenant deployment needs.
 *
 *   host - the pre-0.0.4 behaviour: a child process on this machine bounded by
 *     a wall-clock timeout and `ulimit -v`. Note that process-count limiting is
 *     deliberately NOT attempted here via `ulimit -u`, which is a per-*user*
 *     rather than per-process-tree limit and can starve unrelated processes on
 *     a shared host; a fork bomb is bounded only by the timeout. That is why
 *     this backend is not safe for untrusted users - use docker.
 *
 * The command strings are identical in both backends, so compile/run semantics
 * do not drift between them.
 */

const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
require('dotenv').config();
const { config } = require('../config/env');
const sandbox = require('./sandbox');
const { check } = require('./checker.service');
const { classify, summarize, VERDICTS } = require('./verdict.service');

const env = config();
const TIME_LIMIT_SEC = env.EXEC_TIME_LIMIT_SEC;
const MEMORY_LIMIT_KB = env.EXEC_MEMORY_LIMIT_KB;
const MAX_OUTPUT_CHARS = env.EXEC_MAX_OUTPUT_CHARS;

// The container runs as this unprivileged uid (matching `useradd -u 10001
// runner` in backend/docker/*.Dockerfile).
const SANDBOX_UID = 10001;
const SANDBOX_GID = 10001;

// Per-language config: filename, compile command (if any), run command.
// NOTE: user code is NEVER embedded directly into a shell command; it is
// always written to a file first, and commands are fixed templates
// (closed to injection).
const LANGUAGE_CONFIG = {
  python: {
    filename: 'main.py',
    compile: null,
    run: () => `ulimit -v ${MEMORY_LIMIT_KB}; python3 main.py`,
  },
  cpp: {
    filename: 'main.cpp',
    compile: () => `g++ -O2 -std=c++17 -o main main.cpp`,
    run: () => `ulimit -v ${MEMORY_LIMIT_KB}; ./main`,
  },
  java: {
    filename: 'Main.java',
    compile: () => `javac Main.java`,
    // Note: for Java, ulimit -v can conflict with the JVM's own virtual
    // memory reservations and trigger false "OOM" failures; we cap the
    // heap with -Xmx instead.
    run: () => `java -Xmx256m -Xss8m Main`,
  },
  javascript: {
    filename: 'main.js',
    compile: null,
    // Same rationale as Java: ulimit -v fights V8's own upfront virtual
    // memory reservation. Cap the heap with Node's own flag instead.
    run: () => `node --max-old-space-size=256 main.js`,
  },
  c: {
    filename: 'main.c',
    compile: () => `gcc -O2 -std=c17 -lm -o main main.c`,
    run: () => `ulimit -v ${MEMORY_LIMIT_KB}; ./main`,
  },
  go: {
    filename: 'main.go',
    // The image pins GOCACHE/GOPATH into /tmp and GO111MODULE=off, so a bare
    // main.go compiles without a go.mod.
    compile: () => `go build -o main main.go`,
    // ulimit -v fights the Go runtime's upfront virtual memory reservation the
    // same way it does the JVM's, so the container's memory cap is the limit.
    run: () => `./main`,
  },
};

/**
 * Where a language needs more room than the defaults.
 *
 * Measured, not guessed. Go's toolchain needs scratch space under /tmp for its
 * intermediate output; the default 16 MB is enough for small programs now that
 * the image ships a warm build cache (see docker/go.Dockerfile), but 64 MB
 * leaves headroom for larger submissions without the failure being a cryptic
 * "no space left on device". Memory was fine at the 256 MB default.
 */
const LANGUAGE_RESOURCES = {
  go: { tmpfsMb: 64 },
};

/**
 * Compiling is given its own, larger budget than running.
 *
 * They were the same until v0.0.7, which is wrong in both directions: a
 * heavily-templated C++ file can legitimately take longer to compile than the
 * problem's entire run budget, while a generous compile budget shouldn't let a
 * submission loop for that long at run time.
 */
const COMPILE_TIME_LIMIT_SEC = env.EXEC_COMPILE_TIME_LIMIT_SEC;

function truncate(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return text.slice(0, MAX_OUTPUT_CHARS) + '\n... [output truncated]';
}

/**
 * Spawns one process, collects its output and enforces a hard wall-clock cap.
 *
 * `onHardTimeout` exists for the docker backend: killing the `docker run`
 * client does NOT stop the container it started, so the container has to be
 * killed by name as well or it keeps burning CPU after we've given up on it.
 */
function spawnCollect(file, args, { cwd, stdin, onHardTimeout, timeLimitSec = TIME_LIMIT_SEC } = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let killedForTimeout = false;
    let killedForOutput = false;

    const child = spawn(file, args, { cwd });

    const hardTimer = setTimeout(() => {
      killedForTimeout = true;
      if (onHardTimeout) onHardTimeout();
      child.kill('SIGKILL');
    }, (timeLimitSec + 2) * 1000); // generous upper bound covering compile + run

    child.stdout.on('data', (d) => {
      stdout += d.toString();
      if (stdout.length > MAX_OUTPUT_CHARS * 2) {
        killedForOutput = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > MAX_OUTPUT_CHARS * 2) {
        killedForOutput = true;
        child.kill('SIGKILL');
      }
    });
    child.stdin.on('error', () => {
      /* an early-exiting process may raise EPIPE on write; ignore it */
    });

    if (stdin) child.stdin.write(stdin);
    child.stdin.end();

    child.on('close', (code) => {
      clearTimeout(hardTimer);
      // GNU 'timeout' sends SIGTERM and exits with code 124 when the limit is hit.
      const timedOut = killedForTimeout || code === 124;
      resolve({
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        exitCode: code,
        timedOut,
        outputTruncated: killedForOutput,
        executionTimeMs: Date.now() - start,
      });
    });

    child.on('error', (err) => {
      clearTimeout(hardTimer);
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: -1,
        timedOut: false,
        outputTruncated: false,
        executionTimeMs: Date.now() - start,
      });
    });
  });
}

/**
 * Runs one compile/run command for a submission.
 *
 * The command string is identical for both backends - the docker backend just
 * executes it inside a throwaway container instead of on this host, so
 * compile and run semantics don't drift between the two.
 */
function runSandboxed(command, workDir, stdin, { language, backend, limits = {} }) {
  const timeLimitSec = limits.timeLimitSec || TIME_LIMIT_SEC;

  if (backend !== 'docker') {
    return spawnCollect('bash', ['-c', command], { cwd: workDir, stdin, timeLimitSec });
  }

  // Named so the container can still be killed if the CLI has to be SIGKILLed.
  const containerName = `codecloud-run-${crypto.randomUUID()}`;
  // A problem may ask for more room than the default; the JVM needs a bigger
  // floor than everything else before it will even start.
  const defaultMemoryMb =
    language === 'java' ? env.SANDBOX_JAVA_MEMORY_MB : env.SANDBOX_MEMORY_MB;
  const memoryMb = Math.max(limits.memoryMb || 0, defaultMemoryMb);
  const resources = LANGUAGE_RESOURCES[language] || {};

  const args = sandbox.buildDockerArgs({
    image: sandbox.imageFor(language),
    workDir,
    command,
    containerName,
    memoryMb,
    cpus: env.SANDBOX_CPUS,
    pidsLimit: env.SANDBOX_PIDS_LIMIT,
    tmpfsMb: resources.tmpfsMb || env.SANDBOX_TMPFS_MB,
    uid: SANDBOX_UID,
    gid: SANDBOX_GID,
  });

  return spawnCollect('docker', args, {
    stdin,
    timeLimitSec,
    onHardTimeout: () => {
      // Fire-and-forget: we already have our answer (timed out), this is just
      // making sure the container doesn't outlive it.
      spawn('docker', ['kill', containerName], { stdio: 'ignore' }).on('error', () => {});
    },
  });
}

async function prepareWorkDir(language, code) {
  const config = LANGUAGE_CONFIG[language];
  if (!config) throw new Error(`Unsupported language: ${language}`);
  const workDir = path.join(os.tmpdir(), 'codecloud-exec', crypto.randomUUID());
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(path.join(workDir, config.filename), code, 'utf-8');
  // The container runs as uid 10001, which is not the uid that owns this
  // directory on the host, so it could not otherwise write the compiler's
  // output here. The directory is a per-run random path that exists for a
  // few seconds and is deleted in `cleanup`.
  await fs.chmod(workDir, 0o777);
  return { workDir, config };
}

async function compileIfNeeded(config, workDir, ctx) {
  if (!config.compile) return { success: true, stderr: '' };
  const result = await runSandboxed(config.compile(workDir), workDir, '', {
    ...ctx,
    limits: { ...ctx.limits, timeLimitSec: COMPILE_TIME_LIMIT_SEC },
  });
  return {
    success: result.exitCode === 0 && !result.timedOut,
    stderr: result.stderr || result.stdout || 'Compilation error (no details available)',
  };
}

/** Wraps a language's run command in the same in-sandbox wall-clock timeout. */
function runCommandFor(config, workDir, timeLimitSec = TIME_LIMIT_SEC) {
  return `timeout ${timeLimitSec}s bash -c '${config.run(workDir).replace(/'/g, `'\\''`)}'`;
}

async function cleanup(workDir) {
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Single run - used by the "Run" button (with free-form stdin).
 */
async function executeCode(language, code, stdin = '', options = {}) {
  const backend = await sandbox.resolveBackend();
  sandbox._logBackendOnce(backend);
  const limits = options.limits || {};
  const ctx = { language, backend, limits };

  const { workDir, config } = await prepareWorkDir(language, code);
  try {
    const compileResult = await compileIfNeeded(config, workDir, ctx);
    if (!compileResult.success) {
      return {
        stdout: '',
        stderr: compileResult.stderr || 'Compilation error',
        exitCode: 1,
        timedOut: false,
        executionTimeMs: 0,
        stage: 'compile',
      };
    }
    const runResult = await runSandboxed(
      runCommandFor(config, workDir, limits.timeLimitSec),
      workDir,
      stdin,
      ctx
    );
    return { ...runResult, stage: 'run' };
  } finally {
    await cleanup(workDir);
  }
}

/**
 * Run against all test cases for a problem - used for automatic grading.
 * Compilation happens ONLY ONCE, then the same binary/file is run against
 * each test input.
 */
async function runTestCases(language, code, testCases, options = {}) {
  const backend = await sandbox.resolveBackend();
  sandbox._logBackendOnce(backend);
  // How this problem wants its output judged, and how much room it gets.
  const checker = options.checker || 'exact';
  const checkerConfig = options.checkerConfig || {};
  const limits = options.limits || {};
  const ctx = { language, backend, limits };

  const { workDir, config } = await prepareWorkDir(language, code);
  try {
    const compileResult = await compileIfNeeded(config, workDir, ctx);
    if (!compileResult.success) {
      return {
        results: testCases.map((tc) => ({
          test_case_id: tc.id,
          passed: false,
          verdict: VERDICTS.COMPILE_ERROR,
          verdictLabel: 'Compile error',
          is_sample: tc.is_sample,
          stdout: '',
          stderr: compileResult.stderr,
          timedOut: false,
          executionTimeMs: 0,
        })),
        passedCount: 0,
        totalCount: testCases.length,
        compileError: compileResult.stderr,
        verdict: VERDICTS.COMPILE_ERROR,
      };
    }

    // One fresh container PER TEST CASE, not one per submission. Measured on a
    // macOS dev machine: per-test containers cost ~159 ms/test versus ~82 ms
    // for a single container reused via `docker exec` - i.e. the fast option is
    // ~2x cheaper. The slower one is chosen deliberately: sharing a container
    // across test cases lets a stray background process, a leftover file or an
    // exhausted pid budget from one test change the result of the next, and a
    // wrong grade is worse than a slower one. Grading is queued anyway, so
    // nobody is waiting on the difference.
    const results = [];
    for (const tc of testCases) {
      const r = await runSandboxed(
        runCommandFor(config, workDir, limits.timeLimitSec),
        workDir,
        tc.input || '',
        ctx
      );

      // Two separate questions, deliberately kept apart: did the program run
      // successfully, and is its output the right answer? Conflating them is
      // what made every failure look identical before v0.0.7.
      const checkResult = check(r.stdout, tc.expected_output, checker, checkerConfig);
      const { verdict, label, reason } = classify(r, checkResult);

      results.push({
        test_case_id: tc.id,
        passed: verdict === VERDICTS.ACCEPTED,
        verdict,
        verdictLabel: label,
        verdictReason: reason,
        is_sample: tc.is_sample,
        stdout: r.stdout,
        stderr: r.stderr,
        timedOut: r.timedOut,
        executionTimeMs: r.executionTimeMs,
      });
    }

    const passedCount = results.filter((r) => r.passed).length;
    return {
      results,
      passedCount,
      totalCount: testCases.length,
      compileError: null,
      verdict: summarize(results, null),
    };
  } finally {
    await cleanup(workDir);
  }
}

module.exports = { executeCode, runTestCases, LANGUAGE_CONFIG, LANGUAGE_RESOURCES };
