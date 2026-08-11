/**
 * Enrolling a class from a list, and what an archived course refuses.
 *
 * Two limitations from v0.0.5, closed together because they meet on the same
 * routes. Students could only enrol themselves with a join code, which is fine
 * for a seminar and hopeless for a cohort of two hundred; and `archived`
 * stopped exactly one thing - joining - so last term's course stayed solvable,
 * its exams stayed open and its queue kept accepting work.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import db from './helpers/db.js';

const available = await db.isAvailable();
const describeDb = available ? describe : describe.skip;

describeDb('roster import and archived courses', () => {
  let app;
  let teacher, alice, bob, otherTeacher;
  let course, problem;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  async function registerUser(name, email, inviteCode) {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name, email, password: 'password123', ...(inviteCode ? { inviteCode } : {}) });
    expect(res.status).toBe(201);
    return { token: res.body.token, id: res.body.user.id, email };
  }

  const importRoster = (emails, token = teacher.token) =>
    request(app).post(`/api/courses/${course.id}/roster/import`).set(auth(token)).send({ emails });

  beforeAll(async () => {
    db.applyEnv();
    await db.resetSchema();
    const appModule = await import('../src/app.js');
    app = appModule.default.createApp({ AUTH_RATE_LIMIT_MAX: 1000, RATE_LIMIT_MAX: 100000 });

    teacher = await registerUser('Teacher', 'imp-t@x.edu', 'test-invite-code');
    otherTeacher = await registerUser('Other', 'imp-x@x.edu', 'test-invite-code');
    alice = await registerUser('Alice', 'alice@x.edu');
    bob = await registerUser('Bob', 'bob@x.edu');

    const c = await request(app)
      .post('/api/courses')
      .set(auth(teacher.token))
      .send({ title: 'Big Cohort' });
    course = c.body.course;

    const p = await request(app)
      .post('/api/problems')
      .set(auth(teacher.token))
      .send({
        course_id: course.id,
        title: 'P',
        description: 'd',
        testCases: [{ input: '1', expected_output: '1', is_sample: true }],
      });
    problem = p.body.problem;
  });

  afterAll(async () => {
    await db.close();
  });

  describe('importing a list', () => {
    it('enrols the accounts that exist', async () => {
      const res = await importRoster([alice.email, bob.email]);
      expect(res.status).toBe(200);
      expect(res.body.enrolled.sort()).toEqual([alice.email, bob.email].sort());

      const roster = await request(app)
        .get(`/api/courses/${course.id}/roster`)
        .set(auth(teacher.token));
      expect(roster.body.students.map((s) => s.id).sort()).toEqual([alice.id, bob.id].sort());
    });

    it('reports addresses with no account rather than creating them', async () => {
      // Minting logins for people who have not signed up means choosing
      // passwords for them and deciding on their behalf that they are in this
      // system at all. The import says who is missing and stops there.
      const res = await importRoster(['ghost@x.edu']);
      expect(res.status).toBe(200);
      expect(res.body.notFound).toEqual(['ghost@x.edu']);
      expect(res.body.enrolled).toEqual([]);

      const login = await request(app)
        .post('/api/auth/login')
        .send({ email: 'ghost@x.edu', password: 'password123' });
      expect(login.status).not.toBe(200);
    });

    it('is safe to run twice', async () => {
      // A teacher who is not sure whether the import worked will run it again,
      // and that must not read as a wall of failures.
      const again = await importRoster([alice.email, bob.email]);
      expect(again.status).toBe(200);
      expect(again.body.enrolled).toEqual([]);
      expect(again.body.alreadyEnrolled).toBe(2);
      expect(again.body.notFound).toEqual([]);
    });

    it('will not enrol a teacher account as a student', async () => {
      // They would get a student's view of a course they may also teach, which
      // is two answers to the same question.
      const res = await importRoster([otherTeacher.email]);
      expect(res.body.notStudents).toEqual([otherTeacher.email]);
      expect(res.body.enrolled).toEqual([]);
    });

    it('ignores case and stray whitespace', async () => {
      const carol = await registerUser('Carol', 'carol@x.edu');
      const res = await importRoster(['  CAROL@X.EDU  ']);
      expect(res.body.enrolled).toEqual(['carol@x.edu']);
      expect(res.body.notFound).toEqual([]);
      expect(carol.id).toBeTruthy();
    });

    it('counts a duplicated address once', async () => {
      const dave = await registerUser('Dave', 'dave@x.edu');
      const res = await importRoster([dave.email, dave.email, dave.email]);
      expect(res.body.enrolled).toEqual([dave.email]);
    });

    it('is refused to a teacher who does not teach the course', async () => {
      const res = await importRoster([alice.email], otherTeacher.token);
      expect(res.status).toBe(404);
    });

    it('rejects a list longer than a class', async () => {
      const many = Array.from({ length: 501 }, (_, i) => `s${i}@x.edu`);
      const res = await importRoster(many);
      expect(res.status).toBe(400);
    });
  });

  describe('an archived course is closed, not merely hidden', () => {
    beforeAll(async () => {
      const res = await request(app)
        .put(`/api/courses/${course.id}`)
        .set(auth(teacher.token))
        .send({ archived: true });
      expect(res.status).toBe(200);
      expect(res.body.course.archived).toBe(true);
    });

    it('takes no more submissions', async () => {
      // The one that mattered: before v2.3.0 an archived course kept grading.
      const res = await request(app)
        .post('/api/submissions')
        .set(auth(alice.token))
        .send({ problem_id: problem.id, language: 'python', code: 'print(1)' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/archived/i);
    });

    it('takes no new problems or exams', async () => {
      const newProblem = await request(app)
        .post('/api/problems')
        .set(auth(teacher.token))
        .send({
          course_id: course.id,
          title: 'Late addition',
          description: 'd',
          testCases: [{ input: '1', expected_output: '1', is_sample: true }],
        });
      expect(newProblem.status).toBe(403);

      const newExam = await request(app)
        .post('/api/exams')
        .set(auth(teacher.token))
        .send({
          course_id: course.id,
          title: 'Late exam',
          start_time: new Date(Date.now() + 3600e3).toISOString(),
          end_time: new Date(Date.now() + 7200e3).toISOString(),
          duration_minutes: 60,
          problem_ids: [problem.id],
        });
      expect(newExam.status).toBe(403);
    });

    it('takes no more students, by code or by import', async () => {
      const eve = await registerUser('Eve', 'eve@x.edu');
      const byCode = await request(app)
        .post('/api/courses/join')
        .set(auth(eve.token))
        .send({ joinCode: course.join_code });
      expect(byCode.status).toBe(403);

      const byImport = await importRoster([eve.email]);
      expect(byImport.status).toBe(403);
    });

    it('is still readable - archiving is not deleting', async () => {
      // Students must still be able to look back over last term's work, which
      // is the entire difference between archiving a course and removing it.
      const detail = await request(app)
        .get(`/api/problems/${problem.id}`)
        .set(auth(alice.token));
      expect(detail.status).toBe(200);

      const courses = await request(app).get('/api/courses').set(auth(alice.token));
      expect(courses.body.courses.map((c) => c.id)).toContain(course.id);
    });

    it('reopens when unarchived', async () => {
      await request(app)
        .put(`/api/courses/${course.id}`)
        .set(auth(teacher.token))
        .send({ archived: false });

      const res = await request(app)
        .post('/api/submissions')
        .set(auth(alice.token))
        .send({ problem_id: problem.id, language: 'python', code: 'print(1)' });
      expect(res.status).toBe(202);
    });
  });
});
