/**
 * codeExecution.service.js
 *
 * Compiles and runs Python, C++, and Java code in an isolated temporary
 * directory, applying time/memory/process limits ("sandbox" runner).
 *
 * IMPORTANT (production note): this service runs submitted code in the
 * host's child_process layer; timeout + ulimit provide basic protection,
 * but for a real multi-tenant production environment, each run should be
 * isolated in its own network-disconnected Docker container (see
 * backend/docker/*.Dockerfile) or a micro-VM sandbox such as
 * gVisor/Firecracker for genuine isolation.
 */

const { spawn } = require('child_process');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
require('dotenv').config();

const TIME_LIMIT_SEC = Number(process.env.EXEC_TIME_LIMIT_SEC) || 5;
const MEMORY_LIMIT_KB = Number(process.env.EXEC_MEMORY_LIMIT_KB) || 524288; // 512 MB
const MAX_OUTPUT_CHARS = Number(process.env.EXEC_MAX_OUTPUT_CHARS) || 100000;
const MAX_PROCESSES = 40; // fork-bomb protection

// Per-language config: filename, compile command (if any), run command.
// NOTE: user code is NEVER embedded directly into a shell command; it is
// always written to a file first, and commands are fixed templates
// (closed to injection).
const LANGUAGE_CONFIG = {
  python: {
    filename: 'main.py',
    compile: null,
    run: () => `ulimit -v ${MEMORY_LIMIT_KB}; ulimit -u ${MAX_PROCESSES}; python3 main.py`,
  },
  cpp: {
    filename: 'main.cpp',
    compile: () => `g++ -O2 -std=c++17 -o main main.cpp`,
    run: () => `ulimit -v ${MEMORY_LIMIT_KB}; ulimit -u ${MAX_PROCESSES}; ./main`,
  },
  java: {
    filename: 'Main.java',
    compile: () => `javac Main.java`,
    // Note: for Java, ulimit -v can conflict with the JVM's own virtual
    // memory reservations and trigger false "OOM" failures; we cap the
    // heap with -Xmx instead.
    run: () => `ulimit -u ${MAX_PROCESSES}; java -Xmx256m -Xss8m Main`,
  },
};

function normalizeOutput(output) {
  return (output || '').replace(/\r\n/g, '\n').trimEnd();
}

function truncate(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return text.slice(0, MAX_OUTPUT_CHARS) + '\n... [output truncated]';
}

function runShell(command, cwd, stdin) {
  return new Promise((resolve) => {
    const start = Date.now();
    let stdout = '';
    let stderr = '';
    let killedForTimeout = false;
    let killedForOutput = false;

    const child = spawn('bash', ['-c', command], { cwd });

    const hardTimer = setTimeout(() => {
      killedForTimeout = true;
      child.kill('SIGKILL');
    }, (TIME_LIMIT_SEC + 2) * 1000); // generous upper bound covering compile + run

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

async function prepareWorkDir(language, code) {
  const config = LANGUAGE_CONFIG[language];
  if (!config) throw new Error(`Unsupported language: ${language}`);
  const workDir = path.join(os.tmpdir(), 'codecloud-exec', crypto.randomUUID());
  await fs.mkdir(workDir, { recursive: true });
  await fs.writeFile(path.join(workDir, config.filename), code, 'utf-8');
  return { workDir, config };
}

async function compileIfNeeded(config, workDir) {
  if (!config.compile) return { success: true, stderr: '' };
  const result = await runShell(config.compile(workDir), workDir);
  return {
    success: result.exitCode === 0 && !result.timedOut,
    stderr: result.stderr || result.stdout || 'Compilation error (no details available)',
  };
}

async function cleanup(workDir) {
  await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
}

/**
 * Single run - used by the "Run" button (with free-form stdin).
 */
async function executeCode(language, code, stdin = '') {
  const { workDir, config } = await prepareWorkDir(language, code);
  try {
    const compileResult = await compileIfNeeded(config, workDir);
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
    const runResult = await runShell(`timeout ${TIME_LIMIT_SEC}s bash -c '${config.run(workDir).replace(/'/g, `'\\''`)}'`, workDir, stdin);
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
async function runTestCases(language, code, testCases) {
  const { workDir, config } = await prepareWorkDir(language, code);
  try {
    const compileResult = await compileIfNeeded(config, workDir);
    if (!compileResult.success) {
      return {
        results: testCases.map((tc) => ({
          test_case_id: tc.id,
          passed: false,
          is_sample: tc.is_sample,
          stdout: '',
          stderr: compileResult.stderr,
          timedOut: false,
          executionTimeMs: 0,
        })),
        passedCount: 0,
        totalCount: testCases.length,
        compileError: compileResult.stderr,
      };
    }

    const results = [];
    for (const tc of testCases) {
      const r = await runShell(
        `timeout ${TIME_LIMIT_SEC}s bash -c '${config.run(workDir).replace(/'/g, `'\\''`)}'`,
        workDir,
        tc.input || ''
      );
      const passed =
        !r.timedOut && r.exitCode === 0 && normalizeOutput(r.stdout) === normalizeOutput(tc.expected_output);
      results.push({
        test_case_id: tc.id,
        passed,
        is_sample: tc.is_sample,
        stdout: r.stdout,
        stderr: r.stderr,
        timedOut: r.timedOut,
        executionTimeMs: r.executionTimeMs,
      });
    }

    const passedCount = results.filter((r) => r.passed).length;
    return { results, passedCount, totalCount: testCases.length, compileError: null };
  } finally {
    await cleanup(workDir);
  }
}

module.exports = { executeCode, runTestCases, LANGUAGE_CONFIG };
