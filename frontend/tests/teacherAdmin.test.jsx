/**
 * The administration surfaces added in v0.2.0.
 *
 * Each of these endpoints worked before this release and no interface reached
 * them, so the tests are written the way the gap was found: assert on the
 * request the page actually sends. A page that renders a form but posts nothing
 * would have looked finished from a screenshot.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderApp, stubRoutes, signIn } from './helpers.jsx';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
}));
vi.mock('../src/api/axios', () => ({ default: api }));

const { default: TeacherPanel } = await import('../src/pages/TeacherPanel');
const { default: ExamAdmin } = await import('../src/pages/ExamAdmin');
const { default: ArchivePage } = await import('../src/pages/ArchivePage');
const { default: MySubmissions } = await import('../src/pages/MySubmissions');
const { default: Courses } = await import('../src/pages/Courses');
const { default: CourseRoster, parseEmails } = await import('../src/pages/CourseRoster');

const stub = (routes) => stubRoutes(api, routes);

beforeEach(() => {
  for (const fn of [api.get, api.post, api.put, api.delete]) fn.mockReset();
});

const COURSE = { id: 1, title: 'Algorithms', term: '2026 Spring', problem_count: 2, student_count: 3 };

const EXISTING_PROBLEM = {
  problem: {
    id: 7,
    course_id: 1,
    title: 'Double it',
    description: 'Read an integer and print twice its value.',
    difficulty: 'easy',
    starter_code_python: '# here',
    starter_code_cpp: '',
    starter_code_java: '',
    starter_code_javascript: '',
    starter_code_c: '',
    starter_code_go: '',
    checker: 'exact',
    checker_config: {},
    time_limit_sec: null,
    memory_limit_mb: null,
  },
  testCases: [
    { id: 11, input: '21', expected_output: '42', is_sample: true },
    { id: 12, input: '1', expected_output: '2', is_sample: false },
  ],
};

describe('editing a problem', () => {
  const panelRoutes = {
    'GET /problems/7': EXISTING_PROBLEM,
    'GET /problems': { problems: [{ id: 7, title: 'Double it', difficulty: 'easy', course_id: 1 }] },
    'GET /exams': { exams: [] },
    'GET /courses': { courses: [COURSE] },
    'PUT /problems/7': { problem: { id: 7 } },
  };

  it('loads the problem into the form and saves the whole object back', async () => {
    signIn({ role: 'teacher' });
    stub(panelRoutes);
    renderApp(<TeacherPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /edit problem double it/i }));

    const title = await screen.findByLabelText(/^title$/i);
    expect(title).toHaveValue('Double it');
    expect(screen.getByLabelText(/problem description/i)).toHaveValue(
      'Read an integer and print twice its value.'
    );

    await userEvent.clear(title);
    await userEvent.type(title, 'Triple it');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const call = api.put.mock.calls.find(([url]) => url === '/problems/7');
      expect(call).toBeTruthy();
      // A partial body would blank every column the PUT names but omits.
      expect(call[1]).toMatchObject({
        title: 'Triple it',
        description: 'Read an integer and print twice its value.',
        difficulty: 'easy',
        starter_code_python: '# here',
        checker: 'exact',
      });
    });
  });

  it('sends null, not an empty string, for an unset limit', async () => {
    signIn({ role: 'teacher' });
    stub(panelRoutes);
    renderApp(<TeacherPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /edit problem double it/i }));
    await screen.findByLabelText(/^title$/i);
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      const call = api.put.mock.calls.find(([url]) => url === '/problems/7');
      expect(call[1].time_limit_sec).toBeNull();
      expect(call[1].memory_limit_mb).toBeNull();
    });
  });

  it('cannot move a problem to another course', async () => {
    signIn({ role: 'teacher' });
    stub(panelRoutes);
    renderApp(<TeacherPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /edit problem double it/i }));
    await screen.findByLabelText(/^title$/i);
    expect(screen.getByLabelText(/^course$/i)).toBeDisabled();
  });

  it('adds a test case through its own endpoint, not the problem save', async () => {
    signIn({ role: 'teacher' });
    stub(panelRoutes);
    renderApp(<TeacherPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /edit problem double it/i }));
    await screen.findByLabelText(/^title$/i);

    await userEvent.type(screen.getByLabelText(/^expected output$/i), '84');
    await userEvent.click(screen.getByRole('button', { name: /add test/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/problems/7/testcases',
        expect.objectContaining({ expected_output: '84' })
      );
    });
    // Adding a test must not submit the problem form around it.
    expect(api.put).not.toHaveBeenCalled();
  });

  it('refuses to remove the only test case', async () => {
    signIn({ role: 'teacher' });
    stub({
      ...panelRoutes,
      'GET /problems/7': { ...EXISTING_PROBLEM, testCases: [EXISTING_PROBLEM.testCases[0]] },
    });
    renderApp(<TeacherPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /edit problem double it/i }));
    await screen.findByLabelText(/^title$/i);
    await userEvent.click(screen.getByRole('button', { name: /delete test 1/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one test case/i);
    expect(api.delete).not.toHaveBeenCalled();
  });
});

describe('creating a randomised exam', () => {
  it('asks for a pool only once more than one problem is chosen', async () => {
    signIn({ role: 'teacher' });
    stub({
      'GET /problems': {
        problems: [
          { id: 1, title: 'A', difficulty: 'easy', course_id: 1 },
          { id: 2, title: 'B', difficulty: 'easy', course_id: 1 },
        ],
      },
      'GET /exams': { exams: [] },
      'GET /courses': { courses: [COURSE] },
      'POST /exams': { exam: { id: 3 } },
    });
    renderApp(<TeacherPanel />);

    await userEvent.click(await screen.findByRole('button', { name: /^exams$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /new exam/i }));

    await userEvent.selectOptions(await screen.findByLabelText(/^course$/i), '1');
    await userEvent.click(await screen.findByRole('button', { name: 'A' }));
    expect(screen.queryByLabelText(/random subset/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'B' }));
    await userEvent.click(await screen.findByLabelText(/random subset/i));

    await userEvent.type(screen.getByLabelText(/exam title/i), 'Midterm');
    await userEvent.type(screen.getByLabelText(/^start$/i), '2026-09-01T09:00');
    await userEvent.type(screen.getByLabelText(/^end$/i), '2026-09-01T11:00');
    await userEvent.click(screen.getByRole('button', { name: /create exam/i }));

    await waitFor(() => {
      const call = api.post.mock.calls.find(([url]) => url === '/exams');
      expect(call[1].problems_per_student).toBe(1);
      expect(call[1].problem_ids).toEqual([1, 2]);
    });
  });
});

describe('setting the paper (v2.1.0)', () => {
  const TWO_PROBLEMS = {
    'GET /problems': {
      problems: [
        { id: 1, title: 'A', difficulty: 'easy', course_id: 1 },
        { id: 2, title: 'B', difficulty: 'easy', course_id: 1 },
      ],
    },
    'GET /exams': { exams: [] },
    // Before 'GET /courses': stubRoutes matches on a substring and takes the
    // first key that fits, so the more specific path has to come first or the
    // course list answers the roster call.
    'GET /courses/1/roster': {
      students: [
        { id: 9, name: 'Ada', email: 'ada@x.edu' },
        { id: 10, name: 'Grace', email: 'grace@x.edu' },
      ],
    },
    'GET /courses': { courses: [COURSE] },
    'POST /exams': { exam: { id: 3 } },
  };

  /** Opens the new-exam form with both problems chosen, in the order A then B. */
  async function openFormWithBothProblems() {
    signIn({ role: 'teacher' });
    stub(TWO_PROBLEMS);
    renderApp(<TeacherPanel />);
    await userEvent.click(await screen.findByRole('button', { name: /^exams$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /new exam/i }));
    await userEvent.selectOptions(await screen.findByLabelText(/^course$/i), '1');
    await userEvent.click(await screen.findByRole('button', { name: 'A' }));
    await userEvent.click(screen.getByRole('button', { name: 'B' }));
    await userEvent.type(screen.getByLabelText(/exam title/i), 'Midterm');
    await userEvent.type(screen.getByLabelText(/^start$/i), '2026-09-01T09:00');
    await userEvent.type(screen.getByLabelText(/^end$/i), '2026-09-01T11:00');
  }

  const sentExam = () => api.post.mock.calls.find(([url]) => url === '/exams')[1];

  it('sends the questions in the order the teacher arranged them', async () => {
    await openFormWithBothProblems();
    // A was chosen first, so moving B up must reverse the paper - the whole
    // point being that this is no longer the ids' order.
    await userEvent.click(screen.getByRole('button', { name: /move b earlier/i }));
    await userEvent.click(screen.getByRole('button', { name: /create exam/i }));

    await waitFor(() => expect(sentExam().problem_ids).toEqual([2, 1]));
  });

  it('omits points entirely when the marks are left even', async () => {
    // Not "sends the even split it computed": the server owns that arithmetic,
    // and two implementations of the remainder rule is one too many.
    await openFormWithBothProblems();
    await userEvent.click(screen.getByRole('button', { name: /create exam/i }));

    await waitFor(() => expect(sentExam()).not.toHaveProperty('points'));
  });

  it('sends hand-set marks parallel to the questions', async () => {
    await openFormWithBothProblems();
    await userEvent.click(screen.getByLabelText(/set marks by hand/i));

    const markA = screen.getByLabelText(/marks for a/i);
    await userEvent.clear(markA);
    await userEvent.type(markA, '70');
    const markB = screen.getByLabelText(/marks for b/i);
    await userEvent.clear(markB);
    await userEvent.type(markB, '30');
    await userEvent.click(screen.getByRole('button', { name: /create exam/i }));

    await waitFor(() => {
      const body = sentExam();
      expect(body.problem_ids).toEqual([1, 2]);
      expect(body.points).toEqual([70, 30]);
    });
  });

  it('sends no roster when the whole course sits it', async () => {
    // Absent, not an empty array: the server reads an empty roster as "the
    // whole course", and sending [] on every create would be the same thing
    // said in a way that is easy to get wrong later.
    await openFormWithBothProblems();
    await userEvent.click(screen.getByRole('button', { name: /create exam/i }));

    await waitFor(() => expect(sentExam()).not.toHaveProperty('user_ids'));
  });

  it('sends only the chosen students for a second sitting', async () => {
    await openFormWithBothProblems();
    await userEvent.click(screen.getByLabelText(/only the students i choose/i));
    await userEvent.click(await screen.findByRole('button', { name: 'Grace' }));
    await userEvent.click(screen.getByRole('button', { name: /create exam/i }));

    await waitFor(() => expect(sentExam().user_ids).toEqual([10]));
  });

  it('sends the late window and its penalty', async () => {
    await openFormWithBothProblems();
    const window = screen.getByLabelText(/grace period/i);
    await userEvent.clear(window);
    await userEvent.type(window, '15');
    const penalty = screen.getByLabelText(/penalty/i);
    await userEvent.clear(penalty);
    await userEvent.type(penalty, '20');
    await userEvent.click(screen.getByRole('button', { name: /create exam/i }));

    await waitFor(() => {
      const body = sentExam();
      expect(body.late_window_minutes).toBe(15);
      expect(body.late_penalty_percent).toBe(20);
    });
  });

  it('defaults to accepting nothing late', async () => {
    await openFormWithBothProblems();
    await userEvent.click(screen.getByRole('button', { name: /create exam/i }));

    await waitFor(() => expect(sentExam().late_window_minutes).toBe(0));
  });
});

