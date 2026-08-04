import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';

// Every problem and exam belongs to a course as of v0.0.5, so both creation
// forms need the teacher to pick one first.
function CourseSelect({ value, onChange, courses }) {
  return (
    <select
      required
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
    >
      <option value="">Select a course…</option>
      {courses.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
          {c.term ? ` (${c.term})` : ''}
        </option>
      ))}
    </select>
  );
}

const EMPTY_PROBLEM = {
  course_id: '',
  title: '',
  description: '',
  difficulty: 'medium',
  starter_code_python: '',
  starter_code_cpp: '',
  starter_code_java: '',
  starter_code_javascript: '',
  starter_code_c: '',
  starter_code_go: '',
  checker: 'exact',
  checker_config: {},
  testCases: [{ input: '', expected_output: '', is_sample: true }],
};

function ProblemForm({ onCreated, courses }) {
  const [form, setForm] = useState(EMPTY_PROBLEM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const updateTestCase = (idx, field, value) => {
    const next = [...form.testCases];
    next[idx] = { ...next[idx], [field]: value };
    setForm({ ...form, testCases: next });
  };

  const addTestCase = () =>
    setForm({ ...form, testCases: [...form.testCases, { input: '', expected_output: '', is_sample: false }] });

  const removeTestCase = (idx) => setForm({ ...form, testCases: form.testCases.filter((_, i) => i !== idx) });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/problems', { ...form, course_id: Number(form.course_id) });
      setForm(EMPTY_PROBLEM);
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create problem');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border border-line rounded-card p-6 bg-surface space-y-4">
      <h3 className="font-display text-lg font-medium">New Problem</h3>
      {courses.length === 0 && (
        <p className="text-sm text-inkmuted">
          Create a course first — problems belong to a course.
        </p>
      )}
      <div className="grid sm:grid-cols-3 gap-3">
        <CourseSelect
          value={form.course_id}
          onChange={(v) => setForm({ ...form, course_id: v })}
          courses={courses}
        />
        <input
          required
          placeholder="Title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          className="sm:col-span-2 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
        />
        <select
          value={form.difficulty}
          onChange={(e) => setForm({ ...form, difficulty: e.target.value })}
          className="px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
        >
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
      </div>
      <textarea
        required
        placeholder="Problem description"
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        rows={3}
        className="w-full px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
      />

      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-inkmuted uppercase tracking-wide">Python starter code</label>
          <textarea
            value={form.starter_code_python}
            onChange={(e) => setForm({ ...form, starter_code_python: e.target.value })}
            rows={3}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line font-mono text-xs focus:border-primary outline-none"
          />
        </div>
        <div>
          <label className="text-xs text-inkmuted uppercase tracking-wide">C++ starter code</label>
          <textarea
            value={form.starter_code_cpp}
            onChange={(e) => setForm({ ...form, starter_code_cpp: e.target.value })}
            rows={3}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line font-mono text-xs focus:border-primary outline-none"
          />
        </div>
        <div>
          <label className="text-xs text-inkmuted uppercase tracking-wide">Java starter code</label>
          <textarea
            value={form.starter_code_java}
            onChange={(e) => setForm({ ...form, starter_code_java: e.target.value })}
            rows={3}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line font-mono text-xs focus:border-primary outline-none"
          />
        </div>
        <div>
          <label className="text-xs text-inkmuted uppercase tracking-wide">JavaScript starter code</label>
          <textarea
            value={form.starter_code_javascript}
            onChange={(e) => setForm({ ...form, starter_code_javascript: e.target.value })}
            rows={3}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line font-mono text-xs focus:border-primary outline-none"
          />
        </div>
        <div>
          <label className="text-xs text-inkmuted uppercase tracking-wide">C starter code</label>
          <textarea
            value={form.starter_code_c}
            onChange={(e) => setForm({ ...form, starter_code_c: e.target.value })}
            rows={3}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line font-mono text-xs focus:border-primary outline-none"
          />
        </div>
        <div>
          <label className="text-xs text-inkmuted uppercase tracking-wide">Go starter code</label>
          <textarea
            value={form.starter_code_go}
            onChange={(e) => setForm({ ...form, starter_code_go: e.target.value })}
            rows={3}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line font-mono text-xs focus:border-primary outline-none"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-inkmuted uppercase tracking-wide mb-1.5 block">
          How should the output be judged?
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          <select
            value={form.checker}
            onChange={(e) => setForm({ ...form, checker: e.target.value, checker_config: {} })}
            className="px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          >
            <option value="exact">Exact match</option>
            <option value="case_insensitive">Ignore capitalisation</option>
            <option value="float">Numbers, within a tolerance</option>
            <option value="unordered_lines">Same lines, any order</option>
            <option value="unordered_tokens">Same values, any order</option>
            <option value="regex">Matches a pattern</option>
          </select>
          {form.checker === 'float' && (
            <input
              type="number"
              step="any"
              placeholder="Tolerance (default 0.000001)"
              onChange={(e) =>
                setForm({
                  ...form,
                  checker_config: e.target.value ? { tolerance: Number(e.target.value) } : {},
                })
              }
              className="px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
            />
          )}
        </div>
        <p className="text-xs text-inkmuted mt-1.5">
          {form.checker === 'exact'
            ? 'Output must match character for character. Pick another option if the answer involves decimals or has no fixed order.'
            : form.checker === 'float'
              ? 'Numbers are compared numerically, so 0.30000000000000004 counts as 0.3.'
              : form.checker === 'regex'
                ? 'The expected output of each test case is treated as a regular expression the whole output must match.'
                : 'Whitespace and ordering differences are ignored where the option says so.'}
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-inkmuted uppercase tracking-wide">Test Cases</label>
          <button type="button" onClick={addTestCase} className="text-xs text-primary hover:underline">
            + Add test
          </button>
        </div>
        <div className="space-y-2">
          {form.testCases.map((tc, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-start">
              <input
                placeholder="Input"
                value={tc.input}
                onChange={(e) => updateTestCase(idx, 'input', e.target.value)}
                className="px-2 py-1.5 rounded-card border border-line font-mono text-xs focus:border-primary outline-none"
              />
              <input
                required
                placeholder="Expected output"
                value={tc.expected_output}
                onChange={(e) => updateTestCase(idx, 'expected_output', e.target.value)}
                className="px-2 py-1.5 rounded-card border border-line font-mono text-xs focus:border-primary outline-none"
              />
              <label className="flex items-center gap-1 text-xs text-inkmuted whitespace-nowrap px-1">
                <input
                  type="checkbox"
                  checked={tc.is_sample}
                  onChange={(e) => updateTestCase(idx, 'is_sample', e.target.checked)}
                />
                sample
              </label>
              <button
                type="button"
                onClick={() => removeTestCase(idx)}
                className="text-error text-xs px-2 hover:underline"
              >
                delete
              </button>
            </div>
          ))}
        </div>
      </div>

      {error && <div className="text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">{error}</div>}

      <button
        type="submit"
        disabled={saving}
        className="px-5 py-2.5 rounded-card bg-primary text-white font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Create Problem'}
      </button>
    </form>
  );
}

