import { useId, useState } from 'react';
import api from '../../api/axios';
import { useT } from '../../i18n/index.jsx';

/**
 * Test cases for a problem that already exists.
 *
 * On creation the cases travel with the problem in one payload. Afterwards
 * `PUT /problems/:id` does not touch them at all - they have their own
 * endpoints - so editing an existing problem manages them here, and each change
 * takes effect immediately rather than on save. The heading says so, because a
 * form where half the fields are deferred and half are not is a trap.
 */
export default function TestCaseEditor({ problemId, testCases, onChanged }) {
  const t = useT();
  const uid = useId();
  const [draft, setDraft] = useState({ input: '', expected_output: '', is_sample: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const add = async (e) => {
    e.preventDefault();
    if (!draft.expected_output.trim()) {
      setError(t('teacher.expectedOutputRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.post(`/problems/${problemId}/testcases`, draft);
      setDraft({ input: '', expected_output: '', is_sample: false });
      onChanged();
    } catch (err) {
      setError(err.response?.data?.error || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (tcId) => {
    // The last test case cannot go: a problem with none can never be graded,
    // and the submit endpoint rejects it with an error the teacher would meet
    // only after a student hit it.
    if (testCases.length <= 1) {
      setError(t('teacher.lastTestCase'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.delete(`/problems/${problemId}/testcases/${tcId}`);
      onChanged();
    } catch (err) {
      setError(err.response?.data?.error || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border border-line rounded-card p-4 bg-paper">
      <h3 className="text-xs text-inkmuted uppercase tracking-wide mb-1">
        {t('teacher.testCases')}
      </h3>
      <p className="text-xs text-inkmuted mb-3">{t('teacher.testCasesSaveImmediately')}</p>

      <ul className="space-y-2 mb-4">
        {testCases.map((tc, idx) => (
          <li
            key={tc.id}
            className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center text-xs font-mono"
          >
            <span className="px-2 py-1.5 rounded-card border border-line bg-surface truncate">
              {tc.input || t('solve.noInput')}
            </span>
            <span className="px-2 py-1.5 rounded-card border border-line bg-surface truncate">
              {tc.expected_output}
            </span>
            <span className="text-inkmuted whitespace-nowrap px-1">
              {tc.is_sample ? t('teacher.sample') : t('teacher.hidden')}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => remove(tc.id)}
              aria-label={t('teacher.deleteTestNamed', { number: idx + 1 })}
              className="text-error px-2 hover:underline disabled:opacity-50"
            >
              {t('teacher.deleteTest')}
            </button>
          </li>
        ))}
      </ul>

      {/* A nested <form> is invalid HTML, so this is a div and the button
          submits explicitly - the problem form around it must not be submitted
          by adding a test case. */}
      <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
        <div>
          <label htmlFor={`${uid}-input`} className="sr-only">
            {t('teacher.testInputPlaceholder')}
          </label>
          <input
            id={`${uid}-input`}
            value={draft.input}
            onChange={(e) => setDraft({ ...draft, input: e.target.value })}
            placeholder={t('teacher.testInputPlaceholder')}
            className="w-full px-2 py-1.5 rounded-card border border-line font-mono text-xs focus:border-primary outline-none"
          />
        </div>
        <div>
          <label htmlFor={`${uid}-expected`} className="sr-only">
            {t('teacher.testExpectedPlaceholder')}
          </label>
          <input
            id={`${uid}-expected`}
            value={draft.expected_output}
            onChange={(e) => setDraft({ ...draft, expected_output: e.target.value })}
            placeholder={t('teacher.testExpectedPlaceholder')}
            className="w-full px-2 py-1.5 rounded-card border border-line font-mono text-xs focus:border-primary outline-none"
          />
        </div>
        <label
          htmlFor={`${uid}-sample`}
          className="flex items-center gap-1 text-xs text-inkmuted whitespace-nowrap px-1"
        >
          <input
            id={`${uid}-sample`}
            type="checkbox"
            checked={draft.is_sample}
            onChange={(e) => setDraft({ ...draft, is_sample: e.target.checked })}
          />
          {t('teacher.sample')}
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={add}
          className="text-xs text-primary px-2 hover:underline disabled:opacity-50"
        >
          {t('teacher.addTest')}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-error bg-error-bg px-3 py-2 rounded-card">
          {error}
        </p>
      )}
    </section>
  );
}
