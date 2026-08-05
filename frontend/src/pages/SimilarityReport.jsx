import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';
import CodeDiffView from '../components/CodeDiffView';
import { useT } from '../i18n/index.jsx';

export default function SimilarityReport() {
  const { id } = useParams();
  const t = useT();
  const [problemTitle, setProblemTitle] = useState('');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [archive, setArchive] = useState(null);
  const [selectedPair, setSelectedPair] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    api.get(`/problems/${id}`).then(({ data }) => setProblemTitle(data.problem.title));
    api
      .get(`/integrity/problem/${id}/similarity`)
      .then(({ data }) => setGroups(data.groups))
      .finally(() => setLoading(false));
    // Screening against previous cohorts, which is a separate question from
    // screening the class against itself and uses a different threshold.
    api
      .get(`/integrity/problem/${id}/archive-matches`)
      .then(({ data }) => setArchive(data))
      .catch(() => setArchive(null));
  }, [id]);

  const openPair = async (pair) => {
    setSelectedPair(pair);
    setComparing(true);
    setComparison(null);
    try {
      const { data } = await api.get(`/integrity/compare/${pair.submissionIdA}/${pair.submissionIdB}`);
      setComparison(data);
    } finally {
      setComparing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <Link to="/" className="text-sm text-primary hover:underline mb-4 inline-block">
        {t('similarity.back')}
      </Link>
      <h1 className="font-display text-3xl font-semibold mb-1">{t('similarity.title')}</h1>
      <p className="text-inkmuted mb-8">{problemTitle}</p>

      <div className="mb-8 text-sm text-inkmuted bg-surface border border-line rounded-card p-4 leading-relaxed">
        {t('similarity.disclaimerBefore')}
        <span className="text-warning font-medium">{t('similarity.disclaimerNotable')}</span>
        {t('similarity.disclaimerAfter')}
      </div>

      {/* Reuse from a previous cohort, which the class-relative report cannot
          see: if last year's solution is passed round, it looks unremarkable
          against this year's classmates. */}
      {archive && archive.archiveSize > 0 && (
        <section className="mb-10">
          <h2 className="font-display text-lg font-medium mb-1">{t('similarity.archiveTitle')}</h2>
          <p className="text-xs text-inkmuted mb-3">
            {t('similarity.archiveNote', {
              size: archive.archiveSize,
              threshold: archive.threshold,
            })}
          </p>
          {archive.matches.length === 0 ? (
            <p className="text-sm text-inkmuted">{t('similarity.archiveNoMatches')}</p>
          ) : (
            <div className="border border-line rounded-card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-ink/5 text-left">
                    <th className="p-3 font-medium">{t('exam.student')}</th>
                    <th className="p-3 font-medium">{t('similarity.similarity')}</th>
                    <th className="p-3 font-medium">{t('similarity.archivedFrom')}</th>
                  </tr>
                </thead>
                <tbody>
                  {archive.matches.map((m, i) => (
                    <tr key={`${m.submissionId}-${i}`} className="border-t border-line">
                      <td className="p-3">{m.userName}</td>
                      <td className="p-3 font-mono text-warning font-medium">{m.similarity}%</td>
                      <td className="p-3 text-xs text-inkmuted">
                        {m.archivedFrom} · {m.archivedProblem} · {m.archivedStudent}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {loading ? (
        <p className="text-inkmuted">{t('common.loading')}</p>
      ) : groups.length === 0 ? (
        <div className="border border-dashed border-line rounded-card p-12 text-center text-inkmuted">
          {t('similarity.notEnough')}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <div key={group.language}>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="font-display text-lg font-medium capitalize">{group.language}</h2>
                <span className="text-xs font-mono text-inkmuted">
                  {t('similarity.groupMeta', { count: group.submissionCount, baseline: group.baseline })}
                </span>
              </div>
              <div className="border border-line rounded-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-ink/5 text-left">
                      <th className="p-3 font-medium">{t('similarity.pair')}</th>
                      <th className="p-3 font-medium">{t('similarity.similarity')}</th>
                      <th className="p-3 font-medium">
                        <span className="sr-only">{t('similarity.actions')}</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.pairs.map((p) => (
                      <tr key={`${p.submissionIdA}-${p.submissionIdB}`} className="border-t border-line">
                        <td className="p-3">
                          {p.userNameA} <span className="text-inkmuted">↔</span> {p.userNameB}
                        </td>
                        <td className="p-3 font-mono">
                          <span className={p.isNotable ? 'text-warning font-medium' : ''}>{p.similarity}%</span>
                          {p.isNotable && (
                            <span className="ml-2 text-xs font-mono px-2 py-0.5 rounded-full bg-warning-bg text-warning">
                              {t('similarity.notable')}
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          {/* One of these per row; the names make them distinct. */}
                          <button
                            onClick={() => openPair(p)}
                            aria-label={t('similarity.comparePair', { a: p.userNameA, b: p.userNameB })}
                            className="text-xs text-primary hover:underline"
                          >
                            {t('similarity.viewSideBySide')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedPair && (
        <div className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-medium">
              {selectedPair.userNameA} ↔ {selectedPair.userNameB}
            </h2>
            <button onClick={() => setSelectedPair(null)} className="text-sm text-inkmuted hover:text-ink">
              {t('similarity.close')}
            </button>
          </div>
          {comparing ? (
            <p className="text-inkmuted">{t('similarity.comparing')}</p>
          ) : (
            comparison && (
              <CodeDiffView
                submissionA={comparison.submissionA}
                submissionB={comparison.submissionB}
                similarity={comparison.similarity}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
