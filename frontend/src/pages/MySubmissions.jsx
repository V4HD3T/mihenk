import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useI18n, useT } from '../i18n/index.jsx';
import { dateLocale } from '../i18n/format.js';

const STATUS_STYLE = {
  completed: 'bg-success-bg text-success',
  queued: 'bg-warning-bg text-warning',
  running: 'bg-warning-bg text-warning',
  error: 'bg-error-bg text-error',
};

/**
 * A student's own submission history.
 *
 * `GET /api/submissions/my` has returned this since v0.0.1 and nothing ever
 * asked for it, so the only record a student had of their work was whatever
 * was still on screen.
 */
export default function MySubmissions() {
  const t = useT();
  const { language } = useI18n();
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/submissions/my')
      .then(({ data }) => setSubmissions(data.submissions))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <h1 className="font-display text-3xl font-semibold mb-1">{t('mySubmissions.title')}</h1>
      <p className="text-inkmuted mb-8">{t('mySubmissions.subtitle')}</p>

      {loading ? (
        <p className="text-inkmuted">{t('common.loading')}</p>
      ) : submissions.length === 0 ? (
        <div className="border border-dashed border-line rounded-card p-12 text-center text-inkmuted">
          {t('mySubmissions.empty')}
        </div>
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
                  <td className="px-4 py-3">
                    <Link to={`/problem/${s.problem_id}`} className="hover:text-primary transition-colors">
                      {s.problem_title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono uppercase text-xs">{s.language}</td>
                  <td className="px-4 py-3">
                    {s.status === 'completed' ? (
                      <span
                        className={`font-mono ${
                          s.passed_count === s.total_count ? 'text-success' : 'text-error'
                        }`}
                      >
                        {s.passed_count} / {s.total_count}
                      </span>
                    ) : (
                      <span
                        className={`text-xs font-mono px-2 py-1 rounded-full ${
                          STATUS_STYLE[s.status] || 'bg-ink/10 text-inkmuted'
                        }`}
                      >
                        {t(`mySubmissions.status.${s.status}`)}
                      </span>
                    )}
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
