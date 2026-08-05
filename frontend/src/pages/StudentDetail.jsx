import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/axios';
import { useI18n, useT } from '../i18n/index.jsx';
import { dateLocale } from '../i18n/format.js';

/**
 * One student's recent work, for the teacher who teaches them.
 *
 * The endpoint scopes to the teacher's own courses, so this shows what the
 * student did here and nothing about their other classes.
 */
export default function StudentDetail() {
  const { id } = useParams();
  const t = useT();
  const { language } = useI18n();
  const [student, setStudent] = useState(null);
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get(`/users/students/${id}`)
      .then(({ data }) => {
        setStudent(data.student);
        setSubmissions(data.submissions);
      })
      .catch((err) => setError(err.response?.data?.error || t('common.error')))
      .finally(() => setLoading(false));
  }, [id, t]);

  if (loading) return <div className="max-w-4xl mx-auto px-6 py-10 text-inkmuted">{t('common.loading')}</div>;
  if (error) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10">
        <p role="alert" className="text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <Link to="/students" className="text-sm text-primary hover:underline mb-4 inline-block">
        {t('studentDetail.back')}
      </Link>
      <h1 className="font-display text-3xl font-semibold mb-1">{student.name}</h1>
      <p className="text-sm font-mono text-inkmuted mb-8">{student.email}</p>

      <h2 className="font-display text-xl font-medium mb-1">{t('studentDetail.recentWork')}</h2>
      <p className="text-xs text-inkmuted mb-4">{t('studentDetail.scopeNote')}</p>

      {submissions.length === 0 ? (
        <p className="text-inkmuted">{t('exam.noSubmissions')}</p>
      ) : (
        <div className="overflow-x-auto border border-line rounded-card">
          <table className="w-full text-sm">
            <thead className="bg-ink/5 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">{t('nav.problems')}</th>
                <th className="px-4 py-3 font-medium">{t('submissions.language')}</th>
                <th className="px-4 py-3 font-medium">{t('submissions.result')}</th>
                <th className="px-4 py-3 font-medium">{t('submissions.date')}</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-4 py-3">{s.problem_title}</td>
                  <td className="px-4 py-3 font-mono uppercase text-xs">{s.language}</td>
                  <td className="px-4 py-3 font-mono">
                    <span className={s.passed_count === s.total_count ? 'text-success' : 'text-error'}>
                      {s.passed_count} / {s.total_count}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-inkmuted font-mono">
                    {new Date(s.submitted_at).toLocaleString(dateLocale(language))}
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
