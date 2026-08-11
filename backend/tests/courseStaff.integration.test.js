/**
 * A course can have more than one teacher.
 *
 * Since v0.0.5 it has had exactly one - whoever created it - and that has been
 * listed as a limitation ever since. A class with a lecturer and two assistants
 * had to share one login, which makes every grade override, accommodation and
 * integrity decision attributable to nobody in particular.
 *
 * The risk in this change is not that an assistant can do too little. It is
 * that they can do too much: every access check in the system asked "did you
 * create this course", and widening that question is the kind of edit that
 * quietly widens more than intended. Most of this file is therefore about what
 * an assistant still cannot do, and about the courses they were never given.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import db from './helpers/db.js';

const available = await db.isAvailable();
const describeDb = available ? describe : describe.skip;

describeDb('teaching assistants', () => {
  let app;
  let owner, assistant, otherTeacher, student;
  let course, otherCourse, problem;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  async function registerUser(name, email, inviteCode) {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name, email, password: 'password123', ...(inviteCode ? { inviteCode } : {}) });
    expect(res.status).toBe(201);
    return { token: res.body.token, id: res.body.user.id, email };
  }

  async function makeCourse(token, title) {
    const res = await request(app).post('/api/courses').set(auth(token)).send({ title });
    expect(res.status).toBe(201);
    return res.body.course;
  }

  beforeAll(async () => {
    db.applyEnv();
    await db.resetSchema();
    const appModule = await import('../src/app.js');
    app = appModule.default.createApp({ AUTH_RATE_LIMIT_MAX: 1000, RATE_LIMIT_MAX: 100000 });

    owner = await registerUser('Owner', 'staff-o@x.edu', 'test-invite-code');
    assistant = await registerUser('Assistant', 'staff-a@x.edu', 'test-invite-code');
    otherTeacher = await registerUser('Other', 'staff-x@x.edu', 'test-invite-code');
    student = await registerUser('Student', 'staff-s@x.edu');

    course = await makeCourse(owner.token, 'Algorithms');
    otherCourse = await makeCourse(otherTeacher.token, 'Someone else’s course');

    await request(app)
      .post('/api/courses/join')
      .set(auth(student.token))
      .send({ joinCode: course.join_code });

    const p = await request(app)
      .post('/api/problems')
      .set(auth(owner.token))
      .send({
        course_id: course.id,
        title: 'Double it',
        description: 'd',
        testCases: [{ input: '1', expected_output: '2', is_sample: true }],
      });
    problem = p.body.problem;

    const appoint = await request(app)
      .post(`/api/courses/${course.id}/staff`)
      .set(auth(owner.token))
      .send({ email: assistant.email });
    expect(appoint.status).toBe(201);
  });

  afterAll(async () => {
    await db.close();
  });

  describe('what an assistant can do', () => {
    it('sees the course they assist with', async () => {
      const res = await request(app).get('/api/courses').set(auth(assistant.token));
      expect(res.status).toBe(200);
      expect(res.body.courses.map((c) => c.id)).toContain(course.id);
    });

    it('reads its problems, including the ones they did not write', async () => {
      const res = await request(app)
        .get(`/api/problems/${problem.id}`)
        .set(auth(assistant.token));
      expect(res.status).toBe(200);
      expect(res.body.testCases).toHaveLength(1);
    });

    it('writes a problem of their own in that course', async () => {
      const res = await request(app)
        .post('/api/problems')
        .set(auth(assistant.token))
        .send({
          course_id: course.id,
          title: 'Assistant’s problem',
          description: 'd',
          testCases: [{ input: '1', expected_output: '1', is_sample: true }],
        });
      expect(res.status).toBe(201);
    });

    it('reads the student roster and the staff list', async () => {
      const roster = await request(app)
        .get(`/api/courses/${course.id}/roster`)
        .set(auth(assistant.token));
      expect(roster.status).toBe(200);
      expect(roster.body.students.map((s) => s.id)).toContain(student.id);

      const staff = await request(app)
        .get(`/api/courses/${course.id}/staff`)
        .set(auth(assistant.token));
      expect(staff.status).toBe(200);
      expect(staff.body.owner.user_id).toBe(owner.id);
    });

    it('schedules an exam', async () => {
      const res = await request(app)
        .post('/api/exams')
        .set(auth(assistant.token))
        .send({
          course_id: course.id,
          title: 'Quiz',
          start_time: new Date(Date.now() + 3600e3).toISOString(),
          end_time: new Date(Date.now() + 7200e3).toISOString(),
          duration_minutes: 60,
          problem_ids: [problem.id],
        });
      expect(res.status).toBe(201);
    });
  });

  describe('what an assistant still cannot do', () => {
    it('cannot rename or archive the course', async () => {
      const res = await request(app)
        .put(`/api/courses/${course.id}`)
        .set(auth(assistant.token))
        .send({ title: 'Renamed by the assistant' });
      expect(res.status).toBe(404);
    });

    it('cannot appoint another assistant', async () => {
      // The line that matters most: an assistant who can appoint assistants can
      // appoint anyone, and a delegation becomes a takeover with no way back
      // for the owner short of the database.
      const res = await request(app)
        .post(`/api/courses/${course.id}/staff`)
        .set(auth(assistant.token))
        .send({ email: otherTeacher.email });
      expect(res.status).toBe(404);
    });

    it('cannot stand another assistant down, or themselves', async () => {
      const res = await request(app)
        .delete(`/api/courses/${course.id}/staff/${assistant.id}`)
        .set(auth(assistant.token));
      expect(res.status).toBe(404);
    });

    it('cannot delete the course', async () => {
      const res = await request(app)
        .delete(`/api/courses/${course.id}`)
        .set(auth(assistant.token));
      expect(res.status).toBe(404);
    });
  });

  describe('the widening did not reach other courses', () => {
    it('an assistant on one course sees nothing of another', async () => {
      // The regression this whole file exists to prevent: courseScope was
      // "created_by = me" and is now a union, so a mistake there hands every
      // teacher every course.
      const list = await request(app).get('/api/courses').set(auth(assistant.token));
      expect(list.body.courses.map((c) => c.id)).not.toContain(otherCourse.id);

      const detail = await request(app)
        .get(`/api/courses/${otherCourse.id}`)
        .set(auth(assistant.token));
      expect(detail.status).toBe(404);

      const roster = await request(app)
        .get(`/api/courses/${otherCourse.id}/roster`)
        .set(auth(assistant.token));
      expect(roster.status).toBe(404);
    });

    it('a teacher with no appointment anywhere still sees only their own', async () => {
      const res = await request(app).get('/api/courses').set(auth(otherTeacher.token));
      expect(res.body.courses.map((c) => c.id)).toEqual([otherCourse.id]);
    });
  });

  describe('who may be appointed', () => {
    it('refuses a student account', async () => {
      // A student assistant would read every paper in the course before
      // sitting it: the exam seal is keyed on the role, not on the roster.
      const res = await request(app)
        .post(`/api/courses/${course.id}/staff`)
        .set(auth(owner.token))
        .send({ email: student.email });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/teacher account/i);
    });

    it('refuses an address with no account rather than inventing one', async () => {
      const res = await request(app)
        .post(`/api/courses/${course.id}/staff`)
        .set(auth(owner.token))
        .send({ email: 'nobody@x.edu' });
      expect(res.status).toBe(404);
    });

    it('refuses the owner, who already teaches it', async () => {
      const res = await request(app)
        .post(`/api/courses/${course.id}/staff`)
        .set(auth(owner.token))
        .send({ email: owner.email });
      expect(res.status).toBe(400);
    });

    it('appointing twice is not an error and does not duplicate', async () => {
      const again = await request(app)
        .post(`/api/courses/${course.id}/staff`)
        .set(auth(owner.token))
        .send({ email: assistant.email });
      expect(again.status).toBe(201);

      const staff = await request(app)
        .get(`/api/courses/${course.id}/staff`)
        .set(auth(owner.token));
      expect(staff.body.assistants.filter((a) => a.user_id === assistant.id)).toHaveLength(1);
    });
  });

  describe('standing an assistant down', () => {
    it('takes the course away again', async () => {
      const temp = await registerUser('Temp', 'staff-t@x.edu', 'test-invite-code');
      await request(app)
        .post(`/api/courses/${course.id}/staff`)
        .set(auth(owner.token))
        .send({ email: temp.email });

      const before = await request(app).get('/api/courses').set(auth(temp.token));
      expect(before.body.courses.map((c) => c.id)).toContain(course.id);

      const removed = await request(app)
        .delete(`/api/courses/${course.id}/staff/${temp.id}`)
        .set(auth(owner.token));
      expect(removed.status).toBe(200);

      const after = await request(app).get('/api/courses').set(auth(temp.token));
      expect(after.body.courses.map((c) => c.id)).not.toContain(course.id);

      const problemAfter = await request(app)
        .get(`/api/problems/${problem.id}`)
        .set(auth(temp.token));
      expect(problemAfter.status).toBe(404);
    });
  });
});
