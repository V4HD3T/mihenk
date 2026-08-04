/**
 * Course isolation, against a real PostgreSQL.
 *
 * The question these tests answer: can a user reach content belonging to a
 * course they are not in? Until v0.0.5 the answer was yes for every endpoint
 * here - any authenticated user could read every problem, exam and student in
 * the system, and any teacher could edit any other teacher's content.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import db from './helpers/db.js';

const available = await db.isAvailable();
const describeDb = available ? describe : describe.skip;

if (!available) {
  console.warn(
    `\n[integration] No PostgreSQL at ${db.dbConfig.host}:${db.dbConfig.port}/${db.dbConfig.database} - skipping course isolation tests.\n` +
      '[integration] Start one with: docker run -d --name codecloud-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=codecloud_test -p 55432:5432 postgres:16-alpine\n'
  );
}

describeDb('course isolation', () => {
  let app;
  let alice; // teacher of course A
  let bob; // teacher of course B
  let sam; // student enrolled only in course A
  let eve; // student enrolled only in course B
  let courseA, courseB, problemA, problemB, examA;

  const auth = (token) => ({ Authorization: `Bearer ${token}` });

  async function registerUser(name, email, inviteCode) {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name, email, password: 'password123', ...(inviteCode ? { inviteCode } : {}) });
    expect(res.status).toBe(201);
    return { token: res.body.token, id: res.body.user.id, role: res.body.user.role };
  }

  beforeAll(async () => {
    db.applyEnv();
    await db.resetSchema();

    // Imported after applyEnv so the pool connects to the test database.
    const appModule = await import('../src/app.js');
    // These suites register many accounts; the production auth rate limit would
    // otherwise reject the later ones and mask the real assertions.
    app = appModule.default.createApp({ AUTH_RATE_LIMIT_MAX: 1000, RATE_LIMIT_MAX: 100000 });

    alice = await registerUser('Alice', 'alice@x.edu', 'test-invite-code');
    bob = await registerUser('Bob', 'bob@x.edu', 'test-invite-code');
    sam = await registerUser('Sam', 'sam@x.edu');
    eve = await registerUser('Eve', 'eve@x.edu');
    expect(alice.role).toBe('teacher');
    expect(sam.role).toBe('student');

    const a = await request(app).post('/api/courses').set(auth(alice.token)).send({ title: 'Course A' });
    const b = await request(app).post('/api/courses').set(auth(bob.token)).send({ title: 'Course B' });
    expect(a.status).toBe(201);
    courseA = a.body.course;
    courseB = b.body.course;

    await request(app).post('/api/courses/join').set(auth(sam.token)).send({ joinCode: courseA.join_code });
    await request(app).post('/api/courses/join').set(auth(eve.token)).send({ joinCode: courseB.join_code });

    const pa = await request(app)
      .post('/api/problems')
      .set(auth(alice.token))
      .send({
        course_id: courseA.id,
        title: 'A-only problem',
        description: 'secret to course A',
        testCases: [{ input: '1', expected_output: '2', is_sample: true }],
      });
    expect(pa.status).toBe(201);
    problemA = pa.body.problem;

    const pb = await request(app)
      .post('/api/problems')
      .set(auth(bob.token))
      .send({
        course_id: courseB.id,
        title: 'B-only problem',
        description: 'secret to course B',
        testCases: [{ input: '1', expected_output: '2', is_sample: true }],
      });
    problemB = pb.body.problem;

    const ea = await request(app)
      .post('/api/exams')
      .set(auth(alice.token))
      .send({
        course_id: courseA.id,
        title: 'A midterm',
        start_time: new Date(Date.now() - 3600e3).toISOString(),
        end_time: new Date(Date.now() + 3600e3).toISOString(),
        duration_minutes: 60,
        problem_ids: [problemA.id],
      });
    expect(ea.status).toBe(201);
    examA = ea.body.exam;
  });

  afterAll(async () => {
    await db.close();
  });

  describe('students see only their own course', () => {
    it("lists only the enrolled course's problems", async () => {
      const res = await request(app).get('/api/problems').set(auth(sam.token));
      expect(res.status).toBe(200);
      const titles = res.body.problems.map((p) => p.title);
      expect(titles).toContain('A-only problem');
      expect(titles).not.toContain('B-only problem');
    });

    it("cannot open another course's problem", async () => {
      const res = await request(app).get(`/api/problems/${problemB.id}`).set(auth(sam.token));
      expect(res.status).toBe(404);
    });

    it("cannot submit to another course's problem", async () => {
      const res = await request(app)
        .post('/api/submissions')
        .set(auth(sam.token))
        .send({ problem_id: problemB.id, language: 'python', code: 'print(1)' });
      expect(res.status).toBe(404);
    });

    it("cannot see another course's exam", async () => {
      const res = await request(app).get(`/api/exams/${examA.id}`).set(auth(eve.token));
      expect(res.status).toBe(404);
    });

    it('sees its own exam', async () => {
      const res = await request(app).get(`/api/exams/${examA.id}`).set(auth(sam.token));
      expect(res.status).toBe(200);
      expect(res.body.exam.title).toBe('A midterm');
    });

    it('never receives the join code, which is the credential to enter', async () => {
      const res = await request(app).get(`/api/courses/${courseA.id}`).set(auth(sam.token));
      expect(res.status).toBe(200);
      expect(res.body.course.join_code).toBeUndefined();
    });
  });

  describe("teachers cannot reach another teacher's course", () => {
    it("cannot read another teacher's problem", async () => {
      const res = await request(app).get(`/api/problems/${problemB.id}`).set(auth(alice.token));
      expect(res.status).toBe(404);
    });

    it("cannot edit another teacher's problem", async () => {
      const res = await request(app)
        .put(`/api/problems/${problemB.id}`)
        .set(auth(alice.token))
        .send({ title: 'hijacked', description: 'x', difficulty: 'easy' });
      expect(res.status).toBe(404);

      // and it really is unchanged
      const check = await request(app).get(`/api/problems/${problemB.id}`).set(auth(bob.token));
      expect(check.body.problem.title).toBe('B-only problem');
    });

    it("cannot delete another teacher's problem", async () => {
      const res = await request(app).delete(`/api/problems/${problemB.id}`).set(auth(alice.token));
      expect(res.status).toBe(404);
      const check = await request(app).get(`/api/problems/${problemB.id}`).set(auth(bob.token));
      expect(check.status).toBe(200);
    });

    it("cannot add a test case to another teacher's problem", async () => {
      const res = await request(app)
        .post(`/api/problems/${problemB.id}/testcases`)
        .set(auth(alice.token))
        .send({ input: '', expected_output: 'leak', is_sample: false });
      expect(res.status).toBe(404);
    });

    it("cannot read another course's submissions", async () => {
      const res = await request(app)
        .get(`/api/submissions/problem/${problemB.id}`)
        .set(auth(alice.token));
      expect(res.status).toBe(404);
    });

    it("cannot read another course's similarity report", async () => {
      const res = await request(app)
        .get(`/api/integrity/problem/${problemB.id}/similarity`)
        .set(auth(alice.token));
      expect(res.status).toBe(404);
    });

    it("cannot create content in another teacher's course", async () => {
      const res = await request(app)
        .post('/api/problems')
        .set(auth(alice.token))
        .send({
          course_id: courseB.id,
          title: 'planted',
          description: 'x',
          testCases: [{ input: '', expected_output: '1' }],
        });
      expect(res.status).toBe(404);
    });

    it("cannot see students who are only in another teacher's course", async () => {
      const res = await request(app).get('/api/users/students').set(auth(alice.token));
      expect(res.status).toBe(200);
      const emails = res.body.students.map((s) => s.email);
      expect(emails).toContain('sam@x.edu');
      expect(emails).not.toContain('eve@x.edu');
    });

    it("cannot read the roster of another teacher's course", async () => {
      const res = await request(app).get(`/api/courses/${courseB.id}/roster`).set(auth(alice.token));
      expect(res.status).toBe(404);
    });

    it('counts only its own course in analytics', async () => {
      const res = await request(app).get('/api/analytics/overview').set(auth(alice.token));
      expect(res.status).toBe(200);
      expect(Number(res.body.totals.problem_count)).toBe(1);
    });
  });

  describe('exam integrity', () => {
    it('refuses to build an exam from another course’s problems', async () => {
      const res = await request(app)
        .post('/api/exams')
        .set(auth(alice.token))
        .send({
          course_id: courseA.id,
          title: 'mixed',
          start_time: new Date().toISOString(),
          end_time: new Date(Date.now() + 3600e3).toISOString(),
          duration_minutes: 30,
          problem_ids: [problemA.id, problemB.id],
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/same course/i);
    });
  });

  describe('enrolment', () => {
    it('lets a student join with a valid code and then see the content', async () => {
      const before = await request(app).get('/api/problems').set(auth(eve.token));
      expect(before.body.problems.map((p) => p.title)).not.toContain('A-only problem');

      const join = await request(app)
        .post('/api/courses/join')
        .set(auth(eve.token))
        .send({ joinCode: courseA.join_code });
      expect(join.status).toBe(201);

      const after = await request(app).get('/api/problems').set(auth(eve.token));
      expect(after.body.problems.map((p) => p.title)).toContain('A-only problem');
    });

    it('rejects an unknown join code', async () => {
      const res = await request(app)
        .post('/api/courses/join')
        .set(auth(sam.token))
        .send({ joinCode: 'NOTACODE' });
      expect(res.status).toBe(404);
    });

    it('removing a student revokes their access again', async () => {
      await request(app)
        .delete(`/api/courses/${courseA.id}/roster/${eve.id}`)
        .set(auth(alice.token))
        .expect(200);

      const after = await request(app).get('/api/problems').set(auth(eve.token));
      expect(after.body.problems.map((p) => p.title)).not.toContain('A-only problem');
    });

    it('regenerating the join code invalidates the old one', async () => {
      const oldCode = courseA.join_code;
      const regen = await request(app)
        .post(`/api/courses/${courseA.id}/regenerate-code`)
        .set(auth(alice.token));
      expect(regen.status).toBe(200);
      expect(regen.body.joinCode).not.toBe(oldCode);

      const res = await request(app)
        .post('/api/courses/join')
        .set(auth(eve.token))
        .send({ joinCode: oldCode });
      expect(res.status).toBe(404);
    });
  });
});
