/**
 * A test case can carry its own checker, its own weight and a section name.
 *
 * v0.0.7 made the checker a property of the problem, which is right for most
 * problems and wrong for any that asks for more than one kind of answer: "print
 * the mean, then the sorted values" wants a float tolerance on the first line
 * and an exact comparison on the rest, and could have neither.
 *
 * Weights are the other half. Grading counted test cases, so a one-line edge
 * case counted as much as the case that checks the algorithm - a student who
 * solved the problem and missed an empty-input check scored below one who got
 * the algorithm wrong and happened to handle empty input.
 *
 * These go through the API rather than the grading engine, because what the
 * engine does with a weight is unit-tested in grading.test.js and what is worth
 * checking here is that the values survive the round trip into the database and
 * out again, on the routes a teacher actually uses.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import db from './helpers/db.js';

const available = await db.isAvailable();
const describeDb = available ? describe : describe.skip;

describeDb('per-test-case checkers and weights', () => {
  let app;
  let teacher, student, course;

  const auth = (t) => ({ Authorization: `Bearer ${t}` });

  async function registerUser(name, email, inviteCode) {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name, email, password: 'password123', ...(inviteCode ? { inviteCode } : {}) });
    expect(res.status).toBe(201);
    return { token: res.body.token, id: res.body.user.id };
  }

  /** Creates a problem and returns the POST response, so a test can assert on failures too. */
  function createProblem(testCases, extra = {}) {
    return request(app)
      .post('/api/problems')
      .set(auth(teacher.token))
      .send({
        course_id: course.id,
        title: `Problem ${Math.random()}`,
        description: 'd',
        testCases,
        ...extra,
      });
  }

  beforeAll(async () => {
    db.applyEnv();
    await db.resetSchema();
    const appModule = await import('../src/app.js');
    app = appModule.default.createApp({ AUTH_RATE_LIMIT_MAX: 1000, RATE_LIMIT_MAX: 100000 });

    teacher = await registerUser('Teacher', 'w-t@x.edu', 'test-invite-code');
    student = await registerUser('Student', 'w-s@x.edu');
    const c = await request(app)
      .post('/api/courses')
      .set(auth(teacher.token))
      .send({ title: 'Weighted' });
    course = c.body.course;
    await request(app)
      .post('/api/courses/join')
      .set(auth(student.token))
      .send({ joinCode: course.join_code });
  });

  afterAll(async () => {
    await db.close();
  });

  describe('defaults reproduce the old behaviour exactly', () => {
    it('a problem written the old way gets weight 1 and no per-case checker', async () => {
      const res = await createProblem([
        { input: '1', expected_output: '1', is_sample: true },
        { input: '2', expected_output: '2' },
      ]);
      expect(res.status).toBe(201);

      const detail = await request(app)
        .get(`/api/problems/${res.body.problem.id}`)
        .set(auth(teacher.token));
      for (const tc of detail.body.testCases) {
        expect(tc.weight).toBe(1);
        // Null, not the problem's value: the case defers, so changing the
        // problem's checker later still moves it.
        expect(tc.checker).toBeNull();
        expect(tc.group_label).toBe('');
      }
    });
  });

  describe('a checker per case', () => {
    it('is stored and returned for the cases that set one', async () => {
      const res = await createProblem(
        [
          { input: '1', expected_output: '3.14', checker: 'float', checker_config: { tolerance: 0.01 } },
          { input: '2', expected_output: 'DONE' },
        ],
        { checker: 'exact' }
      );
      expect(res.status).toBe(201);

      const detail = await request(app)
        .get(`/api/problems/${res.body.problem.id}`)
        .set(auth(teacher.token));
      const [first, second] = detail.body.testCases;
      expect(first.checker).toBe('float');
      expect(first.checker_config).toEqual({ tolerance: 0.01 });
      expect(second.checker).toBeNull();
      // The problem's own checker is untouched by any of this.
      expect(detail.body.problem.checker).toBe('exact');
    });

    it('refuses a checker name that does not exist', async () => {
      const res = await createProblem([
        { input: '1', expected_output: '1', checker: 'vibes' },
      ]);
      expect(res.status).toBe(400);
    });

    it('can be set on a case added to an existing problem', async () => {
      const created = await createProblem([{ input: '1', expected_output: '1' }]);
      const added = await request(app)
        .post(`/api/problems/${created.body.problem.id}/testcases`)
        .set(auth(teacher.token))
        .send({ input: '9', expected_output: '2.0', checker: 'float', weight: 3 });
      expect(added.status).toBe(201);
      expect(added.body.testCase.checker).toBe('float');
      expect(added.body.testCase.weight).toBe(3);
    });
  });

  describe('weights and sections', () => {
    it('are stored as sent', async () => {
      const res = await createProblem([
        { input: '1', expected_output: '1', weight: 8, group_label: 'algorithm' },
        { input: '', expected_output: '0', weight: 1, group_label: 'edge cases' },
      ]);
      expect(res.status).toBe(201);

      const detail = await request(app)
        .get(`/api/problems/${res.body.problem.id}`)
        .set(auth(teacher.token));
      expect(detail.body.testCases.map((tc) => [tc.weight, tc.group_label])).toEqual([
        [8, 'algorithm'],
        [1, 'edge cases'],
      ]);
    });

    it('reach the student for hidden cases too, because they are the marking scheme', async () => {
      // What a question is worth is not the answer to it. A student who cannot
      // see that the edge cases carry a tenth of the marks cannot tell a near
      // miss from a wrong approach.
      const res = await createProblem([
        { input: '1', expected_output: '1', is_sample: true, weight: 8, group_label: 'algorithm' },
        { input: '', expected_output: '0', weight: 1, group_label: 'edge cases' },
      ]);
      const detail = await request(app)
        .get(`/api/problems/${res.body.problem.id}`)
        .set(auth(student.token));
      expect(detail.status).toBe(200);
      // Only the sample is listed - the hidden one stays hidden, as before.
      expect(detail.body.testCases).toHaveLength(1);
      expect(detail.body.testCases[0].weight).toBe(8);
      expect(detail.body.testCases[0].group_label).toBe('algorithm');
      // And the hidden case's expected output is still not there.
      expect(JSON.stringify(detail.body)).not.toContain('"expected_output":"0"');
    });

    it('rejects a weight outside the range the column allows', async () => {
      // A 400 from the schema rather than a constraint violation surfacing as a
      // 500 halfway through inserting the other cases.
      for (const weight of [-1, 1001]) {
        const res = await createProblem([{ input: '1', expected_output: '1', weight }]);
        expect(res.status).toBe(400);
      }
    });

    it('accepts a weight of 0 - a case that must pass but carries no marks', async () => {
      const res = await createProblem([
        { input: '1', expected_output: '1', weight: 0 },
        { input: '2', expected_output: '2', weight: 5 },
      ]);
      expect(res.status).toBe(201);
    });
  });
});
