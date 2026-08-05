import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useI18n, useT } from '../i18n/index.jsx';
import { dateLocale } from '../i18n/format.js';

// Every problem and exam belongs to a course as of v0.0.5, so both creation
// forms need the teacher to pick one first.
function CourseSelect({ value, onChange, courses }) {
  const t = useT();
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="text-xs text-inkmuted uppercase tracking-wide">
        {t('teacher.course')}
      </label>
      <select
        id={id}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
      >
        <option value="">{t('teacher.selectCourse')}</option>
        {courses.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
            {c.term ? ` (${c.term})` : ''}
          </option>
        ))}
      </select>
    </div>
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

// Field name on the problem, and the i18n key for its label. Driving the six
// starter-code boxes off a list keeps their ids unique by construction - the
// hand-written version had the C++ box wearing the C box's name.
const STARTER_CODE_LANGUAGES = [
  { field: 'starter_code_python', key: 'python' },
  { field: 'starter_code_cpp', key: 'cpp' },
  { field: 'starter_code_java', key: 'java' },
  { field: 'starter_code_javascript', key: 'javascript' },
  { field: 'starter_code_c', key: 'c' },
  { field: 'starter_code_go', key: 'go' },
];

const CHECKERS = ['exact', 'case_insensitive', 'float', 'unordered_lines', 'unordered_tokens', 'regex'];

