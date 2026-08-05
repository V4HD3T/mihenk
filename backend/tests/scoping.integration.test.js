/**
 * Reported numbers must count only what the reader is entitled to see.
 *
 * Access control was applied carefully to the *rows* these endpoints return and
 * not always to the *counts* beside them, which leaks the same information more
 * quietly. Two cases survived to v0.1.2:
 *
 *   - a student's progress denominator counted every problem on the server,
 *     including courses they had never joined, so "3 / 47" was both wrong and a
 *     running total of the whole installation
 *   - a teacher's student list counted submissions from other teachers' courses,
 *     so one teacher could see how active a student was elsewhere
 *
 * The sibling endpoint /users/students/:id scoped correctly all along, which is
 * what makes these worth pinning: the rule was known, just not applied evenly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import db from './helpers/db.js';

const available = await db.isAvailable();
const describeDb = available ? describe : describe.skip;

describeDb('counts respect course scope', () => {
  let app;
  let t1, t2, shared, elsewhere, c1, c2;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  async function registerUser(name, email, inviteCode) {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name, email, password: 'password123', ...(inviteCode ? { inviteCode } : {}) });
    expect(res.status).toBe(201);
    return { token: res.body.token, id: res.body.user.id };
  }

  async function makeCourse(token, title) {
    const res = await request(app).post('/api/courses').set(auth(token)).send({ title });
    expect(res.status).toBe(201);
    return res.body.course;
  }

  async function makeProblem(token, courseId, title) {
    const res = await request(app)
      .post('/api/problems')
      .set(auth(token))
      .send({
        course_id: courseId,
        title,
        description: 'd',
        testCases: [{ input: '1', expected_output: '1', is_sample: true }],
      });
    expect(res.status).toBe(201);
    return res.body.problem;
  }

  beforeAll(async () => {
    db.applyEnv();
    await db.resetSchema();
    const appModule = await import('../src/app.js');
    app = appModule.default.createApp({ AUTH_RATE_LIMIT_MAX: 1000, RATE_LIMIT_MAX: 100000 });

    t1 = await registerUser('Teacher One', 'scope-t1@x.edu', 'test-invite-code');
    t2 = await registerUser('Teacher Two', 'scope-t2@x.edu', 'test-invite-code');
    // In both courses; does all their work in T2's.
    shared = await registerUser('Shared Student', 'scope-shared@x.edu');
    // Only in T1's course, which holds one problem out of four on the server.
    elsewhere = await registerUser('Narrow Student', 'scope-narrow@x.edu');

    c1 = await makeCourse(t1.token, 'T1 course');
    c2 = await makeCourse(t2.token, 'T2 course');

    for (const code of [c1.join_code, c2.join_code]) {
      await request(app).post('/api/courses/join').set(auth(shared.token)).send({ joinCode: code });
    }
    await request(app)
      .post('/api/courses/join')
      .set(auth(elsewhere.token))
      .send({ joinCode: c1.join_code });

    await makeProblem(t1.token, c1.id, 'T1 P1');
    const p2 = await makeProblem(t2.token, c2.id, 'T2 P1');
    await makeProblem(t2.token, c2.id, 'T2 P2');
    await makeProblem(t2.token, c2.id, 'T2 P3');

    // Three submissions, all inside T2's course.
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .post('/api/submissions')
        .set(auth(shared.token))
        .send({ problem_id: p2.id, language: 'python', code: `print(${i})` });
      expect(res.status).toBe(202);
    }
  });

  afterAll(async () => {
    await db.close();
  });

  it('a student’s progress denominator counts only reachable problems', async () => {
    const res = await request(app).get('/api/analytics/me').set(auth(elsewhere.token));
    // One course, one problem - not the four that exist on the server.
    expect(res.body.totalProblems).toBe(1);
  });

  it('a student in two courses counts both', async () => {
    const res = await request(app).get('/api/analytics/me').set(auth(shared.token));
    expect(res.body.totalProblems).toBe(4);
  });

  it('a teacher’s student list counts only work in their own courses', async () => {
    const res = await request(app).get('/api/users/students').set(auth(t1.token));
    const row = res.body.students.find((s) => s.name === 'Shared Student');
    expect(row).toBeTruthy();
    expect(Number(row.submission_count)).toBe(0);
  });

  it('the teacher who owns the work still sees it', async () => {
    const res = await request(app).get('/api/users/students').set(auth(t2.token));
    const row = res.body.students.find((s) => s.name === 'Shared Student');
    expect(Number(row.submission_count)).toBe(3);
  });

  it('the student list itself is still scoped to the teacher', async () => {
    const res = await request(app).get('/api/users/students').set(auth(t1.token));
    const names = res.body.students.map((s) => s.name).sort();
    expect(names).toEqual(['Narrow Student', 'Shared Student']);
  });
});

describeDb('exam points are distributed whole', () => {
  let app, teacher, course;
  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  beforeAll(async () => {
    db.applyEnv();
    await db.resetSchema();
    const appModule = await import('../src/app.js');
    app = appModule.default.createApp({ AUTH_RATE_LIMIT_MAX: 1000, RATE_LIMIT_MAX: 100000 });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'T', email: 'pts-t@x.edu', password: 'password123', inviteCode: 'test-invite-code' });
    teacher = { token: res.body.token };
    course = (
      await request(app).post('/api/courses').set(auth(teacher.token)).send({ title: 'Points' })
    ).body.course;
  });

  afterAll(async () => {
    await db.close();
  });

  // floor(100/n) silently threw the remainder away: three problems were worth
  // 33 each and the paper totalled 99.
  it.each([1, 2, 3, 6, 7, 8, 9])('an exam of %i problems is worth 100', async (n) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
      const p = await request(app)
        .post('/api/problems')
        .set(auth(teacher.token))
        .send({
          course_id: course.id,
          title: `P${n}-${i}`,
          description: 'd',
          testCases: [{ input: '1', expected_output: '1', is_sample: true }],
        });
      ids.push(p.body.problem.id);
    }

    const exam = await request(app)
      .post('/api/exams')
      .set(auth(teacher.token))
      .send({
        course_id: course.id,
        title: `Exam of ${n}`,
        start_time: new Date(Date.now() - 3600e3).toISOString(),
        end_time: new Date(Date.now() + 3600e3).toISOString(),
        duration_minutes: 60,
        problem_ids: ids,
      });
    expect(exam.status).toBe(201);

    const detail = await request(app)
      .get(`/api/exams/${exam.body.exam.id}`)
      .set(auth(teacher.token));
    const points = detail.body.problems.map((p) => p.points);
    expect(points).toHaveLength(n);
    expect(points.reduce((a, b) => a + b, 0)).toBe(100);
    // The remainder is spread one point at a time, never dumped on one problem.
    expect(Math.max(...points) - Math.min(...points)).toBeLessThanOrEqual(1);
  });
});
