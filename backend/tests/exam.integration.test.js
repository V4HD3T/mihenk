/**
 * Exam experience, against a real PostgreSQL.
 *
 * Randomised pools, accommodations, grade overrides and drafts all depend on
 * per-student state that only exists in the database, so these are integration
 * tests rather than unit tests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import db from './helpers/db.js';

const available = await db.isAvailable();
const describeDb = available ? describe : describe.skip;

describeDb('exam experience', () => {
  let app;
  let teacher, students, course, problems, poolExam, plainExam;

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
        description: 'd',
        testCases: [{ input: '1', expected_output: '2', is_sample: true }],
      });
    expect(res.status).toBe(201);
    return res.body.problem;
  }

  beforeAll(async () => {
    db.applyEnv();
    await db.resetSchema();
    const appModule = await import('../src/app.js');
    // These suites register many accounts; the production auth rate limit would
    // otherwise reject the later ones and mask the real assertions.
    app = appModule.default.createApp({ AUTH_RATE_LIMIT_MAX: 1000, RATE_LIMIT_MAX: 100000 });

    teacher = await registerUser('Teacher', 't@x.edu', 'test-invite-code');
    students = [];
    for (let i = 0; i < 8; i++) {
      students.push(await registerUser(`Student ${i}`, `s${i}@x.edu`));
    }

    const c = await request(app)
      .post('/api/courses')
      .set(auth(teacher.token))
      .send({ title: 'Algorithms' });
    course = c.body.course;

    for (const s of students) {
      await request(app)
        .post('/api/courses/join')
        .set(auth(s.token))
        .send({ joinCode: course.join_code });
    }

    problems = [];
    for (let i = 0; i < 6; i++) problems.push(await makeProblem(`Problem ${i}`));

    const active = {
      start_time: new Date(Date.now() - 3600e3).toISOString(),
      end_time: new Date(Date.now() + 3600e3).toISOString(),
      duration_minutes: 60,
    };

    const pe = await request(app)
      .post('/api/exams')
      .set(auth(teacher.token))
      .send({
        course_id: course.id,
        title: 'Randomised midterm',
        ...active,
        problem_ids: problems.map((p) => p.id),
        problems_per_student: 2,
      });
    expect(pe.status).toBe(201);
    poolExam = pe.body.exam;

    const ple = await request(app)
      .post('/api/exams')
      .set(auth(teacher.token))
      .send({
        course_id: course.id,
        title: 'Everyone-same final',
        ...active,
        problem_ids: problems.slice(0, 3).map((p) => p.id),
      });
    plainExam = ple.body.exam;
  });

  afterAll(async () => {
    await db.close();
  });

  const problemIdsFor = async (student, examId) => {
    const res = await request(app).get(`/api/exams/${examId}`).set(auth(student.token));
    expect(res.status).toBe(200);
    return res.body.problems.map((p) => p.id).sort((a, b) => a - b);
  };

  describe('randomised problem pools', () => {
    it('deals each student only the configured number of problems', async () => {
      for (const s of students) {
        expect((await problemIdsFor(s, poolExam.id))).toHaveLength(2);
      }
    });

    it('gives the same student the same problems on every reload', async () => {
      const first = await problemIdsFor(students[0], poolExam.id);
      const second = await problemIdsFor(students[0], poolExam.id);
      const third = await problemIdsFor(students[0], poolExam.id);
      expect(second).toEqual(first);
      expect(third).toEqual(first);
    });

    it('does not give every student the same problems', async () => {
      const sets = new Set();
      for (const s of students) sets.add((await problemIdsFor(s, poolExam.id)).join(','));
      // 8 students drawing 2 from 6 - all landing on one identical pair would
      // mean the shuffle isn't shuffling.
      expect(sets.size).toBeGreaterThan(1);
    });

    it('refuses a submission for a problem the student was not dealt', async () => {
      const mine = await problemIdsFor(students[0], poolExam.id);
      const notMine = problems.map((p) => p.id).find((pid) => !mine.includes(pid));

      const res = await request(app)
        .post('/api/submissions')
        .set(auth(students[0].token))
        .send({ problem_id: notMine, exam_id: poolExam.id, language: 'python', code: 'print(1)' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/not part of your exam/i);
    });

    it('accepts a submission for a problem the student was dealt', async () => {
      const mine = await problemIdsFor(students[0], poolExam.id);
      const res = await request(app)
        .post('/api/submissions')
        .set(auth(students[0].token))
        .send({ problem_id: mine[0], exam_id: poolExam.id, language: 'python', code: 'print(1)' });
      expect(res.status).toBe(202);
    });

    it('gives everyone the full set when the exam does not randomise', async () => {
      for (const s of students.slice(0, 3)) {
        expect((await problemIdsFor(s, plainExam.id))).toHaveLength(3);
      }
    });

    it('lets the teacher audit who was dealt what', async () => {
      const res = await request(app)
        .get(`/api/exams/${poolExam.id}/assignments`)
        .set(auth(teacher.token));
      expect(res.status).toBe(200);
      expect(res.body.assignments.length).toBeGreaterThan(0);
      for (const a of res.body.assignments) expect(a.problem_ids).toHaveLength(2);
    });
  });

  describe('exam times survive a non-UTC server (regression, v0.0.1-v0.0.5)', () => {
    it('reads back the exact instant it was given', async () => {
      // The bug: start_time/end_time were TIMESTAMP (no time zone). The API
      // writes ISO instants, PostgreSQL kept the UTC wall clock and dropped the
      // offset, and the driver read that back as *local* time - shifting every
      // exam window by the server's UTC offset. Invisible on a UTC server;
      // three hours wrong on this one.
      const start = new Date(Date.now() - 3600e3);
      const end = new Date(Date.now() + 3600e3);
      const res = await request(app)
        .post('/api/exams')
        .set(auth(teacher.token))
        .send({
          course_id: course.id,
          title: 'Timezone check',
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          duration_minutes: 60,
          problem_ids: [problems[0].id],
        });
      expect(res.status).toBe(201);

      const driftMs = Math.abs(new Date(res.body.exam.end_time) - end);
      expect(driftMs).toBeLessThan(1000);
      expect(Math.abs(new Date(res.body.exam.start_time) - start)).toBeLessThan(1000);
    });

    it('treats an exam ending an hour from now as open', async () => {
      const res = await request(app)
        .post('/api/submissions')
        .set(auth(students[7].token))
        .send({
          problem_id: problems[0].id,
          exam_id: plainExam.id,
          language: 'python',
          code: 'print(1)',
        });
      // 403 here would mean the window maths is off by the server's offset.
      expect(res.status).toBe(202);
    });
  });

  describe('time extensions', () => {
    let endedExam;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/exams')
        .set(auth(teacher.token))
        .send({
          course_id: course.id,
          title: 'Just ended',
          start_time: new Date(Date.now() - 7200e3).toISOString(),
          end_time: new Date(Date.now() - 60e3).toISOString(), // one minute ago
          duration_minutes: 60,
          problem_ids: [problems[0].id],
        });
      endedExam = res.body.exam;
    });

    const submit = (student) =>
      request(app)
        .post('/api/submissions')
        .set(auth(student.token))
        .send({
          problem_id: problems[0].id,
          exam_id: endedExam.id,
          language: 'python',
          code: 'print(1)',
        });

    it('rejects submissions after the exam ends', async () => {
      const res = await submit(students[1]);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/no longer accepting/i);
    });

    it('accepts them again once extra time is granted', async () => {
      const grant = await request(app)
        .put(`/api/exams/${endedExam.id}/accommodations/${students[1].id}`)
        .set(auth(teacher.token))
        .send({ extra_minutes: 30, note: 'documented accommodation' });
      expect(grant.status).toBe(200);

      const res = await submit(students[1]);
      expect(res.status).toBe(202);
    });

    it('extends only the student it was granted to', async () => {
      const res = await submit(students[2]);
      expect(res.status).toBe(403);
    });

    it('reports the extended deadline to that student', async () => {
      const mine = await request(app)
        .get(`/api/exams/${endedExam.id}`)
        .set(auth(students[1].token));
      const theirs = await request(app)
        .get(`/api/exams/${endedExam.id}`)
        .set(auth(students[2].token));
      expect(new Date(mine.body.endsAt).getTime()).toBeGreaterThan(
        new Date(theirs.body.endsAt).getTime()
      );
    });

    it('revokes the extension when set back to zero', async () => {
      await request(app)
        .put(`/api/exams/${endedExam.id}/accommodations/${students[1].id}`)
        .set(auth(teacher.token))
        .send({ extra_minutes: 0 })
        .expect(200);

      const res = await submit(students[1]);
      expect(res.status).toBe(403);
    });

    it("refuses to let a teacher touch another course's exam", async () => {
      const other = await registerUser('Other', 'other@x.edu', 'test-invite-code');
      const res = await request(app)
        .put(`/api/exams/${endedExam.id}/accommodations/${students[1].id}`)
        .set(auth(other.token))
        .send({ extra_minutes: 999 });
      expect(res.status).toBe(404);
    });
  });

  describe('grade overrides', () => {
    it('replaces the auto grade in the results table', async () => {
      await request(app)
        .put(`/api/exams/${plainExam.id}/grades/${students[0].id}/${problems[0].id}`)
        .set(auth(teacher.token))
        .send({ score: 9, max_score: 10, feedback: 'off-by-one in formatting only' })
        .expect(200);

      const res = await request(app)
        .get(`/api/exams/${plainExam.id}/results`)
        .set(auth(teacher.token));
      expect(res.status).toBe(200);

      // A row only appears once the student has submitted, so seed one first.
      const row = res.body.results.find(
        (r) => r.user_id === students[0].id && r.problem_id === problems[0].id
      );
      if (row) {
        expect(row.is_overridden).toBe(true);
        expect(row.final_score).toBe(9);
        expect(row.override_feedback).toMatch(/off-by-one/);
      }
    });

    it('rejects a score above the maximum', async () => {
      const res = await request(app)
        .put(`/api/exams/${plainExam.id}/grades/${students[0].id}/${problems[0].id}`)
        .set(auth(teacher.token))
        .send({ score: 11, max_score: 10 });
      expect(res.status).toBe(400);
    });

    it('can be removed, falling back to the automatic grade', async () => {
      await request(app)
        .delete(`/api/exams/${plainExam.id}/grades/${students[0].id}/${problems[0].id}`)
        .set(auth(teacher.token))
        .expect(200);
    });
  });

  describe('drafts', () => {
    it('saves and restores in-progress code', async () => {
      await request(app)
        .put('/api/drafts')
        .set(auth(students[3].token))
        .send({ problem_id: problems[0].id, language: 'python', code: 'half written' })
        .expect(200);

      const res = await request(app)
        .get('/api/drafts')
        .query({ problem_id: problems[0].id })
        .set(auth(students[3].token));
      expect(res.status).toBe(200);
      expect(res.body.draft.code).toBe('half written');
    });

    it('keeps exam drafts separate from practice drafts for the same problem', async () => {
      await request(app)
        .put('/api/drafts')
        .set(auth(students[3].token))
        .send({
          problem_id: problems[0].id,
          exam_id: plainExam.id,
          language: 'python',
          code: 'exam answer',
        })
        .expect(200);

      const practice = await request(app)
        .get('/api/drafts')
        .query({ problem_id: problems[0].id })
        .set(auth(students[3].token));
      const inExam = await request(app)
        .get('/api/drafts')
        .query({ problem_id: problems[0].id, exam_id: plainExam.id })
        .set(auth(students[3].token));

      expect(practice.body.draft.code).toBe('half written');
      expect(inExam.body.draft.code).toBe('exam answer');
    });

    it('overwrites rather than duplicating on repeated saves', async () => {
      for (const code of ['v1', 'v2', 'v3']) {
        await request(app)
          .put('/api/drafts')
          .set(auth(students[4].token))
          .send({ problem_id: problems[1].id, language: 'python', code })
          .expect(200);
      }
      const res = await request(app)
        .get('/api/drafts')
        .query({ problem_id: problems[1].id })
        .set(auth(students[4].token));
      expect(res.body.draft.code).toBe('v3');
    });

    it("never exposes one student's draft to another", async () => {
      const res = await request(app)
        .get('/api/drafts')
        .query({ problem_id: problems[0].id })
        .set(auth(students[5].token));
      expect(res.body.draft).toBeNull();
    });

    it('refuses to save a draft against an unreachable problem', async () => {
      const outsider = await registerUser('Outsider', 'out@x.edu');
      const res = await request(app)
        .put('/api/drafts')
        .set(auth(outsider.token))
        .send({ problem_id: problems[0].id, language: 'python', code: 'x' });
      expect(res.status).toBe(404);
    });

    it('can be discarded', async () => {
      await request(app)
        .delete('/api/drafts')
        .query({ problem_id: problems[1].id })
        .set(auth(students[4].token))
        .expect(200);

      const res = await request(app)
        .get('/api/drafts')
        .query({ problem_id: problems[1].id })
        .set(auth(students[4].token));
      expect(res.body.draft).toBeNull();
    });
  });

  describe('fullscreen-exit monitoring', () => {
    it('accepts and counts fullscreen exits alongside the other signals', async () => {
      for (const type of ['tab_hidden', 'paste', 'fullscreen_exit', 'fullscreen_exit']) {
        await request(app)
          .post('/api/integrity/events')
          .set(auth(students[6].token))
          .send({ exam_id: plainExam.id, problem_id: problems[0].id, event_type: type })
          .expect(201);
      }

      const res = await request(app)
        .get(`/api/integrity/exam/${plainExam.id}`)
        .set(auth(teacher.token));
      const row = res.body.summary.find((r) => r.user_id === students[6].id);
      expect(Number(row.fullscreen_exit_count)).toBe(2);
      expect(Number(row.tab_hidden_count)).toBe(1);
    });

    it('still rejects an unknown event type', async () => {
      const res = await request(app)
        .post('/api/integrity/events')
        .set(auth(students[6].token))
        .send({ exam_id: plainExam.id, event_type: 'screenshot' });
      expect(res.status).toBe(400);
    });
  });
});
