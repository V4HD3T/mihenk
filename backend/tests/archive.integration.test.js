/**
 * Cross-semester similarity archive, against a real PostgreSQL.
 *
 * The scenario: a solution is handed down from last year's cohort. Screening
 * only against classmates never sees it, which is the gap this closes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import db from './helpers/db.js';

const available = await db.isAvailable();
const describeDb = available ? describe : describe.skip;

const SOLUTION = [
  'def binary_search(arr, target):',
  '    lo, hi = 0, len(arr) - 1',
  '    while lo <= hi:',
  '        mid = (lo + hi) // 2',
  '        if arr[mid] == target:',
  '            return mid',
  '        elif arr[mid] < target:',
  '            lo = mid + 1',
  '        else:',
  '            hi = mid - 1',
  '    return -1',
  'print(binary_search(sorted(map(int, input().split())), int(input())))',
].join('\n');

const UNRELATED = [
  'total = 0',
  'for line in range(int(input())):',
  '    total += sum(int(x) for x in input().split())',
  'print(total)',
].join('\n');

describeDb('cross-semester similarity archive', () => {
  let app;
  let alice, bob; // two teachers
  let lastYear, thisYear; // alice's courses
  let oldProblem, newProblem;
  const students = [];

  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  async function registerUser(name, email, inviteCode) {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name, email, password: 'password123', ...(inviteCode ? { inviteCode } : {}) });
    expect(res.status).toBe(201);
    return { token: res.body.token, id: res.body.user.id };
  }

  async function makeCourse(teacher, title, term) {
    const res = await request(app).post('/api/courses').set(auth(teacher.token)).send({ title, term });
    expect(res.status).toBe(201);
    return res.body.course;
  }

  async function makeProblem(teacher, course, title) {
    const res = await request(app)
      .post('/api/problems')
      .set(auth(teacher.token))
      .send({
        course_id: course.id,
        title,
        description: 'd',
        testCases: [{ input: '1', expected_output: '1', is_sample: true }],
      });
    expect(res.status).toBe(201);
    return res.body.problem;
  }

  /** Writes a submission straight to the database - grading is irrelevant here. */
  async function seedSubmission(userId, problemId, code) {
    await db
      .getPool()
      .query(
        `INSERT INTO submissions (user_id, problem_id, language, code, status, passed_count, total_count)
         VALUES ($1, $2, 'python', $3, 'completed', 1, 1)`,
        [userId, problemId, code]
      );
  }

  beforeAll(async () => {
    db.applyEnv();
    await db.resetSchema();
    const appModule = await import('../src/app.js');
    app = appModule.default.createApp({ AUTH_RATE_LIMIT_MAX: 1000, RATE_LIMIT_MAX: 100000 });

    alice = await registerUser('Alice', 'alice@x.edu', 'test-invite-code');
    bob = await registerUser('Bob', 'bob@x.edu', 'test-invite-code');
    for (let i = 0; i < 4; i++) {
      students.push(await registerUser(`Student ${i}`, `s${i}@x.edu`));
    }

    lastYear = await makeCourse(alice, 'Algorithms', '2025 Spring');
    thisYear = await makeCourse(alice, 'Algorithms', '2026 Spring');

    for (const s of students) {
      await request(app).post('/api/courses/join').set(auth(s.token)).send({ joinCode: lastYear.join_code });
      await request(app).post('/api/courses/join').set(auth(s.token)).send({ joinCode: thisYear.join_code });
    }

    oldProblem = await makeProblem(alice, lastYear, 'Binary search');
    newProblem = await makeProblem(alice, thisYear, 'Binary search');

    // Last year: students 0 and 1 submitted.
    await seedSubmission(students[0].id, oldProblem.id, SOLUTION);
    await seedSubmission(students[1].id, oldProblem.id, UNRELATED);
  });

  afterAll(async () => {
    await db.close();
  });

  it('archives a finished course', async () => {
    const res = await request(app)
      .post(`/api/integrity/archive/course/${lastYear.id}`)
      .set(auth(alice.token))
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.archived).toBe(2);
    expect(res.body.sourceLabel).toBe('Algorithms - 2025 Spring');
  });

  it('lists what has been archived', async () => {
    const res = await request(app).get('/api/integrity/archive').set(auth(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.archives[0].source_label).toBe('Algorithms - 2025 Spring');
    expect(res.body.archives[0].submissions).toBe(2);
  });

  it('finds this year’s reuse of last year’s solution', async () => {
    // Student 2 hands in last year's code with the variables renamed.
    const handedDown = SOLUTION.replace(/lo/g, 'left').replace(/hi/g, 'right').replace(/mid/g, 'middle');
    await seedSubmission(students[2].id, newProblem.id, handedDown);

    const res = await request(app)
      .get(`/api/integrity/problem/${newProblem.id}/archive-matches`)
      .set(auth(alice.token));
    expect(res.status).toBe(200);

    const hit = res.body.matches.find((m) => m.userId === students[2].id);
    expect(hit).toBeTruthy();
    expect(hit.similarity).toBeGreaterThan(70);
    expect(hit.archivedFrom).toBe('Algorithms - 2025 Spring');
  });

  it('does not flag a student who wrote something else', async () => {
    await seedSubmission(students[3].id, newProblem.id, 'print(sum(map(int, input().split())))');
    const res = await request(app)
      .get(`/api/integrity/problem/${newProblem.id}/archive-matches`)
      .set(auth(alice.token));
    expect(res.body.matches.find((m) => m.userId === students[3].id)).toBeUndefined();
  });

  it("never screens against another teacher's archive", async () => {
    const bobCourse = await makeCourse(bob, 'Bob course', '2026');
    const bobProblem = await makeProblem(bob, bobCourse, 'Binary search');
    await request(app).post('/api/courses/join').set(auth(students[0].token)).send({ joinCode: bobCourse.join_code });
    await seedSubmission(students[0].id, bobProblem.id, SOLUTION);

    // Identical code to Alice's archived solution, but Bob has archived nothing.
    const res = await request(app)
      .get(`/api/integrity/problem/${bobProblem.id}/archive-matches`)
      .set(auth(bob.token));
    expect(res.status).toBe(200);
    expect(res.body.archiveSize).toBe(0);
    expect(res.body.matches).toEqual([]);
  });

  it("refuses to archive another teacher's course", async () => {
    const res = await request(app)
      .post(`/api/integrity/archive/course/${lastYear.id}`)
      .set(auth(bob.token))
      .send({});
    expect(res.status).toBe(404);
  });

  it("refuses to screen another teacher's problem", async () => {
    const res = await request(app)
      .get(`/api/integrity/problem/${newProblem.id}/archive-matches`)
      .set(auth(bob.token));
    expect(res.status).toBe(404);
  });

  it('can drop an archived cohort again', async () => {
    const res = await request(app)
      .delete(`/api/integrity/archive/${encodeURIComponent('Algorithms - 2025 Spring')}`)
      .set(auth(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);

    const after = await request(app)
      .get(`/api/integrity/problem/${newProblem.id}/archive-matches`)
      .set(auth(alice.token));
    expect(after.body.archiveSize).toBe(0);
  });

  it('survives the original course being deleted', async () => {
    await request(app)
      .post(`/api/integrity/archive/course/${lastYear.id}`)
      .set(auth(alice.token))
      .send({ source_label: 'Kept forever' })
      .expect(201);

    // The archive copies the code rather than referencing it, precisely so it
    // outlives the course.
    await db.getPool().query('DELETE FROM courses WHERE id = $1', [lastYear.id]);

    const res = await request(app).get('/api/integrity/archive').set(auth(alice.token));
    expect(res.body.archives.find((a) => a.source_label === 'Kept forever').submissions).toBe(2);
  });
});