describe('teaching staff and roster import (v2.3.0)', () => {
  const OWNER_VIEW = {
    'GET /courses/1/roster': {
      students: [{ id: 7, name: 'Ada Lovelace', email: 'ada@x.edu', submission_count: 3 }],
    },
    'GET /courses/1/staff': {
      owner: { user_id: 1, name: 'Teacher', email: 't@x.edu' },
      assistants: [{ user_id: 8, name: 'Grace Hopper', email: 'grace@x.edu' }],
    },
    'GET /courses/1': { course: { id: 1, title: 'Algorithms', created_by: 1 } },
  };

  const renderRoster = () =>
    renderApp(<CourseRoster />, { route: '/courses/1/roster', path: '/courses/:id/roster' });

  describe('reading a pasted class list', () => {
    // A teacher pastes what they have: a spreadsheet column, a comma-separated
    // line, or CSV rows with names in them. Making them clean the file first is
    // how a feature goes unused.
    it('takes addresses out of CSV rows and ignores the rest', () => {
      expect(parseEmails('Name,Email\nAda Lovelace,ada@x.edu\nBob Smith,bob@x.edu')).toEqual([
        'ada@x.edu',
        'bob@x.edu',
      ]);
    });

    it('handles a column, a comma-separated line and stray punctuation alike', () => {
      expect(parseEmails('ada@x.edu\nbob@x.edu')).toEqual(['ada@x.edu', 'bob@x.edu']);
      expect(parseEmails('ada@x.edu, bob@x.edu;')).toEqual(['ada@x.edu', 'bob@x.edu']);
      expect(parseEmails('<ada@x.edu>')).toEqual(['ada@x.edu']);
    });

    it('lowercases and de-duplicates', () => {
      expect(parseEmails('Ada@X.edu\nada@x.edu')).toEqual(['ada@x.edu']);
    });

    it('finds nothing in text that holds no addresses', () => {
      expect(parseEmails('no addresses here at all')).toEqual([]);
    });
  });

  it('sends the parsed addresses, not the raw paste', async () => {
    signIn({ role: 'teacher', id: 1 });
    stub({ ...OWNER_VIEW, 'POST /courses/1/roster/import': { enrolled: ['ada@x.edu'], alreadyEnrolled: 0, notFound: [], notStudents: [] } });
    renderRoster();

    await userEvent.type(
      await screen.findByLabelText(/enrol a list of students/i),
      'Ada Lovelace,ada@x.edu'
    );
    await userEvent.click(screen.getByRole('button', { name: /enrol these/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/courses/1/roster/import', {
        emails: ['ada@x.edu'],
      });
    });
  });

  it('names the addresses that had no account rather than counting them', async () => {
    // An unmatched address is usually a typo or someone who never signed up.
    // A count tells the teacher there is a problem; the address tells them
    // which one to chase.
    signIn({ role: 'teacher', id: 1 });
    stub({
      ...OWNER_VIEW,
      'POST /courses/1/roster/import': {
        enrolled: ['ada@x.edu'],
        alreadyEnrolled: 1,
        notFound: ['ghost@x.edu'],
        notStudents: [],
      },
    });
    renderRoster();

    await userEvent.type(
      await screen.findByLabelText(/enrol a list of students/i),
      'ada@x.edu ghost@x.edu'
    );
    await userEvent.click(screen.getByRole('button', { name: /enrol these/i }));

    expect(await screen.findByText(/ghost@x.edu/)).toBeInTheDocument();
  });

  it('lets the owner appoint an assistant', async () => {
    signIn({ role: 'teacher', id: 1 });
    stub({ ...OWNER_VIEW, 'POST /courses/1/staff': { assistant: { user_id: 9 } } });
    renderRoster();

    await userEvent.type(await screen.findByLabelText(/add an assistant/i), 'grace@x.edu');
    await userEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/courses/1/staff', { email: 'grace@x.edu' });
    });
  });

  it('shows an assistant the staff list without the controls that are not theirs', async () => {
    // Rendering buttons that answer 404 is worse than not rendering them: it
    // reads as a bug in the system rather than as a boundary.
    signIn({ role: 'teacher', id: 5 });
    stub(OWNER_VIEW);
    renderRoster();

    expect(await screen.findByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.queryByLabelText(/add an assistant/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /remove grace hopper from the teaching staff/i })
    ).not.toBeInTheDocument();
    expect(screen.getByText(/only the course owner can change/i)).toBeInTheDocument();
  });

  it('hides the import on an archived course and says why', async () => {
    signIn({ role: 'teacher', id: 1 });
    stub({
      ...OWNER_VIEW,
      'GET /courses/1': { course: { id: 1, title: 'Algorithms', created_by: 1, archived: true } },
    });
    renderRoster();

    expect(await screen.findByText(/this course is archived/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /enrol these/i })).not.toBeInTheDocument();
  });
});

