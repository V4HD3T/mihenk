/**
 * loadtest.js
 *
 * Simulates the load this system is actually built for: a class submitting all
 * at once at the end of an exam.
 *
 *   npm run loadtest -- --students 100 --workers 4
 *
 * It drives the real API over HTTP and waits for the real workers to grade
 * every submission, so the numbers include queueing, container startup,
 * compilation and the database - not a mocked pipeline.
 *
 * What it reports:
 *   queue wait   how long a submission sat before a worker picked it up. This
 *                is what a student experiences during a rush.
 *   grading      how long grading itself took once started.
 *   end to end   submit -> graded, which is the sum a student sees.
 *   throughput   submissions graded per second.
 *
 * Requires a running API, at least one worker, PostgreSQL and Redis. It creates
 * its own throwaway course, problem and student accounts, so point it at a test
 * install rather than a live one.
 *
 * Registering a class of students trips the production auth rate limit within
 * ten accounts, which is the limiter working correctly. Give the target install
 * headroom for the run, e.g. AUTH_RATE_LIMIT_MAX=1000 RATE_LIMIT_MAX=100000.
 */

require('dotenv').config();
const { setTimeout: sleep } = require('timers/promises');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const BASE = arg('base', `http://127.0.0.1:${process.env.PORT || 4000}/api`);
const STUDENTS = Number(arg('students', 50));
const INVITE = arg('invite', process.env.TEACHER_INVITE_CODE);
const TIMEOUT_MS = Number(arg('timeout', 300000));

const SOLUTION = 'import sys\nprint(int(sys.stdin.read().strip() or 0) * 2)';

async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok && res.status !== 202) {
    throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function report(label, samples) {
  const s = [...samples].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
  console.log(
    `  ${label.padEnd(12)} n=${String(s.length).padStart(4)}  ` +
      `mean ${(mean / 1000).toFixed(2)}s  p50 ${(percentile(s, 50) / 1000).toFixed(2)}s  ` +
      `p95 ${(percentile(s, 95) / 1000).toFixed(2)}s  max ${(percentile(s, 100) / 1000).toFixed(2)}s`
  );
}

async function main() {
  const stamp = Date.now();
  console.log(`Load test: ${STUDENTS} students submitting at once, against ${BASE}\n`);

  console.log('Setting up...');
  const teacher = await api('/auth/register', {
    method: 'POST',
    body: {
      name: 'Load Teacher',
      email: `load-teacher-${stamp}@test.local`,
      password: 'password123',
      ...(INVITE ? { inviteCode: INVITE } : {}),
    },
  });
  if (teacher.user.role !== 'teacher') {
    throw new Error('Could not create a teacher - pass --invite <TEACHER_INVITE_CODE>');
  }

  const { course } = await api('/courses', {
    method: 'POST',
    token: teacher.token,
    body: { title: `Load test ${stamp}` },
  });

  const { problem } = await api('/problems', {
    method: 'POST',
    token: teacher.token,
    body: {
      course_id: course.id,
      title: 'Double it',
      description: 'Read an integer and print twice its value.',
      testCases: [
        { input: '21', expected_output: '42', is_sample: true },
        { input: '0', expected_output: '0', is_sample: false },
        { input: '100', expected_output: '200', is_sample: false },
      ],
    },
  });

  const students = [];
  for (let i = 0; i < STUDENTS; i++) {
    const s = await api('/auth/register', {
      method: 'POST',
      body: { name: `Load ${i}`, email: `load-${stamp}-${i}@test.local`, password: 'password123' },
    });
    await api('/courses/join', {
      method: 'POST',
      token: s.token,
      body: { joinCode: course.join_code },
    });
    students.push(s);
  }
  console.log(`  ${students.length} students enrolled\n`);

  // Everyone submits at the same moment, which is the point of the exercise.
  console.log('Submitting...');
  const runStart = Date.now();
  const submitted = await Promise.all(
    students.map(async (s) => {
      const t0 = Date.now();
      const res = await api('/submissions', {
        method: 'POST',
        token: s.token,
        body: { problem_id: problem.id, language: 'python', code: SOLUTION },
      });
      return { token: s.token, id: res.submission.id, submittedAt: t0, acceptedIn: Date.now() - t0 };
    })
  );
  const submitLatency = submitted.map((s) => s.acceptedIn);
  console.log(`  all ${submitted.length} accepted in ${((Date.now() - runStart) / 1000).toFixed(2)}s\n`);

  console.log('Waiting for grading...');
  const pending = new Map(submitted.map((s) => [s.id, s]));
  const endToEnd = [];
  const deadline = Date.now() + TIMEOUT_MS;

  while (pending.size > 0 && Date.now() < deadline) {
    await sleep(500);
    for (const [id, s] of [...pending]) {
      let poll;
      try {
        poll = await api(`/submissions/${id}`, { token: s.token });
      } catch {
        continue;
      }
      if (poll.status === 'completed' || poll.status === 'error') {
        endToEnd.push(Date.now() - s.submittedAt);
        pending.delete(id);
      }
    }
    process.stdout.write(`\r  ${endToEnd.length}/${submitted.length} graded   `);
  }
  const wall = (Date.now() - runStart) / 1000;
  console.log('\n');

  if (pending.size > 0) {
    console.log(`  ${pending.size} never finished within ${TIMEOUT_MS / 1000}s - is a worker running?`);
  }

  console.log('Results');
  report('accepted', submitLatency);
  report('end to end', endToEnd);
  console.log(
    `  ${'throughput'.padEnd(12)} ${(endToEnd.length / wall).toFixed(1)} submissions/second ` +
      `(${endToEnd.length} graded in ${wall.toFixed(1)}s)`
  );
  console.log(
    '\nNote: end-to-end includes the poll interval (up to 0.5s) and container startup per test case.'
  );
}

main().catch((err) => {
  console.error('\nLoad test failed:', err.message);
  process.exit(1);
});
