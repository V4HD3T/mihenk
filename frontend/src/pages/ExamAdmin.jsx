import { useCallback, useEffect, useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/axios';
import { useI18n, useT } from '../i18n/index.jsx';
import { dateLocale } from '../i18n/format.js';

/**
 * Running an exam, as opposed to reading its results.
 *
 * Extra time, grade overrides and the randomised deal have all existed in the
 * API since v0.0.6 and were reachable only with curl. An accommodation a
 * teacher cannot grant is not an accommodation.
 */

/** Extra time for one student, in minutes. 0 removes the grant. */
function AccommodationRow({ examId, student, current, onSaved }) {
  const t = useT();
  const uid = useId();
  const [minutes, setMinutes] = useState(current?.extra_minutes ?? 0);
  const [note, setNote] = useState(current?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.put(`/exams/${examId}/accommodations/${student.id}`, {
        extra_minutes: Number(minutes),
        note,
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="border-t border-line">
      <td className="px-4 py-3">
        <div>{student.name}</div>
        <div className="text-xs text-inkmuted font-mono">{student.email}</div>
      </td>
      <td className="px-4 py-3">
        <label htmlFor={`${uid}-minutes`} className="sr-only">
          {t('examAdmin.extraMinutesFor', { name: student.name })}
        </label>
        <input
          id={`${uid}-minutes`}
          type="number"
          min={0}
          max={1440}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          className="w-24 px-2 py-1.5 rounded-card border border-line font-mono text-sm focus:border-primary outline-none"
        />
      </td>
      <td className="px-4 py-3">
        <label htmlFor={`${uid}-note`} className="sr-only">
          {t('examAdmin.noteFor', { name: student.name })}
        </label>
        <input
          id={`${uid}-note`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('examAdmin.notePlaceholder')}
          className="w-full px-2 py-1.5 rounded-card border border-line text-sm focus:border-primary outline-none"
        />
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          aria-label={t('examAdmin.saveExtraTimeFor', { name: student.name })}
          className="text-xs text-primary hover:underline disabled:opacity-50"
        >
          {saving ? t('teacher.saving') : t('common.save')}
        </button>
        {error && (
          <p role="alert" className="text-xs text-error mt-1">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}

/** One student's mark on one problem, with the automatic score behind it. */
function GradeCell({ examId, row, onSaved }) {
  const t = useT();
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(row.final_score ?? 0);
  const [maxScore, setMaxScore] = useState(row.final_max || 1);
  const [feedback, setFeedback] = useState(row.override_feedback ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await api.put(`/exams/${examId}/grades/${row.user_id}/${row.problem_id}`, {
        score: Number(score),
        max_score: Number(maxScore),
        feedback,
      });
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError('');
    try {
      await api.delete(`/exams/${examId}/grades/${row.user_id}/${row.problem_id}`);
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t('examAdmin.editGradeFor', { name: row.name, problem: row.problem_title })}
        className="font-mono text-sm hover:underline"
      >
        {row.final_score} / {row.final_max}
        {row.is_overridden && (
          <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-warning-bg text-warning">
            {t('examAdmin.overridden')}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-2 p-3 rounded-card border border-line bg-paper space-y-2">
          {/* The automatic result stays on screen while overriding it, so the
              teacher can see what they are changing and by how much. */}
          <p className="text-xs text-inkmuted font-mono">
            {t('examAdmin.autoScore', { passed: row.best_passed, total: row.total_count })}
          </p>
          <div className="flex gap-2">
            <div>
              <label htmlFor={`${uid}-score`} className="text-xs text-inkmuted">
                {t('examAdmin.score')}
              </label>
              <input
                id={`${uid}-score`}
                type="number"
                min={0}
                value={score}
                onChange={(e) => setScore(e.target.value)}
                className="w-20 block px-2 py-1 rounded-card border border-line font-mono text-sm focus:border-primary outline-none"
              />
            </div>
            <div>
              <label htmlFor={`${uid}-max`} className="text-xs text-inkmuted">
                {t('examAdmin.outOf')}
              </label>
              <input
                id={`${uid}-max`}
                type="number"
                min={1}
                value={maxScore}
                onChange={(e) => setMaxScore(e.target.value)}
                className="w-20 block px-2 py-1 rounded-card border border-line font-mono text-sm focus:border-primary outline-none"
              />
            </div>
          </div>
          <div>
            <label htmlFor={`${uid}-feedback`} className="text-xs text-inkmuted">
              {t('examAdmin.feedback')}
            </label>
            <textarea
              id={`${uid}-feedback`}
              rows={2}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="w-full px-2 py-1 rounded-card border border-line text-sm focus:border-primary outline-none"
            />
          </div>
          {error && (
            <p role="alert" className="text-xs text-error">
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="text-xs text-primary hover:underline disabled:opacity-50"
            >
              {t('common.save')}
            </button>
            {row.is_overridden && (
              <button
                type="button"
                onClick={reset}
                disabled={busy}
                className="text-xs text-error hover:underline disabled:opacity-50"
              >
                {t('examAdmin.revertToAuto')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs text-inkmuted hover:underline"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ExamAdmin() {
  const { id } = useParams();
  const t = useT();
  const { language } = useI18n();

  const [exam, setExam] = useState(null);
  const [roster, setRoster] = useState([]);
  const [accommodations, setAccommodations] = useState([]);
  const [results, setResults] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAccommodations = useCallback(
    () =>
      api
        .get(`/exams/${id}/accommodations`)
        .then(({ data }) => setAccommodations(data.accommodations)),
    [id]
  );

  const loadResults = useCallback(
    () => api.get(`/exams/${id}/results`).then(({ data }) => setResults(data.results)),
    [id]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data: examData } = await api.get(`/exams/${id}`);
        if (cancelled) return;
        setExam(examData.exam);

        const [rosterRes] = await Promise.all([
          api.get(`/courses/${examData.exam.course_id}/roster`),
          loadAccommodations(),
          loadResults(),
        ]);
        if (cancelled) return;
        setRoster(rosterRes.data.students);

        if (examData.exam.problems_per_student) {
          const { data } = await api.get(`/exams/${id}/assignments`);
          if (!cancelled) setAssignments(data.assignments);
        }
      } catch (err) {
        if (!cancelled) setError(err.response?.data?.error || t('common.error'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, loadAccommodations, loadResults, t]);

  if (loading) return <div className="max-w-5xl mx-auto px-6 py-10 text-inkmuted">{t('common.loading')}</div>;
  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-10">
        <p role="alert" className="text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">
          {error}
        </p>
      </div>
    );
  }

  const accommodationByUser = new Map(accommodations.map((a) => [a.user_id, a]));
  const students = [...new Map(results.map((r) => [r.user_id, r])).values()];
  const problemTitles = [...new Map(results.map((r) => [r.problem_id, r.problem_title])).entries()];

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Link to="/" className="text-sm text-primary hover:underline mb-4 inline-block">
        {t('examAdmin.back')}
      </Link>
      <h1 className="font-display text-3xl font-semibold mb-1">{exam.title}</h1>
      <p className="text-sm font-mono text-inkmuted mb-8">
        {t('exam.schedule', {
          start: new Date(exam.start_time).toLocaleString(dateLocale(language)),
          end: new Date(exam.end_time).toLocaleString(dateLocale(language)),
          minutes: t('exam.minutes', { count: exam.duration_minutes }),
        })}
      </p>

      <section className="mb-10">
        <h2 className="font-display text-xl font-medium mb-1">{t('examAdmin.accommodations')}</h2>
        <p className="text-xs text-inkmuted mb-4">{t('examAdmin.accommodationsHelp')}</p>
        {roster.length === 0 ? (
          <p className="text-sm text-inkmuted">{t('roster.empty')}</p>
        ) : (
          <div className="overflow-x-auto border border-line rounded-card">
            <table className="w-full text-sm">
              <thead className="bg-ink/5 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('roster.name')}</th>
                  <th className="px-4 py-3 font-medium">{t('examAdmin.extraMinutes')}</th>
                  <th className="px-4 py-3 font-medium">{t('examAdmin.note')}</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">{t('roster.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {roster.map((s) => (
                  <AccommodationRow
                    key={s.id}
                    examId={id}
                    student={s}
                    current={accommodationByUser.get(s.id)}
                    onSaved={loadAccommodations}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-10">
        <h2 className="font-display text-xl font-medium mb-1">{t('examAdmin.grades')}</h2>
        <p className="text-xs text-inkmuted mb-4">{t('examAdmin.gradesHelp')}</p>
        {results.length === 0 ? (
          <p className="text-sm text-inkmuted">{t('exam.noSubmissions')}</p>
        ) : (
          <div className="overflow-x-auto border border-line rounded-card">
            <table className="w-full text-sm">
              <thead className="bg-ink/5 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">{t('exam.student')}</th>
                  {problemTitles.map(([pid, title]) => (
                    <th key={pid} className="px-4 py-3 font-medium whitespace-nowrap">
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {students.map((s) => (
                  <tr key={s.user_id} className="border-t border-line align-top">
                    <td className="px-4 py-3">
                      <div>{s.name}</div>
                      <div className="text-xs text-inkmuted font-mono">{s.email}</div>
                    </td>
                    {problemTitles.map(([pid]) => {
                      const row = results.find(
                        (r) => r.user_id === s.user_id && r.problem_id === pid
                      );
                      return (
                        <td key={pid} className="px-4 py-3">
                          {row ? (
                            <GradeCell examId={id} row={row} onSaved={loadResults} />
                          ) : (
                            <span className="text-inkmuted">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {exam.problems_per_student && (
        <section>
          <h2 className="font-display text-xl font-medium mb-1">{t('examAdmin.assignments')}</h2>
          <p className="text-xs text-inkmuted mb-4">
            {t('examAdmin.assignmentsHelp', { count: exam.problems_per_student })}
          </p>
          {assignments.length === 0 ? (
            <p className="text-sm text-inkmuted">{t('examAdmin.noAssignments')}</p>
          ) : (
            <div className="overflow-x-auto border border-line rounded-card">
              <table className="w-full text-sm">
                <thead className="bg-ink/5 text-left">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t('exam.student')}</th>
                    <th className="px-4 py-3 font-medium">{t('nav.problems')}</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => (
                    <tr key={a.user_id} className="border-t border-line">
                      <td className="px-4 py-3">
                        <div>{a.name}</div>
                        <div className="text-xs text-inkmuted font-mono">{a.email}</div>
                      </td>
                      <td className="px-4 py-3">{a.problems.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