function ExamForm({ problems, courses, onCreated }) {
  const [courseId, setCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [duration, setDuration] = useState(60);
  const [selectedProblems, setSelectedProblems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggleProblem = (id) =>
    setSelectedProblems((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  // Only the chosen course's problems can go in the exam.
  const courseProblems = problems.filter((p) => String(p.course_id) === String(courseId));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api.post('/exams', {
        course_id: Number(courseId),
        title,
        description,
        start_time: new Date(startTime).toISOString(),
        end_time: new Date(endTime).toISOString(),
        duration_minutes: Number(duration),
        problem_ids: selectedProblems,
      });
      setTitle('');
      setDescription('');
      setStartTime('');
      setEndTime('');
      setCourseId('');
      setSelectedProblems([]);
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create exam');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border border-line rounded-card p-6 bg-surface space-y-4">
      <h3 className="font-display text-lg font-medium">New Exam</h3>
      <div className="grid sm:grid-cols-3 gap-3">
        <CourseSelect
          value={courseId}
          onChange={(v) => {
            // Switching course clears the selection: an exam may only contain
            // problems from its own course, which the server enforces too.
            setCourseId(v);
            setSelectedProblems([]);
          }}
          courses={courses}
        />
        <input
          required
          placeholder="Exam title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="sm:col-span-2 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
        />
      </div>
      <textarea
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        className="w-full px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
      />
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-inkmuted uppercase tracking-wide">Start</label>
          <input
            required
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          />
        </div>
        <div>
          <label className="text-xs text-inkmuted uppercase tracking-wide">End</label>
          <input
            required
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          />
        </div>
        <div>
          <label className="text-xs text-inkmuted uppercase tracking-wide">Duration (minutes)</label>
          <input
            required
            type="number"
            min={1}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-inkmuted uppercase tracking-wide mb-2 block">Problems to include in the exam</label>
        {!courseId ? (
          <p className="text-sm text-inkmuted">Pick a course first.</p>
        ) : courseProblems.length === 0 ? (
          <p className="text-sm text-inkmuted">This course has no problems yet — add one from the Problems tab.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {courseProblems.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => toggleProblem(p.id)}
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  selectedProblems.includes(p.id)
                    ? 'bg-primary text-white border-primary'
                    : 'border-line text-inkmuted hover:border-ink'
                }`}
              >
                {p.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <div className="text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">{error}</div>}

      <button
        type="submit"
        disabled={saving || selectedProblems.length === 0}
        className="px-5 py-2.5 rounded-card bg-primary text-white font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Create Exam'}
      </button>
    </form>
  );
}

export default function TeacherPanel() {
  const [tab, setTab] = useState('problems');
  const [problems, setProblems] = useState([]);
  const [exams, setExams] = useState([]);
  const [courses, setCourses] = useState([]);
  const [showProblemForm, setShowProblemForm] = useState(false);
  const [showExamForm, setShowExamForm] = useState(false);

  const loadProblems = () => api.get('/problems').then(({ data }) => setProblems(data.problems));
  const loadExams = () => api.get('/exams').then(({ data }) => setExams(data.exams));
  const loadCourses = () => api.get('/courses').then(({ data }) => setCourses(data.courses));

  useEffect(() => {
    loadProblems();
    loadExams();
    loadCourses();
  }, []);

  const handleDeleteProblem = async (id) => {
    if (!confirm('Are you sure you want to delete this problem?')) return;
    await api.delete(`/problems/${id}`);
    loadProblems();
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <h1 className="font-display text-3xl font-semibold mb-6">Teacher Dashboard</h1>

      <div className="flex gap-1.5 bg-surface border border-line rounded-full p-1 w-fit mb-6">
        {[
          { key: 'problems', label: 'Problems' },
          { key: 'exams', label: 'Exams' },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
              tab === t.key ? 'bg-primary text-white' : 'text-inkmuted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'problems' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <p className="text-inkmuted text-sm">{problems.length} problems</p>
            <button
              onClick={() => setShowProblemForm(!showProblemForm)}
              className="px-4 py-2 rounded-card border border-ink text-sm font-medium hover:bg-ink hover:text-white transition-colors"
            >
              {showProblemForm ? 'Close form' : '+ New Problem'}
            </button>
          </div>

          {showProblemForm && (
            <ProblemForm
              courses={courses}
              onCreated={() => {
                setShowProblemForm(false);
                loadProblems();
              }}
            />
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            {problems.map((p) => (
              <div key={p.id} className="border border-line rounded-card p-4 bg-surface flex items-start justify-between">
                <div>
                  <Link to={`/problem/${p.id}`} className="font-medium hover:text-primary transition-colors">
                    {p.title}
                  </Link>
                  <p className="text-xs text-inkmuted font-mono capitalize mt-1">{p.difficulty}</p>
                </div>
                <div className="flex gap-2">
                  <Link
                    to={`/teacher/similarity/${p.id}`}
                    className="text-xs text-warning hover:underline whitespace-nowrap"
                  >
                    similarity
                  </Link>
                  <Link
                    to={`/teacher/submissions/${p.id}`}
                    className="text-xs text-primary hover:underline whitespace-nowrap"
                  >
                    submissions
                  </Link>
                  <button onClick={() => handleDeleteProblem(p.id)} className="text-xs text-error hover:underline">
                    delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'exams' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <p className="text-inkmuted text-sm">{exams.length} exams</p>
            <button
              onClick={() => setShowExamForm(!showExamForm)}
              className="px-4 py-2 rounded-card border border-ink text-sm font-medium hover:bg-ink hover:text-white transition-colors"
            >
              {showExamForm ? 'Close form' : '+ New Exam'}
            </button>
          </div>

          {showExamForm && (
            <ExamForm
              problems={problems}
              courses={courses}
              onCreated={() => {
                setShowExamForm(false);
                loadExams();
              }}
            />
          )}

          <div className="space-y-3">
            {exams.map((e) => (
              <div key={e.id} className="border border-line rounded-card p-4 bg-surface flex items-center justify-between">
                <div>
                  <p className="font-medium">{e.title}</p>
                  <p className="text-xs text-inkmuted font-mono mt-1">
                    {e.problem_count} problems · {e.participant_count} participants ·{' '}
                    {new Date(e.start_time).toLocaleString('en-US')}
                  </p>
                </div>
                <Link to={`/exam/${e.id}`} className="text-sm text-primary hover:underline whitespace-nowrap">
                  view results →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
