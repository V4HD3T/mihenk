import { useCallback, useEffect, useId, useState } from 'react';
import api from '../../api/axios';
import { useT } from '../../i18n/index.jsx';
import CourseSelect from './CourseSelect.jsx';
import TestCaseEditor from './TestCaseEditor.jsx';

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
  time_limit_sec: '',
  memory_limit_mb: '',
  testCases: [{ input: '', expected_output: '', is_sample: true }],
};

// Field name on the problem, and the i18n key for its label. Driving the six
// starter-code boxes off a list keeps their ids unique by construction.
const STARTER_CODE_LANGUAGES = [
  { field: 'starter_code_python', key: 'python' },
  { field: 'starter_code_cpp', key: 'cpp' },
  { field: 'starter_code_java', key: 'java' },
  { field: 'starter_code_javascript', key: 'javascript' },
  { field: 'starter_code_c', key: 'c' },
  { field: 'starter_code_go', key: 'go' },
];

const CHECKERS = ['exact', 'case_insensitive', 'float', 'unordered_lines', 'unordered_tokens', 'regex'];

/**
 * Create a problem, or edit one that exists.
 *
 * Editing was missing until v0.2.0, so fixing a typo in a title meant deleting
 * the problem and writing it again - which took every submission against it
 * with it. The two modes share this form because they share every field; they
 * differ in where the test cases live. On create they are part of the payload;
 * on edit they have their own endpoints and are managed by TestCaseEditor.
 */
export default function ProblemForm({ courses, problemId, onSaved, onCancel }) {
  const t = useT();
  const uid = useId();
  const isEdit = Boolean(problemId);

  const [form, setForm] = useState(EMPTY_PROBLEM);
  const [existingCases, setExistingCases] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Also the refresh after a test case is added or removed, so the list the
  // editor shows is always the server's, not an optimistic guess.
  const loadProblem = useCallback(async () => {
    const { data } = await api.get(`/problems/${problemId}`);
    const p = data.problem;
    setForm({
      ...EMPTY_PROBLEM,
      ...p,
      course_id: String(p.course_id),
      // The server stores NULL for "use the default"; an input wants ''.
      time_limit_sec: p.time_limit_sec ?? '',
      memory_limit_mb: p.memory_limit_mb ?? '',
      checker_config: p.checker_config || {},
    });
    setExistingCases(data.testCases);
  }, [problemId]);

  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    loadProblem()
      .catch((err) => setError(err.response?.data?.error || t('common.error')))
      .finally(() => setLoading(false));
  }, [isEdit, loadProblem, t]);

  const updateTestCase = (idx, field, value) => {
    const next = [...form.testCases];
    next[idx] = { ...next[idx], [field]: value };
    setForm({ ...form, testCases: next });
  };

  const addTestCase = () =>
    setForm({ ...form, testCases: [...form.testCases, { input: '', expected_output: '', is_sample: false }] });

  const removeTestCase = (idx) =>
    setForm({ ...form, testCases: form.testCases.filter((_, i) => i !== idx) });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    // The limits are optional; '' means "use the server default", which the
    // API expresses as null. Sending '' would fail the numeric schema.
    const payload = {
      ...form,
      course_id: Number(form.course_id),
      time_limit_sec: form.time_limit_sec === '' ? null : Number(form.time_limit_sec),
      memory_limit_mb: form.memory_limit_mb === '' ? null : Number(form.memory_limit_mb),
    };

    try {
      if (isEdit) {
        // PUT replaces every column it names, so the whole problem goes up -
        // a partial body would blank the fields it left out.
        await api.put(`/problems/${problemId}`, payload);
      } else {
        await api.post('/problems', payload);
      }
      onSaved();
    } catch (err) {
      setError(
        err.response?.data?.error ||
          (isEdit ? t('teacher.updateProblemFailed') : t('teacher.createProblemFailed'))
      );
    } finally {
      setSaving(false);
    }
  };

  const checkerHelpKey = ['exact', 'float', 'regex'].includes(form.checker) ? form.checker : 'other';

  if (loading) {
    return (
      <div className="border border-line rounded-card p-6 bg-surface text-inkmuted">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="border border-line rounded-card p-6 bg-surface space-y-4">
      <h2 className="font-display text-lg font-medium">
        {isEdit ? t('teacher.editProblemHeading', { title: form.title }) : t('teacher.newProblemHeading')}
      </h2>
      {!isEdit && courses.length === 0 && (
        <p className="text-sm text-inkmuted">{t('teacher.createCourseFirst')}</p>
      )}

      <div className="grid sm:grid-cols-3 gap-3">
        {/* A problem cannot change course: its exams, submissions and
            similarity reports all hang off the course it was written for. */}
        <CourseSelect
          value={form.course_id}
          onChange={(v) => setForm({ ...form, course_id: v })}
          courses={courses}
          disabled={isEdit}
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
        <div>
          <label htmlFor={`${uid}-time`} className="text-xs text-inkmuted uppercase tracking-wide">
            {t('teacher.timeLimit')}
          </label>
          <input
            id={`${uid}-time`}
            type="number"
            min={1}
            max={60}
            value={form.time_limit_sec}
            onChange={(e) => setForm({ ...form, time_limit_sec: e.target.value })}
            placeholder={t('teacher.serverDefault')}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-memory`} className="text-xs text-inkmuted uppercase tracking-wide">
            {t('teacher.memoryLimit')}
          </label>
          <input
            id={`${uid}-memory`}
            type="number"
            min={64}
            max={2048}
            value={form.memory_limit_mb}
            onChange={(e) => setForm({ ...form, memory_limit_mb: e.target.value })}
            placeholder={t('teacher.serverDefault')}
            className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
          />
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
              value={form[field] || ''}
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
                defaultValue={form.checker_config?.tolerance ?? ''}
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

      {isEdit ? (
        <TestCaseEditor
          problemId={problemId}
          testCases={existingCases}
          onChanged={loadProblem}
        />
      ) : (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-inkmuted uppercase tracking-wide">{t('teacher.testCases')}</span>
            <button type="button" onClick={addTestCase} className="text-xs text-primary hover:underline">
              {t('teacher.addTest')}
            </button>
          </div>
          <div className="space-y-2">
            {form.testCases.map((tc, idx) => (
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
                  aria-label={t('teacher.deleteTestNamed', { number: idx + 1 })}
                  className="text-error text-xs px-2 pt-1.5 hover:underline"
                >
                  {t('teacher.deleteTest')}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-5 py-2.5 rounded-card bg-primary text-white font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {saving ? t('teacher.saving') : isEdit ? t('teacher.saveChanges') : t('teacher.createProblem')}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-5 py-2.5 rounded-card border border-line font-medium hover:border-ink transition-colors"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}