function ProblemForm({ onCreated, courses }) {
  const t = useT();
  const uid = useId();
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
      setError(err.response?.data?.error || t('teacher.createProblemFailed'));
    } finally {
      setSaving(false);
    }
  };

  // A checker whose help text has no dedicated entry falls back to the generic
  // one, so adding a checker server-side can't leave a blank explanation.
  const checkerHelpKey = ['exact', 'float', 'regex'].includes(form.checker) ? form.checker : 'other';

  return (
    <form onSubmit={handleSubmit} className="border border-line rounded-card p-6 bg-surface space-y-4">
      {/* h2, not h3: the page heading is the h1 and nothing sits between
          them. Skipping a level breaks heading navigation. */}
      <h2 className="font-display text-lg font-medium">{t('teacher.newProblemHeading')}</h2>
      {courses.length === 0 && <p className="text-sm text-inkmuted">{t('teacher.createCourseFirst')}</p>}
      <div className="grid sm:grid-cols-3 gap-3">
        <CourseSelect
          value={form.course_id}
          onChange={(v) => setForm({ ...form, course_id: v })}
          courses={courses}
        />
        <div className="sm:col-span-2">
          <label htmlFor={`${uid}-title`} className="text-xs text-inkmuted uppercase tracking-wide">
            {t('teacher.problemTitle')}
          </label>
          <input
            id={`${uid}-title`}
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-difficulty`} className="text-xs text-inkmuted uppercase tracking-wide">
            {t('teacher.difficulty')}
          </label>
          <select
            id={`${uid}-difficulty`}
            value={form.difficulty}
            onChange={(e) => setForm({ ...form, difficulty: e.target.value })}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          >
            <option value="easy">{t('teacher.difficultyValue.easy')}</option>
            <option value="medium">{t('teacher.difficultyValue.medium')}</option>
            <option value="hard">{t('teacher.difficultyValue.hard')}</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`${uid}-description`} className="text-xs text-inkmuted uppercase tracking-wide">
          {t('teacher.problemDescription')}
        </label>
        <textarea
          id={`${uid}-description`}
          required
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          rows={3}
          className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
        />
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        {STARTER_CODE_LANGUAGES.map(({ field, key }) => (
          <div key={field}>
            <label htmlFor={`${uid}-${key}`} className="text-xs text-inkmuted uppercase tracking-wide">
              {t('teacher.starterCode', { language: t(`languages.${key}`) })}
            </label>
            <textarea
              id={`${uid}-${key}`}
              value={form[field]}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
              rows={3}
              className="w-full mt-1 px-3 py-2 rounded-card border border-line font-mono text-xs focus:border-primary outline-none"
            />
          </div>
        ))}
      </div>

      <div>
        <label htmlFor={`${uid}-checker`} className="text-xs text-inkmuted uppercase tracking-wide mb-1.5 block">
          {t('teacher.checkerLabel')}
        </label>
        <div className="grid sm:grid-cols-2 gap-3">
          <select
            id={`${uid}-checker`}
            value={form.checker}
            onChange={(e) => setForm({ ...form, checker: e.target.value, checker_config: {} })}
            className="px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          >
            {CHECKERS.map((c) => (
              <option key={c} value={c}>
                {t(`teacher.checker.${c}`)}
              </option>
            ))}
          </select>
          {form.checker === 'float' && (
            <div>
              <label htmlFor={`${uid}-tolerance`} className="sr-only">
                {t('teacher.tolerance')}
              </label>
              <input
                id={`${uid}-tolerance`}
                type="number"
                step="any"
                placeholder={t('teacher.tolerancePlaceholder')}
                onChange={(e) =>
                  setForm({
                    ...form,
                    checker_config: e.target.value ? { tolerance: Number(e.target.value) } : {},
                  })
                }
                className="w-full px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
              />
            </div>
          )}
        </div>
        <p className="text-xs text-inkmuted mt-1.5">{t(`teacher.checkerHelp.${checkerHelpKey}`)}</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-inkmuted uppercase tracking-wide">{t('teacher.testCases')}</span>
          <button type="button" onClick={addTestCase} className="text-xs text-primary hover:underline">
            {t('teacher.addTest')}
          </button>
        </div>
        <div className="space-y-2">
          {form.testCases.map((tc, idx) => (
            // Every control in a repeated row needs an id of its own; sharing
            // one across rows points every label at the first row's field.
            <div key={idx} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-start">
              <div>
                <label htmlFor={`${uid}-tc-${idx}-input`} className="sr-only">
                  {t('teacher.testInput', { number: idx + 1 })}
                </label>
                <input
                  id={`${uid}-tc-${idx}-input`}
                  placeholder={t('teacher.testInputPlaceholder')}
                  value={tc.input}
                  onChange={(e) => updateTestCase(idx, 'input', e.target.value)}
                  className="w-full px-2 py-1.5 rounded-card border border-line font-mono text-xs focus:border-primary outline-none"
                />
              </div>
              <div>
                <label htmlFor={`${uid}-tc-${idx}-expected`} className="sr-only">
                  {t('teacher.testExpected', { number: idx + 1 })}
                </label>
                <input
                  id={`${uid}-tc-${idx}-expected`}
                  required
                  placeholder={t('teacher.testExpectedPlaceholder')}
                  value={tc.expected_output}
                  onChange={(e) => updateTestCase(idx, 'expected_output', e.target.value)}
                  className="w-full px-2 py-1.5 rounded-card border border-line font-mono text-xs focus:border-primary outline-none"
                />
              </div>
              <label
                htmlFor={`${uid}-tc-${idx}-sample`}
                className="flex items-center gap-1 text-xs text-inkmuted whitespace-nowrap px-1 pt-1.5"
              >
                <input
                  id={`${uid}-tc-${idx}-sample`}
                  type="checkbox"
                  checked={tc.is_sample}
                  onChange={(e) => updateTestCase(idx, 'is_sample', e.target.checked)}
                />
                {t('teacher.sample')}
              </label>
              <button
                type="button"
                onClick={() => removeTestCase(idx)}
                className="text-error text-xs px-2 pt-1.5 hover:underline"
              >
                {t('teacher.deleteTest', { number: idx + 1 })}
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
        {saving ? t('teacher.saving') : t('teacher.createProblem')}
      </button>
    </form>
  );
}

function ExamForm({ problems, courses, onCreated }) {
  const t = useT();
  const uid = useId();
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
      setError(err.response?.data?.error || t('teacher.createExamFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border border-line rounded-card p-6 bg-surface space-y-4">
      <h2 className="font-display text-lg font-medium">{t('teacher.newExamHeading')}</h2>
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
        <div className="sm:col-span-2">
          <label htmlFor={`${uid}-title`} className="text-xs text-inkmuted uppercase tracking-wide">
            {t('teacher.examTitle')}
          </label>
          <input
            id={`${uid}-title`}
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${uid}-description`} className="text-xs text-inkmuted uppercase tracking-wide">
          {t('teacher.examDescription')}
        </label>
        <textarea
          id={`${uid}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
        />
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor={`${uid}-start`} className="text-xs text-inkmuted uppercase tracking-wide">
            {t('teacher.start')}
          </label>
          <input
            id={`${uid}-start`}
            required
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-end`} className="text-xs text-inkmuted uppercase tracking-wide">
            {t('teacher.end')}
          </label>
          <input
            id={`${uid}-end`}
            required
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-duration`} className="text-xs text-inkmuted uppercase tracking-wide">
            {t('teacher.duration')}
          </label>
          <input
            id={`${uid}-duration`}
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
        <span className="text-xs text-inkmuted uppercase tracking-wide mb-2 block" id={`${uid}-problems-label`}>
          {t('teacher.problemsToInclude')}
        </span>
        {!courseId ? (
          <p className="text-sm text-inkmuted">{t('teacher.pickCourseFirst')}</p>
        ) : courseProblems.length === 0 ? (
          <p className="text-sm text-inkmuted">{t('teacher.courseHasNoProblems')}</p>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${uid}-problems-label`}>
            {courseProblems.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => toggleProblem(p.id)}
                aria-pressed={selectedProblems.includes(p.id)}
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
        {saving ? t('teacher.saving') : t('teacher.createExam')}
      </button>
    </form>
  );
}

