import { useEffect, useId, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';
import { useT } from '../i18n/index.jsx';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Splits a pasted class list into addresses.
 *
 * Deliberately forgiving about what a teacher pastes: a column out of a
 * spreadsheet, a comma-separated line, or a CSV with "Name,Email" rows. Anything
 * that looks like an address is taken and the rest of the row is ignored, which
 * is cheaper than making the teacher clean the file first and safer than
 * guessing which column is which.
 */
export function parseEmails(text) {
  return [
    ...new Set(
      (text.match(/[^\s,;<>"']+@[^\s,;<>"']+\.[^\s,;<>"']+/g) || []).map((e) =>
        e.trim().toLowerCase().replace(/[.,;]+$/, '')
      )
    ),
  ];
}

/** Who is enrolled in one course, with the option to remove someone. */
export default function CourseRoster() {
  const { id } = useParams();
  const t = useT();
  const uid = useId();
  const { user } = useAuth();
  const [course, setCourse] = useState(null);
  const [students, setStudents] = useState([]);
  const [staff, setStaff] = useState({ owner: null, assistants: [] });
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState(null);
  const [assistantEmail, setAssistantEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Only the owner administers the course. An assistant reads the same page
  // without the controls that are not theirs, rather than being shown buttons
  // that answer 404.
  const isOwner = Boolean(course && user && course.created_by === user.id);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [courseRes, rosterRes, staffRes] = await Promise.all([
        api.get(`/courses/${id}`),
        api.get(`/courses/${id}/roster`),
        api.get(`/courses/${id}/staff`),
      ]);
      setCourse(courseRes.data.course);
      setStudents(rosterRes.data.students || []);
      setStaff({
        owner: staffRes.data?.owner || null,
        assistants: staffRes.data?.assistants || [],
      });
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || t('roster.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  const runImport = async () => {
    const emails = parseEmails(importText);
    if (emails.length === 0) {
      setError(t('roster.importNoAddresses'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await api.post(`/courses/${id}/roster/import`, { emails });
      setImportResult(res.data);
      setImportText('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || t('roster.importFailed'));
    } finally {
      setBusy(false);
    }
  };

  const addAssistant = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/courses/${id}/staff`, { email: assistantEmail });
      setAssistantEmail('');
      load();
    } catch (err) {
      setError(err.response?.data?.error || t('roster.staffAddFailed'));
    } finally {
      setBusy(false);
    }
  };

  const removeAssistant = async (userId, name) => {
    if (!window.confirm(t('roster.confirmRemoveStaff', { name }))) return;
    setBusy(true);
    try {
      await api.delete(`/courses/${id}/staff/${userId}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || t('roster.staffRemoveFailed'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (userId, name) => {
    // Unenrolling hides the course's content from them again, so confirm first.
    if (!window.confirm(t('roster.confirmRemove', { name }))) {
      return;
    }
    try {
      await api.delete(`/courses/${id}/roster/${userId}`);
      load();
    } catch (err) {
      setError(err.response?.data?.error || t('roster.removeFailed'));
    }
  };

  if (loading) return <div className="max-w-4xl mx-auto px-6 py-10 text-inkmuted">{t('common.loading')}</div>;

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <Link to="/courses" className="text-sm text-primary hover:underline">
        {t('roster.back')}
      </Link>
      <h1 className="font-display text-3xl font-semibold mt-3 mb-1">{course?.title}</h1>
      <p className="text-inkmuted mb-8">
        {t('roster.enrolled', { count: students.length })}
        {course?.join_code && (
          <>
            {` ${t('roster.withJoinCode')} `}
            <code className="font-mono tracking-widest">{course.join_code}</code>
          </>
        )}
      </p>

      {error && <div role="alert" className="mb-6 text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">{error}</div>}

      {course?.archived && (
        <div className="mb-6 text-sm bg-surface border border-line px-4 py-2.5 rounded-card">
          {t('roster.archivedNotice')}
        </div>
      )}

      {/* Teaching staff. Everyone who teaches the course can see who else does;
          only the owner can change it. */}
      <section className="mb-8 border border-line rounded-card p-5 bg-surface">
        <h2 className="font-display text-lg font-medium mb-3">{t('roster.staffHeading')}</h2>
        <ul className="space-y-1.5 mb-4 text-sm">
          {staff.owner && (
            <li className="flex items-center gap-2">
              <span>{staff.owner.name}</span>
              <span className="text-xs text-inkmuted">{staff.owner.email}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-paper border border-line text-inkmuted">
                {t('roster.roleOwner')}
              </span>
            </li>
          )}
          {staff.assistants.map((a) => (
            <li key={a.user_id} className="flex items-center gap-2">
              <span>{a.name}</span>
              <span className="text-xs text-inkmuted">{a.email}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-paper border border-line text-inkmuted">
                {t('roster.roleAssistant')}
              </span>
              {isOwner && (
                <button
                  onClick={() => removeAssistant(a.user_id, a.name)}
                  disabled={busy}
                  aria-label={t('roster.removeStaffNamed', { name: a.name })}
                  className="text-xs text-error hover:underline disabled:opacity-50"
                >
                  {t('roster.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>

        {isOwner ? (
          <form onSubmit={addAssistant} className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[16rem]">
              <label htmlFor={`${uid}-assistant`} className="text-xs text-inkmuted uppercase tracking-wide">
                {t('roster.addAssistant')}
              </label>
              <input
                id={`${uid}-assistant`}
                type="email"
                required
                value={assistantEmail}
                onChange={(e) => setAssistantEmail(e.target.value)}
                placeholder={t('roster.assistantPlaceholder')}
                className="w-full mt-1 px-3 py-2 rounded-card border border-line focus:border-primary outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-2 rounded-card bg-primary text-white text-sm font-medium hover:bg-primary-dark disabled:opacity-50"
            >
              {t('roster.add')}
            </button>
          </form>
        ) : (
          <p className="text-xs text-inkmuted">{t('roster.staffOwnerOnly')}</p>
        )}
      </section>

      {/* Bulk enrolment. The join code still works; this is for the cohort of
          two hundred that will not type one. */}
      {!course?.archived && (
        <section className="mb-8 border border-line rounded-card p-5 bg-surface">
          <h2 className="font-display text-lg font-medium mb-1">{t('roster.importHeading')}</h2>
          <p className="text-xs text-inkmuted mb-3">{t('roster.importHelp')}</p>
          <label htmlFor={`${uid}-import`} className="sr-only">
            {t('roster.importHeading')}
          </label>
          <textarea
            id={`${uid}-import`}
            rows={4}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder={'alice@x.edu\nBob Smith,bob@x.edu'}
            className="w-full px-3 py-2 rounded-card border border-line font-mono text-xs focus:border-primary outline-none"
          />
          <div className="flex items-center gap-3 mt-2">
            <button
              type="button"
              onClick={runImport}
              disabled={busy || !importText.trim()}
              className="px-4 py-2 rounded-card bg-primary text-white text-sm font-medium hover:bg-primary-dark disabled:opacity-50"
            >
              {busy ? t('roster.importing') : t('roster.import')}
            </button>
            {importText.trim() && (
              <span className="text-xs text-inkmuted">
                {t('roster.importFound', { count: parseEmails(importText).length })}
              </span>
            )}
          </div>

          {importResult && (
            <div className="mt-3 text-sm space-y-1" role="status">
              <p className="text-success">
                {t('roster.importEnrolled', { count: importResult.enrolled.length })}
              </p>
              {importResult.alreadyEnrolled > 0 && (
                <p className="text-inkmuted">
                  {t('roster.importAlready', { count: importResult.alreadyEnrolled })}
                </p>
              )}
              {/* Named rather than counted: an unmatched address is usually a
                  typo or someone who has not signed up, and the teacher needs
                  to know which one to chase. */}
              {importResult.notFound.length > 0 && (
                <p className="text-error">
                  {t('roster.importNotFound', { emails: importResult.notFound.join(', ') })}
                </p>
              )}
              {importResult.notStudents.length > 0 && (
                <p className="text-inkmuted">
                  {t('roster.importNotStudents', { emails: importResult.notStudents.join(', ') })}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {students.length === 0 ? (
        <p className="text-inkmuted">{t('roster.empty')}</p>
      ) : (
        <div className="rounded-card border border-line overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left">
              <tr>
                <th className="px-4 py-3 font-medium">{t('roster.name')}</th>
                <th className="px-4 py-3 font-medium">{t('roster.email')}</th>
                <th className="px-4 py-3 font-medium">{t('roster.submissions')}</th>
                <th className="px-4 py-3">
                  <span className="sr-only">{t('roster.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-4 py-3">{s.name}</td>
                  <td className="px-4 py-3 text-inkmuted">{s.email}</td>
                  <td className="px-4 py-3 text-inkmuted">{s.submission_count}</td>
                  <td className="px-4 py-3 text-right">
                    {/* Without the name, every row's button reads the same. */}
                    <button
                      onClick={() => remove(s.id, s.name)}
                      aria-label={t('roster.removeNamed', { name: s.name })}
                      className="text-xs text-error hover:underline"
                    >
                      {t('roster.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
