/**
 * A make-up sitting must not publish its paper to the students still due to
 * take it.
 *
 * v0.1.2 sealed an exam's problems until it starts and wrote down what it could
 * not fix: an exam had no roster, so "has it started" was asked of the course
 * rather than of the sitting. Two sittings of one paper in one course therefore
 * shared visibility - the moment the first sitting opened, the questions were
 * readable by everyone in the course, including exactly those people who had
 * not sat it yet.
 *
 * The first test here is that leak, written against the arrangement that
 * produces it: one paper, two sittings, an hour apart. Under v2.0.1 it passes
 * the read and fails this file.
 *
 * Integration tests because the rule lives in SQL, next to the course scope and
 * the exam gate it extends.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import db from './helpers/db.js';

const available = await db.isAvailable();
const describeDb = available ? describe : describe.skip;

describeDb('per-exam rosters', () => {
  let app;
  let teacher, morning, afternoon, everyone;
  let course, paper, sharedProblem;
  let morningSitting, makeUpSitting;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  async function registerUser(name, email, inviteCode) {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name, email, password: 'password123', ...(inviteCode ? { inviteCode } : {}) });
    expect(res.status).toBe(201);
    return { token: res.body.token, id: res.body.user.id };
  }

  async function enrol(user) {
    const res = await request(app)
      .post('/api/courses/join')
      .set(auth(user.token))
      .send({ joinCode: course.join_code });
    expect([200, 201]).toContain(res.status);
  }

  async function makeProblem(title) {
    const res = await request(app)
      .post('/api/problems')
      .set(auth(teacher.token))
      .send({
        course_id: course.id,
        title,
        description: `SECRET BODY OF ${title}`,
        starter_code_python: '# secret starter',
        testCases: [
          { input: '1', expected_output: '1', is_sample: true },
          { input: '2', expected_output: '2', is_sample: false },
        ],
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
    expect(res.status).toBe(201);
    return res.body.exam;
  }

  beforeAll(async () => {
    db.applyEnv();
    await db.resetSchema();
    const appModule = await import('../src/app.js');
    app = appModule.default.createApp({ AUTH_RATE_LIMIT_MAX: 1000, RATE_LIMIT_MAX: 100000 });

    teacher = await registerUser('Teacher', 'roster-t@x.edu', 'test-invite-code');
    morning = await registerUser('Morning Student', 'roster-m@x.edu');
    afternoon = await registerUser('Afternoon Student', 'roster-a@x.edu');
    everyone = await registerUser('Unrostered Student', 'roster-e@x.edu');

    const c = await request(app)
      .post('/api/courses')
      .set(auth(teacher.token))
      .send({ title: 'Algorithms' });
    course = c.body.course;
    for (const s of [morning, afternoon, everyone]) await enrol(s);

    sharedProblem = await makeProblem('The one question on both sittings');
    paper = [sharedProblem.id];

    // The arrangement that produced the leak: the same paper twice, the first
    // sitting already running, the make-up still to come.
    morningSitting = await makeExam('Midterm', paper, -3600e3, { user_ids: [morning.id] });
    makeUpSitting = await makeExam('Midterm (make-up)', paper, 86400e3, {
      user_ids: [afternoon.id],
    });
  });

  afterAll(async () => {
    await db.close();
  });

  describe('the leak v0.1.2 documented and could not close', () => {
    it('a student sitting the make-up cannot read the paper the morning sitting opened', async () => {
      const res = await request(app)
        .get(`/api/problems/${sharedProblem.id}`)
        .set(auth(afternoon.token));
      expect(res.status).toBe(404);
    });

    it('nor find it in the problem list', async () => {
      const res = await request(app).get('/api/problems').set(auth(afternoon.token));
      expect(res.status).toBe(200);
      expect(res.body.problems.map((p) => p.id)).not.toContain(sharedProblem.id);
    });

    it('nor get its hidden tests run by submitting as practice', async () => {
      // The better leak of the two: reading gives you the paper, submitting
      // tells you whether your answer is right.
      const res = await request(app)
        .post('/api/submissions')
        .set(auth(afternoon.token))
        .send({ problem_id: sharedProblem.id, language: 'python', code: 'print(1)' });
      expect(res.status).toBe(404);
    });

    it('nor park a draft against it', async () => {
      const res = await request(app)
        .post('/api/drafts')
        .set(auth(afternoon.token))
        .send({ problem_id: sharedProblem.id, language: 'python', code: 'notes' });
      expect(res.status).toBe(404);
    });
  });

  describe('an exam you do not sit is not yours to know about', () => {
    it('the make-up sitting is not in the morning student’s exam list', async () => {
      const res = await request(app).get('/api/exams').set(auth(morning.token));
      expect(res.status).toBe(200);
      const titles = res.body.exams.map((e) => e.title);
      expect(titles).toContain('Midterm');
      // Not merely problem-less: absent. Listing it would tell the morning
      // cohort that a second sitting of their paper is scheduled, and when.
      expect(titles).not.toContain('Midterm (make-up)');
    });

    it('reading it directly is a 404, indistinguishable from another course’s exam', async () => {
      const res = await request(app)
        .get(`/api/exams/${makeUpSitting.id}`)
        .set(auth(morning.token));
      expect(res.status).toBe(404);
    });

    it('submitting to it is the same 404, not a 403 that confirms it exists', async () => {
      const res = await request(app)
        .post('/api/submissions')
        .set(auth(morning.token))
        .send({
          problem_id: sharedProblem.id,
          exam_id: makeUpSitting.id,
          language: 'python',
          code: 'print(1)',
        });
      expect(res.status).toBe(404);
    });
  });

  describe('the roster is not over-broad', () => {
    it('the student who sits the running exam still reads its problem', async () => {
      const res = await request(app)
        .get(`/api/problems/${sharedProblem.id}`)
        .set(auth(morning.token));
      expect(res.status).toBe(200);
      expect(res.body.problem.description).toMatch(/SECRET BODY/);
    });

    it('and still sees it on their own exam', async () => {
      const res = await request(app)
        .get(`/api/exams/${morningSitting.id}`)
        .set(auth(morning.token));
      expect(res.status).toBe(200);
      expect(res.body.problems.map((p) => p.id)).toEqual([sharedProblem.id]);
    });

    it('the owning teacher sees both sittings and both papers', async () => {
      const list = await request(app).get('/api/exams').set(auth(teacher.token));
      const titles = list.body.exams.map((e) => e.title);
      expect(titles).toContain('Midterm');
      expect(titles).toContain('Midterm (make-up)');

      const detail = await request(app)
        .get(`/api/exams/${makeUpSitting.id}`)
        .set(auth(teacher.token));
      expect(detail.status).toBe(200);
      expect(detail.body.problems).toHaveLength(1);
    });

    it('an exam with no roster is still sat by the whole course', async () => {
      // The compatibility case, and the common one. Every exam that existed
      // before this release has no roster row.
      const practice = await makeProblem('Everyone question');
      const open = await makeExam('Quiz for everyone', [practice.id], -60e3);

      for (const s of [morning, afternoon, everyone]) {
        const res = await request(app).get(`/api/exams/${open.id}`).set(auth(s.token));
        expect(res.status).toBe(200);
        expect(res.body.problems).toHaveLength(1);
      }
    });
  });

  describe('managing the roster', () => {
    it('reports whole_course when empty, and the names when not', async () => {
      const empty = await request(app)
        .get(`/api/exams/${morningSitting.id}/roster`)
        .set(auth(teacher.token));
      expect(empty.status).toBe(200);
      expect(empty.body.whole_course).toBe(false);
      expect(empty.body.roster.map((r) => r.user_id)).toEqual([morning.id]);
    });

    it('refuses to name someone who is not enrolled in the course', async () => {
      // Otherwise a roster is a second, quieter enrolment path: it would hand a
      // course's paper to someone who was never in the course.
      const stranger = await registerUser('Stranger', 'roster-x@x.edu');
      const res = await request(app)
        .put(`/api/exams/${morningSitting.id}/roster`)
        .set(auth(teacher.token))
        .send({ user_ids: [stranger.id] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/enrolled/i);
    });

    it('clearing it hands the exam back to the whole course', async () => {
      const cleared = await request(app)
        .put(`/api/exams/${makeUpSitting.id}/roster`)
        .set(auth(teacher.token))
        .send({ user_ids: [] });
      expect(cleared.status).toBe(200);
      expect(cleared.body.whole_course).toBe(true);

      // It is still in the future, so the morning student can see that it
      // exists but not what is on it - the ordinary v0.1.2 seal, now that the
      // roster no longer excludes them.
      const list = await request(app).get('/api/exams').set(auth(morning.token));
      expect(list.body.exams.map((e) => e.title)).toContain('Midterm (make-up)');

      const detail = await request(app)
        .get(`/api/exams/${makeUpSitting.id}`)
        .set(auth(morning.token));
      expect(detail.status).toBe(200);
      expect(detail.body.problems).toEqual([]);

      // Put it back, so the ordering of tests in this file cannot matter.
      await request(app)
        .put(`/api/exams/${makeUpSitting.id}/roster`)
        .set(auth(teacher.token))
        .send({ user_ids: [afternoon.id] });
    });

    it('a teacher who does not own the exam cannot read or set the roster', async () => {
      const other = await registerUser('Other Teacher', 'roster-t2@x.edu', 'test-invite-code');
      const read = await request(app)
        .get(`/api/exams/${morningSitting.id}/roster`)
        .set(auth(other.token));
      expect(read.status).toBe(404);

      const write = await request(app)
        .put(`/api/exams/${morningSitting.id}/roster`)
        .set(auth(other.token))
        .send({ user_ids: [] });
      expect(write.status).toBe(404);
    });

    it('a student cannot read the roster of an exam they sit', async () => {
      const res = await request(app)
        .get(`/api/exams/${morningSitting.id}/roster`)
        .set(auth(morning.token));
      expect(res.status).toBe(403);
    });
  });
});
