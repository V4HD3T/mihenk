/**
 * The paper: what order the questions come in, what each is worth, and what
 * happens to work that arrives after the deadline.
 *
 * All three were listed as missing in v0.0.6 and v0.2.0. The ordering one is
 * the quiet defect of the three: problems came back ordered by primary key, so
 * a paper ran in the order its questions happened to be written and a warm-up
 * added last sorted to the end of the exam.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import db from './helpers/db.js';

const available = await db.isAvailable();
const describeDb = available ? describe : describe.skip;

describeDb('the exam paper', () => {
  let app;
  let teacher, student;
  let course;
  let easy, medium, hard;

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
        description: title,
        testCases: [{ input: '1', expected_output: '1', is_sample: true }],
      });
    expect(res.status).toBe(201);
    return res.body.problem;
  }

  async function makeExam(title, problemIds, startsInMs, extra = {}) {
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
        ...extra,
      });
    return res;
  }

  beforeAll(async () => {
    db.applyEnv();
    await db.resetSchema();
    const appModule = await import('../src/app.js');
    app = appModule.default.createApp({ AUTH_RATE_LIMIT_MAX: 1000, RATE_LIMIT_MAX: 100000 });

    teacher = await registerUser('Teacher', 'paper-t@x.edu', 'test-invite-code');
    student = await registerUser('Student', 'paper-s@x.edu');

    const c = await request(app)
      .post('/api/courses')
      .set(auth(teacher.token))
      .send({ title: 'Paper Course' });
    course = c.body.course;
    await request(app)
      .post('/api/courses/join')
      .set(auth(student.token))
      .send({ joinCode: course.join_code });

    // Written in this order, so primary-key order is easy < medium < hard and
    // any test that asks for a different order is asking for something the old
    // code could not do.
    easy = await makeProblem('Warm-up');
    medium = await makeProblem('Main question');
    hard = await makeProblem('Hard one');
  });

  afterAll(async () => {
    await db.close();
  });

  describe('question order', () => {
    it('follows the teacher’s order, not the problems’ ids', async () => {
      const created = await makeExam('Ordered', [hard.id, easy.id, medium.id], -60e3);
      expect(created.status).toBe(201);

      const res = await request(app)
        .get(`/api/exams/${created.body.exam.id}`)
        .set(auth(student.token));
      expect(res.status).toBe(200);
      expect(res.body.problems.map((p) => p.id)).toEqual([hard.id, easy.id, medium.id]);
    });

    it('survives an edit that reorders it', async () => {
      const created = await makeExam('Reordered', [easy.id, medium.id, hard.id], -60e3);
      const examId = created.body.exam.id;

      const edit = await request(app)
        .put(`/api/exams/${examId}`)
        .set(auth(teacher.token))
        .send({
          title: 'Reordered',
          start_time: new Date(Date.now() - 60e3).toISOString(),
          end_time: new Date(Date.now() + 3600e3).toISOString(),
          duration_minutes: 60,
          problem_ids: [medium.id, hard.id, easy.id],
        });
      expect(edit.status).toBe(200);

      const res = await request(app).get(`/api/exams/${examId}`).set(auth(student.token));
      expect(res.body.problems.map((p) => p.id)).toEqual([medium.id, hard.id, easy.id]);
    });
  });

  describe('marks', () => {
    it('divides 100 whole when no marks are given', async () => {
      // Three problems: 34+33+33, not 33+33+33. The remainder used to be
      // discarded, marking a three-problem paper out of 99.
      const created = await makeExam('Even', [easy.id, medium.id, hard.id], -60e3);
      const res = await request(app)
        .get(`/api/exams/${created.body.exam.id}`)
        .set(auth(teacher.token));
      const points = res.body.problems.map((p) => p.points);
      expect(points).toEqual([34, 33, 33]);
      expect(points.reduce((a, b) => a + b, 0)).toBe(100);
    });

    it('uses the marks the teacher set, in the order they were sent', async () => {
      const created = await makeExam('Weighted', [easy.id, medium.id, hard.id], -60e3, {
        points: [10, 30, 60],
      });
      expect(created.status).toBe(201);
      const res = await request(app)
        .get(`/api/exams/${created.body.exam.id}`)
        .set(auth(teacher.token));
      expect(res.body.problems.map((p) => [p.id, p.points])).toEqual([
        [easy.id, 10],
        [medium.id, 30],
        [hard.id, 60],
      ]);
    });

    it('does not have to add up to 100 - a paper can be marked out of anything', async () => {
      const created = await makeExam('Out of 40', [easy.id, medium.id], -60e3, { points: [20, 20] });
      expect(created.status).toBe(201);
    });

    it('refuses a partial list of marks rather than guessing the rest', async () => {
      const res = await makeExam('Partial', [easy.id, medium.id, hard.id], -60e3, {
        points: [50, 50],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/every problem/i);
    });
  });

  describe('late submissions', () => {
    /** An exam that ended a minute ago, with the given grace period. */
    async function endedExam(title, lateWindow, penalty) {
      const res = await request(app)
        .post('/api/exams')
        .set(auth(teacher.token))
        .send({
          course_id: course.id,
          title,
          start_time: new Date(Date.now() - 3600e3).toISOString(),
          end_time: new Date(Date.now() - 60e3).toISOString(),
          duration_minutes: 59,
          problem_ids: [easy.id],
          late_window_minutes: lateWindow,
          late_penalty_percent: penalty,
        });
      expect(res.status).toBe(201);
      return res.body.exam;
    }

    it('still refuses everything when no late window is set', async () => {
      // The pre-v2.1.0 behaviour, which is the default and must stay the
      // default: an exam that says nothing about lateness accepts nothing late.
      const exam = await endedExam('Strict', 0, 0);
      const res = await request(app)
        .post('/api/submissions')
        .set(auth(student.token))
        .send({ problem_id: easy.id, exam_id: exam.id, language: 'python', code: 'print(1)' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/no longer accepting/i);
    });

    it('accepts inside the window and records that it was late', async () => {
      const exam = await endedExam('Forgiving', 30, 25);
      const res = await request(app)
        .post('/api/submissions')
        .set(auth(student.token))
        .send({ problem_id: easy.id, exam_id: exam.id, language: 'python', code: 'print(1)' });
      expect(res.status).toBe(202);
      expect(res.body.submission.is_late).toBe(true);
      // Stamped onto the row, not looked up later: a teacher who lowers the
      // penalty next week must not silently re-mark work already graded.
      expect(res.body.submission.late_penalty_percent).toBe(25);
    });

    it('refuses once the window itself has passed', async () => {
      // Ended a minute ago with a 30-second grace period.
      const res = await request(app)
        .post('/api/exams')
        .set(auth(teacher.token))
        .send({
          course_id: course.id,
          title: 'Briefly forgiving',
          start_time: new Date(Date.now() - 3600e3).toISOString(),
          end_time: new Date(Date.now() - 120e3).toISOString(),
          duration_minutes: 58,
          problem_ids: [easy.id],
          late_window_minutes: 1,
          late_penalty_percent: 50,
        });
      const submit = await request(app)
        .post('/api/submissions')
        .set(auth(student.token))
        .send({
          problem_id: easy.id,
          exam_id: res.body.exam.id,
          language: 'python',
          code: 'print(1)',
        });
      expect(submit.status).toBe(403);
    });

    it('an on-time submission is not marked late', async () => {
      const res = await request(app)
        .post('/api/exams')
        .set(auth(teacher.token))
        .send({
          course_id: course.id,
          title: 'Running',
          start_time: new Date(Date.now() - 60e3).toISOString(),
          end_time: new Date(Date.now() + 3600e3).toISOString(),
          duration_minutes: 60,
          problem_ids: [easy.id],
          late_window_minutes: 30,
          late_penalty_percent: 50,
        });
      const submit = await request(app)
        .post('/api/submissions')
        .set(auth(student.token))
        .send({
          problem_id: easy.id,
          exam_id: res.body.exam.id,
          language: 'python',
          code: 'print(1)',
        });
      expect(submit.status).toBe(202);
      expect(submit.body.submission.is_late).toBe(false);
      expect(submit.body.submission.late_penalty_percent).toBe(0);
    });

    it('extra time delays the deadline the late window is measured from', async () => {
      // The two are different things and must add rather than overlap: extra
      // time says the deadline was never really at that hour for this student,
      // lateness says they missed it and it cost them. An accommodation must
      // not silently spend the student's grace period.
      const exam = await endedExam('Accommodated', 0, 0);
      const grant = await request(app)
        .put(`/api/exams/${exam.id}/accommodations/${student.id}`)
        .set(auth(teacher.token))
        .send({ extra_minutes: 30, note: 'DSA' });
      expect(grant.status).toBe(200);

      const res = await request(app)
        .post('/api/submissions')
        .set(auth(student.token))
        .send({ problem_id: easy.id, exam_id: exam.id, language: 'python', code: 'print(1)' });
      // Inside the extended deadline, so on time - not late, and not penalised.
      expect(res.status).toBe(202);
      expect(res.body.submission.is_late).toBe(false);
    });
  });
});