export default function TeacherPanel() {
  const t = useT();
  const { language } = useI18n();
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

  const handleDeleteProblem = async (id, title) => {
    if (!confirm(t('teacher.confirmDeleteProblem', { title }))) return;
    await api.delete(`/problems/${id}`);
    loadProblems();
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <h1 className="font-display text-3xl font-semibold mb-6">{t('teacher.title')}</h1>

      <div
        className="flex gap-1.5 bg-surface border border-line rounded-full p-1 w-fit mb-6"
        role="group"
        aria-label={t('teacher.sections')}
      >
        {[
          { key: 'problems', label: t('nav.problems') },
          { key: 'exams', label: t('teacher.tabExams') },
        ].map((item) => (
          <button
            key={item.key}
            onClick={() => setTab(item.key)}
            aria-pressed={tab === item.key}
            className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
              tab === item.key ? 'bg-primary text-white' : 'text-inkmuted hover:text-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'problems' && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <p className="text-inkmuted text-sm">{t('teacher.problemCount', { count: problems.length })}</p>
            <button
              onClick={() => setShowProblemForm(!showProblemForm)}
              className="px-4 py-2 rounded-card border border-ink text-sm font-medium hover:bg-ink hover:text-white transition-colors"
            >
              {showProblemForm ? t('teacher.closeForm') : t('teacher.newProblem')}
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
              <div
                key={p.id}
                className="border border-line rounded-card p-4 bg-surface flex items-start justify-between"
              >
                <div>
                  <Link to={`/problem/${p.id}`} className="font-medium hover:text-primary transition-colors">
                    {p.title}
                  </Link>
                  <p className="text-xs text-inkmuted font-mono mt-1">
                    {t(`teacher.difficultyValue.${p.difficulty}`)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    to={`/teacher/similarity/${p.id}`}
                    className="text-xs text-warning hover:underline whitespace-nowrap"
                  >
                    {t('teacher.similarity')}
                  </Link>
                  <Link
                    to={`/teacher/submissions/${p.id}`}
                    className="text-xs text-primary hover:underline whitespace-nowrap"
                  >
                    {t('teacher.submissions')}
                  </Link>
                  {/* The name goes in the accessible label: a list of identical
                      "delete" buttons tells a screen-reader user nothing. */}
                  <button
                    onClick={() => handleDeleteProblem(p.id, p.title)}
                    aria-label={t('teacher.deleteProblemNamed', { title: p.title })}
                    className="text-xs text-error hover:underline"
                  >
                    {t('common.delete')}
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
            <p className="text-inkmuted text-sm">{t('teacher.examCount', { count: exams.length })}</p>
            <button
              onClick={() => setShowExamForm(!showExamForm)}
              className="px-4 py-2 rounded-card border border-ink text-sm font-medium hover:bg-ink hover:text-white transition-colors"
            >
              {showExamForm ? t('teacher.closeForm') : t('teacher.newExam')}
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
              <div
                key={e.id}
                className="border border-line rounded-card p-4 bg-surface flex items-center justify-between"
              >
                <div>
                  <p className="font-medium">{e.title}</p>
                  <p className="text-xs text-inkmuted font-mono mt-1">
                    {t('teacher.examMeta', {
                      problems: e.problem_count,
                      participants: e.participant_count,
                      start: new Date(e.start_time).toLocaleString(dateLocale(language)),
                    })}
                  </p>
                </div>
                <Link to={`/exam/${e.id}`} className="text-sm text-primary hover:underline whitespace-nowrap">
                  {t('teacher.viewResults')}
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
