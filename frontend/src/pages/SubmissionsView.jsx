import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';
import { useI18n, useT } from '../i18n/index.jsx';
import { dateLocale } from '../i18n/format.js';

export default function SubmissionsView() {
  const { id } = useParams();
  const t = useT();
  const { language } = useI18n();
  const [submissions, setSubmissions] = useState([]);
  const [problemTitle, setProblemTitle] = useState('');

  useEffect(() => {
    api.get(`/submissions/problem/${id}`).then(({ data }) => setSubmissions(data.submissions));
    api.get(`/problems/${id}`).then(({ data }) => setProblemTitle(data.problem.title));
  }, [id]);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <Link to="/" className="text-sm text-primary hover:underline mb-4 inline-block">
        {t('submissions.back')}
      </Link>
      <h1 className="font-display text-3xl font-semibold mb-6">
        {t('submissions.title', { problem: problemTitle })}
      </h1>

      {submissions.length === 0 ? (
        <p className="text-inkmuted">{t('submissions.empty')}</p>
      ) : (
        <div className="overflow-x-auto border border-line rounded-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink/5 text-left">
                <th className="p-3 font-medium">{t('submissions.student')}</th>
                <th className="p-3 font-medium">{t('submissions.language')}</th>
                <th className="p-3 font-medium">{t('submissions.result')}</th>
                <th className="p-3 font-medium">{t('submissions.date')}</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="p-3">
                    <div>{s.user_name}</div>
                    <div className="text-xs text-inkmuted font-mono">{s.user_email}</div>
                  </td>
                  <td className="p-3 font-mono uppercase text-xs">{s.language}</td>
                  <td className="p-3 font-mono">
                    <span className={s.passed_count === s.total_count ? 'text-success' : 'text-error'}>
                      {s.passed_count} / {s.total_count}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-inkmuted font-mono">
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
