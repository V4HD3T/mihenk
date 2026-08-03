/**
 * verify-sandbox.js
 *
 * Pushes deliberately hostile submissions through the real execution engine
 * and fails if any of them escapes containment.
 *
 *   npm run sandbox:verify
 *
 * The unit tests in tests/sandbox.test.js pin the security *flags*; this
 * proves the flags actually do something, which needs a live Docker daemon.
 * CI runs it on Linux, where the isolation semantics are the ones that matter
 * in production (a macOS dev machine runs containers inside a VM).
 *
 * Exits non-zero on the first escape - a weakened sandbox must break the
 * build, not show up as a warning nobody reads.
 */

process.env.SANDBOX_MODE = 'docker';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'silent';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'sandbox-verification-only';
require('dotenv').config();

const { executeCode } = require('../src/services/codeExecution.service');

const CASES = [
  {
    name: 'no outbound network',
    language: 'python',
    code: [
      'import socket',
      'socket.setdefaulttimeout(3)',
      'try:',
      '    socket.create_connection(("1.1.1.1", 53), timeout=3)',
      '    print("REACHED")',
      'except Exception:',
      '    print("blocked")',
    ].join('\n'),
    contained: (r) => !r.stdout.includes('REACHED'),
  },
  {
    name: 'host filesystem not reachable',
    language: 'python',
    code: [
      'import os',
      '# Paths that only exist if the HOST filesystem has been exposed. Note that',
      '# /etc/shadow is deliberately NOT in this list: every Debian-based image',
      '# ships its own, so its mere existence proves nothing - what matters is',
      '# that it cannot be read, which is checked separately below.',
      'host_only = ("/Users", "/host_mnt", "/var/run/docker.sock", "/mnt/host")',
      'leaked = [p for p in host_only if os.path.exists(p)]',
      'try:',
      '    open("/etc/shadow").read()',
      '    leaked.append("/etc/shadow:readable")',
      'except Exception:',
      '    pass',
      'print("LEAKED:", leaked)',
    ].join('\n'),
    contained: (r) => r.stdout.includes('LEAKED: []'),
  },
  {
    name: 'root filesystem is read-only',
    language: 'python',
    code: [
      'wrote = []',
      'for p in ("/etc/passwd", "/usr/bin/pwned", "/opt/x"):',
      '    try:',
      '        open(p, "w").write("x"); wrote.append(p)',
      '    except Exception:',
      '        pass',
      'print("WROTE:", wrote)',
    ].join('\n'),
    contained: (r) => r.stdout.includes('WROTE: []'),
  },
  {
    name: 'fork bomb hits the pid ceiling',
    language: 'python',
    code: [
      'import os',
      'n = 0',
      'try:',
      '    while True:',
      '        if os.fork() == 0:',
      '            os._exit(0)',
      '        n += 1',
      'except Exception:',
      '    pass',
      'print("FORKED", n)',
    ].join('\n'),
    // Bounded well below anything that could threaten the host.
    contained: (r) => {
      const counts = [...r.stdout.matchAll(/FORKED (\d+)/g)].map((m) => Number(m[1]));
      return counts.length === 0 || Math.max(...counts) < 500;
    },
  },
  {
    name: 'memory bomb is capped',
    language: 'python',
    code: [
      'x = []',
      'try:',
      '    while True:',
      '        x.append(bytearray(10 * 1024 * 1024))',
      'except Exception:',
      '    pass',
      'print("ALLOCATED", len(x) * 10)',
    ].join('\n'),
    contained: (r) => {
      const m = r.stdout.match(/ALLOCATED (\d+)/);
      return !m || Number(m[1]) <= 512;
    },
  },
  {
    name: 'infinite loop is cut off',
    language: 'python',
    code: 'while True:\n    pass\n',
    contained: (r) => r.timedOut || r.exitCode !== 0,
  },
  {
    name: 'runs unprivileged',
    language: 'python',
    code: 'import os\nprint("uid:", os.getuid())',
    contained: (r) => /uid: \d+/.test(r.stdout) && !r.stdout.includes('uid: 0'),
  },
];

async function main() {
  let escaped = 0;
  for (const c of CASES) {
    const started = Date.now();
    let result;
    try {
      result = await executeCode(c.language, c.code, '');
    } catch (err) {
      console.log(`FAIL      ${c.name} - engine error: ${err.message}`);
      escaped++;
      continue;
    }
    const ok = c.contained(result);
    if (!ok) escaped++;
    const summary = (result.stdout || result.stderr || '').trim().split('\n')[0].slice(0, 60);
    console.log(
      `${ok ? 'contained' : 'ESCAPED  '} ${c.name.padEnd(38)} ${String(Date.now() - started).padStart(5)}ms  ${summary}`
    );
  }

  if (escaped) {
    console.error(`\n${escaped} case(s) escaped containment.`);
    process.exit(1);
  }
  console.log(`\nAll ${CASES.length} containment checks passed.`);
}

main().catch((err) => {
  console.error('Verification failed to run:', err.message);
  process.exit(1);
});
