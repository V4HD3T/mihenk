/**
 * A scheduled exam's problems must not be readable before it starts.
 *
 * Until v0.1.2 they were. Every access check in the system asked one question -
 * "is this user in the problem's course?" - and an exam's problems belong to
 * the course by construction, so a student enrolled in the course could read
 * the whole paper the day before the exam: title, full description, starter
 * code and sample tests. They could also submit against it as ordinary
 * practice and get the hidden tests run for them, because the exam-window check
 * only ran when a submission carried an exam_id.
 *
 * These tests pin every door that was open. They are integration tests because
 * the rule is enforced in SQL, next to the course scope it extends.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import db from './helpers/db.js';

const available = await db.isAvailable();
const describeDb = available ? describe : describe.skip;

describeDb('exam problems are sealed until the exam starts', () => {
  let app;
  let teacher, student, outsider, course;
  let futureProblem, futureProblem2, startedProblem, practiceProblem;
  let futureExam, startedExam;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  async function registerUser(name, email, inviteCode) {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name, email, password: 'password123', ...(inviteCode ? { inviteCode } : {}) });
    expect(res.status).toBe(201);
    return { token: res.body.token, id: res.body.user.id };
  }

  async function makeProblem(title) {
    const res = await request(app)
      .post('/api/problems')
      .set(auth(teacher.token))
      .send({
        course_id: course.id,
        title,
        description: `secret description of ${title}`,
        starter_code_python: '# secret starter',
        testCases: [
          { input: '1', expected_output: '1', is_sample: true },
          { input: '2', expected_output: '2', is_sample: false },
        ],
      });
    expect(res.status).toBe(201);
    return res.body.problem;
  }

  async function makeExam(title, problemIds, startsInMs, perStudent) {
    const res = await request(app)
      .post('/api/exams')
      .set(auth(teacher.token))
      .send({
        course_id: course.id,
        title,
        start_time: new Date(Date.now() + startsInMs).toISOString(),
        end_time: new Date(Date.now() + startsInMs + 3600e3).toISOString(),
        duration_minutes: 60,
        problem_ids: problemIds,
        ...(perStudent ? { problems_per_student: perStudent } : {}),
      });
    expect(res.status).toBe(201);
    return res.body.exam;
  }

  beforeAll(async () => {
    db.applyEnv();
    await db.resetSchema();
    const appModule = await import('../src/app.js');
    app = appModule.default.createApp({ AUTH_RATE_LIMIT_MAX: 1000, RATE_LIMIT_MAX: 100000 });

    teacher = await registerUser('Teacher', 'gate-t@x.edu', 'test-invite-code');
    student = await registerUser('Student', 'gate-s@x.edu');
    outsider = await registerUser('Outsider', 'gate-o@x.edu');

    const c = await request(app)
      .post('/api/courses')
      .set(auth(teacher.token))
      .send({ title: 'Data Structures' });
    course = c.body.course;

    await request(app)
      .post('/api/courses/join')
      .set(auth(student.token))
      .send({ joinCode: course.join_code });

    futureProblem = await makeProblem('Tomorrow exam question');
    futureProblem2 = await makeProblem('Tomorrow exam question B');
    startedProblem = await makeProblem('Running exam question');
    practiceProblem = await makeProblem('Ordinary practice question');

    // Randomised, so that merely looking at it early would deal and persist a
    // set - the second thing an early peek used to buy.
    futureExam = await makeExam('Final', [futureProblem.id, futureProblem2.id], 86400e3, 1);
    startedExam = await makeExam('Midterm', [startedProblem.id], -3600e3); // started an hour ago
  });

  afterAll(async () => {
    await db.close();
  });

  describe('before the exam starts, to an enrolled student', () => {
    it('the problem detail is not readable', async () => {
      const res = await request(app)
        .get(`/api/problems/${futureProblem.id}`)
        .set(auth(student.token));
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('secret description');
    });

    it('the problem is not in the problem list', async () => {
      const res = await request(app).get('/api/problems').set(auth(student.token));
      const titles = res.body.problems.map((p) => p.title);
      expect(titles).not.toContain('Tomorrow exam question');
    });

    it('the exam detail exposes no problems', async () => {
      const res = await request(app)
        .get(`/api/exams/${futureExam.id}`)
        .set(auth(student.token));
      // The student still needs to know the exam exists and when it is.
      expect(res.status).toBe(200);
      expect(res.body.exam.title).toBe('Final');
      expect(res.body.problems).toEqual([]);
      expect(JSON.stringify(res.body)).not.toContain('Tomorrow exam question');
    });

    it('no random deal is recorded by looking early', async () => {
      const { rows } = await db
        .getPool()
        .query('SELECT * FROM exam_assignments WHERE exam_id = $1 AND user_id = $2', [
          futureExam.id,
          student.id,
        ]);
      expect(rows).toHaveLength(0);
    });

    // The hole that survived the exam-window check: submitting with no exam_id
    // skipped it entirely, so the hidden tests could be run against the paper.
    it('a practice submission against it is refused', async () => {
      const res = await request(app)
        .post('/api/submissions')
        .set(auth(student.token))
        .send({ problem_id: futureProblem.id, language: 'python', code: 'print(1)' });
      expect(res.status).toBe(404);
    });

    // Naming the exam explicitly is no better: the problem lookup now fails
    // first, so this reports 404 rather than the window check's 403. That is
    // the intended answer - "not yours" and "not yet" stay indistinguishable,
    // and the request is unreachable from the interface anyway.
    it('naming the exam explicitly is not a way in either', async () => {
      const res = await request(app)
        .post('/api/submissions')
        .set(auth(student.token))
        .send({ problem_id: futureProblem.id, exam_id: futureExam.id, language: 'python', code: 'x' });
      expect(res.status).toBe(404);
    });

    it('a draft cannot be parked against it', async () => {
      const res = await request(app)
        .put('/api/drafts')
        .set(auth(student.token))
        .send({ problem_id: futureProblem.id, language: 'python', code: 'x' });
      expect(res.status).toBe(404);
    });
  });

  describe('the seal is not over-broad', () => {
    it('the owning teacher still sees the problem', async () => {
      const res = await request(app)
        .get(`/api/problems/${futureProblem.id}`)
        .set(auth(teacher.token));
      expect(res.status).toBe(200);
      expect(res.body.problem.description).toContain('secret description');
    });

    it('the teacher still sees it in their list', async () => {
      const res = await request(app).get('/api/problems').set(auth(teacher.token));
      expect(res.body.problems.map((p) => p.title)).toContain('Tomorrow exam question');
    });

    it('an ordinary practice problem is unaffected', async () => {
      const res = await request(app)
        .get(`/api/problems/${practiceProblem.id}`)
        .set(auth(student.token));
      expect(res.status).toBe(200);
    });

    it('a problem whose exam has started is readable', async () => {
      const res = await request(app)
        .get(`/api/problems/${startedProblem.id}`)
        .set(auth(student.token));
      expect(res.status).toBe(200);
      expect(res.body.problem.description).toContain('secret description');
    });

    it('the started exam still lists its problems', async () => {
      const res = await request(app)
        .get(`/api/exams/${startedExam.id}`)
        .set(auth(student.token));
      expect(res.body.problems.map((p) => p.title)).toContain('Running exam question');
    });

    // The gate deliberately does not close again at the end, so a student can
    // go back over their paper - but the window check must still refuse the
    // late submission, with the message that explains why.
    it('a finished exam stays readable while refusing new submissions', async () => {
      const overProblem = await makeProblem('Finished exam question');
      const overExam = await makeExam('Last term', [overProblem.id], -7200e3);
      await db
        .getPool()
        .query('UPDATE exams SET end_time = NOW() - INTERVAL \'1 hour\' WHERE id = $1', [
          overExam.id,
        ]);

      const read = await request(app)
        .get(`/api/problems/${overProblem.id}`)
        .set(auth(student.token));
      expect(read.status).toBe(200);

      const submit = await request(app)
        .post('/api/submissions')
        .set(auth(student.token))
        .send({ problem_id: overProblem.id, exam_id: overExam.id, language: 'python', code: 'x' });
      expect(submit.status).toBe(403);
      expect(submit.body.error).toMatch(/no longer accepting/i);
    });

    it('someone outside the course sees nothing either way', async () => {
      for (const p of [futureProblem, startedProblem, practiceProblem]) {
        const res = await request(app).get(`/api/problems/${p.id}`).set(auth(outsider.token));
        expect(res.status).toBe(404);
      }
    });
  });
});
