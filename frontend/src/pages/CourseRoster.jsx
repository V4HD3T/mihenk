import { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';
import { useT } from '../i18n/index.jsx';

/** Who is enrolled in one course, with the option to remove someone. */
export default function CourseRoster() {
  const { id } = useParams();
  const t = useT();
  const [course, setCourse] = useState(null);
  const [students, setStudents] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [courseRes, rosterRes] = await Promise.all([
        api.get(`/courses/${id}`),
        api.get(`/courses/${id}/roster`),
      ]);
      setCourse(courseRes.data.course);
      setStudents(rosterRes.data.students);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || t('roster.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

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

      {error && <div className="mb-6 text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">{error}</div>}

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
