import { useCallback, useEffect, useState } from 'react';
import api from '../api/axios';
import { useI18n, useT } from '../i18n/index.jsx';
import { dateLocale } from '../i18n/format.js';

/**
 * The teacher's private archive of finished cohorts.
 *
 * Screening a class against itself misses the oldest form of reuse: a solution
 * handed down from last year. v0.0.8 built the archive and the cross-cohort
 * comparison; until v0.2.0 nothing could add to it, list it or empty it.
 */
export default function ArchivePage() {
  const t = useT();
  const { language } = useI18n();
  const [archives, setArchives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/integrity/archive');
      setArchives(data.archives);
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (label, submissions) => {
    if (!window.confirm(t('archive.confirmDelete', { label, count: submissions }))) return;
    try {
      const { data } = await api.delete(`/integrity/archive/${encodeURIComponent(label)}`);
      setNotice(t('archive.deleted', { count: data.deleted, label }));
      load();
    } catch (err) {
      setError(err.response?.data?.error || t('common.error'));
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <h1 className="font-display text-3xl font-semibold mb-1">{t('archive.title')}</h1>
      <p className="text-inkmuted mb-8">{t('archive.subtitle')}</p>

      <div className="mb-8 text-sm text-inkmuted bg-surface border border-line rounded-card p-4 leading-relaxed">
        {t('archive.explainer')}
      </div>

      {error && (
        <p role="alert" className="mb-6 text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-6 text-sm bg-surface border border-line px-4 py-2.5 rounded-card">
          {notice}
        </p>
      )}

      {loading ? (
        <p className="text-inkmuted">{t('common.loading')}</p>
      ) : archives.length === 0 ? (
        <div className="border border-dashed border-line rounded-card p-12 text-center text-inkmuted">
          {t('archive.empty')}
        </div>
      ) : (
        <div className="overflow-x-auto border border-line rounded-card">
          <table className="w-full text-sm">
            <thead className="bg-ink/5 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">{t('archive.cohort')}</th>
                <th className="px-4 py-3 font-medium">{t('archive.problems')}</th>
                <th className="px-4 py-3 font-medium">{t('archive.submissions')}</th>
                <th className="px-4 py-3 font-medium">{t('archive.archivedAt')}</th>
                <th className="px-4 py-3">
                  <span className="sr-only">{t('roster.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {archives.map((a) => (
                <tr key={a.source_label} className="border-t border-line">
                  <td className="px-4 py-3 font-medium">{a.source_label}</td>
                  <td className="px-4 py-3 font-mono">{a.problems}</td>
                  <td className="px-4 py-3 font-mono">{a.submissions}</td>
                  <td className="px-4 py-3 text-xs text-inkmuted font-mono">
                    {new Date(a.archived_at).toLocaleString(dateLocale(language))}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(a.source_label, a.submissions)}
                      aria-label={t('archive.deleteNamed', { label: a.source_label })}
                      className="text-xs text-error hover:underline"
                    >
                      {t('common.delete')}
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
