import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';
import CodeDiffView from '../components/CodeDiffView';

export default function SimilarityReport() {
  const { id } = useParams();
  const [problemTitle, setProblemTitle] = useState('');
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPair, setSelectedPair] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    api.get(`/problems/${id}`).then(({ data }) => setProblemTitle(data.problem.title));
    api
      .get(`/integrity/problem/${id}/similarity`)
      .then(({ data }) => setGroups(data.groups))
      .finally(() => setLoading(false));
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
        ← Back to dashboard
      </Link>
      <h1 className="font-display text-3xl font-semibold mb-1">Similarity Report</h1>
      <p className="text-inkmuted mb-8">{problemTitle}</p>

      <div className="mb-8 text-sm text-inkmuted bg-surface border border-line rounded-card p-4 leading-relaxed">
        This is a screening tool, not a verdict. Short exercises often have only one or two
        reasonable solutions, so some baseline similarity across the whole class is normal and
        expected. A pair is only flagged as <span className="text-warning font-medium">notable</span> when
        it sits well above what the rest of the class produced on its own — always review the
        highlighted code yourself before drawing any conclusion.
      </div>

      {loading ? (
        <p className="text-inkmuted">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="border border-dashed border-line rounded-card p-12 text-center text-inkmuted">
          Not enough submissions in the same language yet to compare.
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <div key={group.language}>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="font-display text-lg font-medium capitalize">{group.language}</h2>
                <span className="text-xs font-mono text-inkmuted">
                  {group.submissionCount} submissions · class baseline {group.baseline}%
                </span>
              </div>
              <div className="border border-line rounded-card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-ink/5 text-left">
                      <th className="p-3 font-medium">Pair</th>
                      <th className="p-3 font-medium">Similarity</th>
                      <th className="p-3 font-medium"></th>
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
                              NOTABLE
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-right">
                          <button onClick={() => openPair(p)} className="text-xs text-primary hover:underline">
                            view side-by-side →
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
              close ✕
            </button>
          </div>
          {comparing ? (
            <p className="text-inkmuted">Comparing…</p>
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