describe('exam administration', () => {
  const EXAM = {
    exam: {
      id: 5,
      course_id: 1,
      title: 'Midterm',
      start_time: '2026-09-01T09:00:00Z',
      end_time: '2026-09-01T11:00:00Z',
      duration_minutes: 120,
      problems_per_student: null,
    },
    problems: [],
    myProgress: [],
  };
  const RESULTS = {
    results: [
      {
        user_id: 9,
        name: 'Ada Lovelace',
        email: 'ada@x.edu',
        problem_id: 1,
        problem_title: 'Double it',
        best_passed: 3,
        total_count: 5,
        override_score: null,
        override_max: null,
        override_feedback: null,
        final_score: 3,
        final_max: 5,
        is_overridden: false,
      },
    ],
  };
  const routes = {
    'GET /exams/5/accommodations': { accommodations: [] },
    'GET /exams/5/results': RESULTS,
    'GET /exams/5': EXAM,
    'GET /courses/1/roster': {
      students: [{ id: 9, name: 'Ada Lovelace', email: 'ada@x.edu', submission_count: 2 }],
    },
    'PUT /exams/5/accommodations/9': { accommodation: {} },
    'PUT /exams/5/grades/9/1': { override: {} },
    'DELETE /exams/5/grades/9/1': { success: true },
  };

  const render = () =>
    renderApp(<ExamAdmin />, { route: '/teacher/exam/5', path: '/teacher/exam/:id' });

  it('grants extra time to one student', async () => {
    signIn({ role: 'teacher' });
    stub(routes);
    render();

    const minutes = await screen.findByLabelText(/extra minutes for ada/i);
    await userEvent.clear(minutes);
    await userEvent.type(minutes, '30');
    await userEvent.type(screen.getByLabelText(/note for ada/i), 'Documented arrangement');
    await userEvent.click(screen.getByRole('button', { name: /save extra time for ada/i }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/exams/5/accommodations/9', {
        extra_minutes: 30,
        note: 'Documented arrangement',
      });
    });
  });

  it('overrides a grade and keeps the automatic one visible', async () => {
    signIn({ role: 'teacher' });
    stub(routes);
    render();

    await userEvent.click(await screen.findByRole('button', { name: /edit ada.*double it/i }));
    expect(await screen.findByText(/3 of 5 tests passed/i)).toBeInTheDocument();

    const score = screen.getByLabelText(/^score$/i);
    await userEvent.clear(score);
    await userEvent.type(score, '5');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/exams/5/grades/9/1', {
        score: 5,
        max_score: 5,
        feedback: '',
      });
    });
  });

  it('reverts an override back to the automatic mark', async () => {
    signIn({ role: 'teacher' });
    stub({
      ...routes,
      'GET /exams/5/results': {
        results: [
          {
            ...RESULTS.results[0],
            override_score: 5,
            override_max: 5,
            final_score: 5,
            final_max: 5,
            is_overridden: true,
          },
        ],
      },
    });
    render();

    await userEvent.click(await screen.findByRole('button', { name: /edit ada.*double it/i }));
    await userEvent.click(await screen.findByRole('button', { name: /revert to automatic/i }));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/exams/5/grades/9/1');
    });
  });

  it('shows the deal only for a randomised exam', async () => {
    signIn({ role: 'teacher' });
    // Routes match on a substring and the first key wins, so the longer path
    // has to be declared before the prefix it extends.
    stub({
      'GET /exams/5/assignments': {
        assignments: [
          { user_id: 9, name: 'Ada Lovelace', email: 'ada@x.edu', problems: ['Double it', 'Sum'] },
        ],
      },
      ...routes,
      'GET /exams/5': { ...EXAM, exam: { ...EXAM.exam, problems_per_student: 2 } },
    });
    render();

    expect(await screen.findByText(/who was dealt what/i)).toBeInTheDocument();
    expect(await screen.findByText('Double it · Sum')).toBeInTheDocument();
  });

  it('has no detectable accessibility violations', async () => {
    signIn({ role: 'teacher' });
    stub(routes);
    const { container } = render();
    await screen.findByLabelText(/extra minutes for ada/i);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('the screening archive', () => {
  it('lists archived cohorts and deletes one', async () => {
    signIn({ role: 'teacher' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    stub({
      'GET /integrity/archive': {
        archives: [
          {
            source_label: 'Algorithms - 2025 Spring',
            submissions: 42,
            problems: 6,
            archived_at: '2026-01-05T10:00:00Z',
          },
        ],
      },
      'DELETE /integrity/archive': { deleted: 42 },
    });
    renderApp(<ArchivePage />);

    expect(await screen.findByText('Algorithms - 2025 Spring')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: /delete the archived cohort algorithms - 2025 spring/i })
    );

    await waitFor(() => {
      // The label travels in the path, so it has to be encoded.
      expect(api.delete).toHaveBeenCalledWith(
        `/integrity/archive/${encodeURIComponent('Algorithms - 2025 Spring')}`
      );
    });
  });

  it('archives a finished course from the courses page', async () => {
    signIn({ role: 'teacher' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    stub({
      'GET /courses': { courses: [{ ...COURSE, join_code: 'K7QP2XRT' }] },
      'POST /integrity/archive/course/1': { archived: 12, sourceLabel: 'Algorithms - 2026 Spring' },
    });
    renderApp(<Courses />);

    await userEvent.click(
      await screen.findByRole('button', { name: /keep algorithms for screening/i })
    );

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/integrity/archive/course/1');
    });
    expect(await screen.findByText(/12 submissions archived/i)).toBeInTheDocument();
  });
});

describe('a student’s own history', () => {
  it('lists submissions and labels one still being graded', async () => {
    signIn({ role: 'student' });
    stub({
      'GET /submissions/my': {
        submissions: [
          {
            id: 1,
            problem_id: 4,
            problem_title: 'Double it',
            language: 'python',
            status: 'completed',
            passed_count: 5,
            total_count: 5,
            submitted_at: '2026-08-01T10:00:00Z',
          },
          {
            id: 2,
            problem_id: 4,
            problem_title: 'Double it',
            language: 'python',
            status: 'queued',
            passed_count: 0,
            total_count: 5,
            submitted_at: '2026-08-01T11:00:00Z',
          },
        ],
      },
    });
    const { container } = renderApp(<MySubmissions />);

    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]).getByText('5 / 5')).toBeInTheDocument();
    expect(within(rows[2]).getByText(/queued/i)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('editing a course', () => {
  it('saves a rename and the archived flag together', async () => {
    signIn({ role: 'teacher' });
    stub({
      'GET /courses': { courses: [{ ...COURSE, join_code: 'K7QP2XRT' }] },
      'PUT /courses/1': { course: { id: 1 } },
    });
    renderApp(<Courses />);

    await userEvent.click(await screen.findByRole('button', { name: /edit algorithms/i }));

    // Scoped: the create form on the same page has identically labelled
    // fields, which is why the editor carries an accessible name of its own.
    const editor = within(await screen.findByRole('form', { name: /edit algorithms/i }));
    const title = editor.getByLabelText(/course title/i);
    await userEvent.clear(title);
    await userEvent.type(title, 'Algorithms II');
    await userEvent.click(editor.getByLabelText(/archive this course/i));
    await userEvent.click(editor.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/courses/1', {
        title: 'Algorithms II',
        term: '2026 Spring',
        description: '',
        archived: true,
      });
    });
  });
});
