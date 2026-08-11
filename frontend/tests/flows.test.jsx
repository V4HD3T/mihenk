/**
 * The flows a user actually performs, and an accessibility check on each page
 * they perform them in.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderApp, stubRoutes, signIn, fails } from './helpers.jsx';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
}));
vi.mock('../src/api/axios', () => ({ default: api }));

// The solve page opens a WebSocket for live grading results; jsdom has none.
vi.mock('../src/hooks/useSubmissionSocket', () => ({ useSubmissionSocket: () => {} }));

const { default: Courses } = await import('../src/pages/Courses');
const { default: ProblemSolve } = await import('../src/pages/ProblemSolve');
const { default: Login } = await import('../src/pages/Login');
const { default: TeacherPanel } = await import('../src/pages/TeacherPanel');
const { default: CourseRoster } = await import('../src/pages/CourseRoster');

const stub = (routes) => stubRoutes(api, routes);

beforeEach(() => {
  for (const fn of [api.get, api.post, api.put, api.delete]) fn.mockReset();
});

const PROBLEM = {
  problem: {
    id: 1,
    title: 'Double it',
    description: 'Read an integer and print twice its value.',
    starter_code_python: '# your code here',
    starter_code_go: 'package main',
  },
  testCases: [{ id: 1, input: '21', expected_output: '42', is_sample: true }],
};

describe('courses', () => {
  it('shows a student the courses they are in, and no join code', async () => {
    signIn({ role: 'student' });
    stub({
      'GET /courses': {
        courses: [
          {
            id: 1,
            title: 'Algorithms',
            term: '2026 Spring',
            problem_count: 4,
            teacher_name: 'Ada',
            // Deliberately present: if a server ever over-shares this field,
            // the student's view still has to withhold it.
            join_code: 'K7QP2XRT',
          },
        ],
      },
    });
    renderApp(<Courses />);

    expect(await screen.findByText('Algorithms')).toBeInTheDocument();
    expect(screen.getByText(/2026 Spring/)).toBeInTheDocument();
    // The join code is the credential for entering a course; students never
    // see the value, nor the teacher's block for handing it out. The student's
    // own "join a course" field is labelled "join code" and is not a leak, so
    // this asserts the secret rather than the phrase.
    expect(screen.queryByText('K7QP2XRT')).not.toBeInTheDocument();
    expect(screen.queryByText(/share this with students/i)).not.toBeInTheDocument();
  });

  it('lets a student join with a code and reports the result', async () => {
    signIn({ role: 'student' });
    stub({
      'GET /courses': { courses: [] },
      'POST /courses/join': { course: { id: 2, title: 'Data Structures' } },
    });
    renderApp(<Courses />);

    await userEvent.type(await screen.findByPlaceholderText(/join code/i), 'k7qp2xrt');
    await userEvent.click(screen.getByRole('button', { name: /^join$/i }));

    await waitFor(() => {
      const call = api.post.mock.calls.find(([url]) => url.includes('/courses/join'));
      // Uppercased as the user types, because the codes are issued uppercase.
      expect(call[1].joinCode).toBe('K7QP2XRT');
    });
    expect(await screen.findByText(/you joined data structures/i)).toBeInTheDocument();
  });

  it('explains a bad code instead of failing silently', async () => {
    signIn({ role: 'student' });
    stub({
      'GET /courses': { courses: [] },
      'POST /courses/join': fails(404, { error: 'No course found with that code' }),
    });
    renderApp(<Courses />);

    await userEvent.type(await screen.findByPlaceholderText(/join code/i), 'NOPE');
    await userEvent.click(screen.getByRole('button', { name: /^join$/i }));
    expect(await screen.findByText(/no course found/i)).toBeInTheDocument();
  });

  it('shows a teacher the join code so they can hand it out', async () => {
    signIn({ role: 'teacher' });
    stub({
      'GET /courses': {
        courses: [
          { id: 1, title: 'Algorithms', join_code: 'K7QP2XRT', student_count: 30, problem_count: 4 },
        ],
      },
    });
    renderApp(<Courses />);
    expect(await screen.findByText('K7QP2XRT')).toBeInTheDocument();
  });
});

describe('solving a problem', () => {
  it('loads the starter code for the chosen language', async () => {
    signIn({ role: 'student' });
    stub({ 'GET /problems/1': PROBLEM, 'GET /drafts': { draft: null } });
    renderApp(<ProblemSolve />, { route: '/problem/1', path: '/problem/:id' });

    const editor = await screen.findByLabelText(/code editor/i);
    await waitFor(() => expect(editor).toHaveValue('# your code here'));

    // The language picker is a labelled group of toggle buttons, so the active
    // one is discoverable rather than only visually highlighted.
    const languages = screen.getByRole('group', { name: /language/i });
    expect(within(languages).getByRole('button', { name: 'Python' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await userEvent.click(within(languages).getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(editor).toHaveValue('package main'));
    expect(within(languages).getByRole('button', { name: 'Go' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
  });

  it('restores an autosaved draft instead of the starter code', async () => {
    signIn({ role: 'student' });
    stub({
      'GET /problems/1': PROBLEM,
      'GET /drafts': { draft: { code: 'unfinished work', language: 'python' } },
    });
    renderApp(<ProblemSolve />, { route: '/problem/1', path: '/problem/:id' });

    const editor = await screen.findByLabelText(/code editor/i);
    await waitFor(() => expect(editor).toHaveValue('unfinished work'));
    expect(await screen.findByText(/restored your unsubmitted work/i)).toBeInTheDocument();
  });

  it('surfaces the verdict, not just a failure count', async () => {
    signIn({ role: 'student' });
    stub({
      'GET /problems/1': PROBLEM,
      'GET /drafts': { draft: null },
      'POST /submissions': { submission: { id: 9 }, status: 'queued' },
      'DELETE /drafts': { success: true },
      'GET /submissions/9': {
        status: 'completed',
        passedCount: 0,
        totalCount: 1,
        results: [
          {
            test_case_id: 1,
            passed: false,
            verdict: 'time_limit_exceeded',
            verdictLabel: 'Time limit exceeded',
          },
        ],
      },
    });
    renderApp(<ProblemSolve />, { route: '/problem/1', path: '/problem/:id' });

    await screen.findByLabelText(/code editor/i);
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(await screen.findByText(/time limit exceeded/i, {}, { timeout: 5000 })).toBeInTheDocument();
  }, 10000);

  it('explains a partial score by rubric section', async () => {
    // The point of weighting test cases is that a partial mark can be read.
    // "7 / 10" is a mark; "edge cases 0 / 2" is the thing to go and fix.
    signIn({ role: 'student' });
    stub({
      'GET /problems/1': PROBLEM,
      'GET /drafts': { draft: null },
      'POST /submissions': { submission: { id: 9 }, status: 'queued' },
      'DELETE /drafts': { success: true },
      'GET /submissions/9': {
        status: 'completed',
        passedCount: 2,
        totalCount: 4,
        results: [
          { test_case_id: 1, passed: true, verdict: 'accepted' },
          { test_case_id: 2, passed: true, verdict: 'accepted' },
          { test_case_id: 3, passed: false, verdict: 'wrong_answer', verdictLabel: 'Wrong answer' },
          { test_case_id: 4, passed: false, verdict: 'wrong_answer', verdictLabel: 'Wrong answer' },
        ],
        groups: [
          { label: 'algorithm', earned: 8, total: 8, passed: 2, count: 2 },
          { label: 'edge cases', earned: 0, total: 2, passed: 0, count: 2 },
        ],
      },
    });
    renderApp(<ProblemSolve />, { route: '/problem/1', path: '/problem/:id' });

    await screen.findByLabelText(/code editor/i);
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));

    expect(await screen.findByText('edge cases', {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('0 / 2')).toBeInTheDocument();
    expect(screen.getByText('8 / 8')).toBeInTheDocument();
  }, 10000);

  it('does not invent sections when the teacher wrote none', async () => {
    // An unlabelled group is the same information as the count already shown,
    // and a section called "" would be worse than nothing.
    signIn({ role: 'student' });
    stub({
      'GET /problems/1': PROBLEM,
      'GET /drafts': { draft: null },
      'POST /submissions': { submission: { id: 9 }, status: 'queued' },
      'DELETE /drafts': { success: true },
      'GET /submissions/9': {
        status: 'completed',
        passedCount: 1,
        totalCount: 1,
        results: [{ test_case_id: 1, passed: true, verdict: 'accepted' }],
        groups: [{ label: '', earned: 1, total: 1, passed: 1, count: 1 }],
      },
    });
    renderApp(<ProblemSolve />, { route: '/problem/1', path: '/problem/:id' });

    await screen.findByLabelText(/code editor/i);
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));

    await screen.findByText(/1 \/ 1 tests passed/i, {}, { timeout: 5000 });
    expect(screen.queryByText('1 / 1', { selector: 'span.font-mono' })).not.toBeInTheDocument();
  }, 10000);

  it('does not report integrity events outside an exam', async () => {
    signIn({ role: 'student' });
    stub({ 'GET /problems/1': PROBLEM, 'GET /drafts': { draft: null } });
    renderApp(<ProblemSolve />, { route: '/problem/1', path: '/problem/:id' });
    await screen.findByLabelText(/code editor/i);

    document.dispatchEvent(new Event('visibilitychange'));
    // Practice is never monitored - only exams are.
    expect(api.post.mock.calls.filter(([url]) => url.includes('/integrity'))).toHaveLength(0);
  });
});

describe('accessibility', () => {
  it('the sign-in page has no detectable violations', async () => {
    stub({});
    const { container } = renderApp(<Login />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('the courses page has no detectable violations', async () => {
    signIn({ role: 'teacher' });
    stub({
      'GET /courses': {
        courses: [{ id: 1, title: 'Algorithms', join_code: 'ABC', student_count: 2, problem_count: 1 }],
      },
    });
    const { container } = renderApp(<Courses />);
    await screen.findByText('Algorithms');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('the solve page has no detectable violations', async () => {
    signIn({ role: 'student' });
    stub({ 'GET /problems/1': PROBLEM, 'GET /drafts': { draft: null } });
    const { container } = renderApp(<ProblemSolve />, { route: '/problem/1', path: '/problem/:id' });
    await screen.findByLabelText(/code editor/i);
    expect(await axe(container)).toHaveNoViolations();
  });

  // The teacher pages carry most of the app's form controls and were the last
  // ones with fields that had a placeholder and no label. eslint cannot see a
  // htmlFor/id pair across two elements, so axe is what actually holds this
  // line - which means these pages have to be rendered here.
  it('the teacher panel has no detectable violations, with both forms open', async () => {
    signIn({ role: 'teacher' });
    stub({
      'GET /problems': { problems: [{ id: 1, title: 'Double it', difficulty: 'easy', course_id: 1 }] },
      'GET /exams': { exams: [] },
      'GET /courses': { courses: [{ id: 1, title: 'Algorithms', term: '2026 Spring' }] },
    });
    const { container } = renderApp(<TeacherPanel />);

    // The forms are collapsed by default; an unopened form is an untested one.
    await userEvent.click(await screen.findByRole('button', { name: /new problem/i }));
    await screen.findByLabelText(/problem description/i);
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(screen.getByRole('button', { name: /^exams$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /new exam/i }));
    await screen.findByLabelText(/duration/i);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('the roster has no detectable violations', async () => {
    signIn({ role: 'teacher' });
    stub({
      'GET /courses/1/roster': {
        students: [{ id: 7, name: 'Ada Lovelace', email: 'ada@x.edu', submission_count: 3 }],
      },
      // Before 'GET /courses/1': stubRoutes matches on a substring and takes
      // the first key that fits, so the course would otherwise answer this.
      'GET /courses/1/staff': {
        owner: { user_id: 1, name: 'Teacher', email: 't@x.edu' },
        assistants: [{ user_id: 8, name: 'Grace Hopper', email: 'grace@x.edu' }],
      },
      'GET /courses/1': { course: { id: 1, title: 'Algorithms', join_code: 'K7QP2XRT', created_by: 1 } },
    });
    const { container } = renderApp(<CourseRoster />, { route: '/courses/1/roster', path: '/courses/:id/roster' });
    await screen.findByText('Ada Lovelace');
    expect(await axe(container)).toHaveNoViolations();
  });
});
