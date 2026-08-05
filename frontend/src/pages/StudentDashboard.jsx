import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useT } from '../i18n/index.jsx';

const DIFFICULTY_STYLE = {
  easy: 'text-success bg-success-bg',
  medium: 'text-warning bg-warning-bg',
  hard: 'text-error bg-error-bg',
};

export default function StudentDashboard() {
  const t = useT();
  const [problems, setProblems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    api
      .get('/problems')
      .then(({ data }) => setProblems(data.problems))
      .finally(() => setLoading(false));
  }, []);

  const filtered = problems.filter((p) => filter === 'all' || p.difficulty === filter);
  const solvedCount = problems.filter((p) => p.solved_by_me).length;

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="flex items-end justify-between mb-8 flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold">{t('dashboard.title')}</h1>
          <p className="text-inkmuted mt-1">
            {t('dashboard.solvedOf', { solved: solvedCount, total: problems.length })}
          </p>
        </div>
        <div className="flex gap-1.5 bg-surface border border-line rounded-full p-1" role="group" aria-label={t('teacher.difficulty')}>
          {['all', 'easy', 'medium', 'hard'].map((d) => (
            <button
              key={d}
              onClick={() => setFilter(d)}
              aria-pressed={filter === d}
              className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                filter === d ? 'bg-primary text-white' : 'text-inkmuted hover:text-ink'
              }`}
            >
              {d === 'all' ? t('dashboard.filterAll') : t(`teacher.difficultyValue.${d}`)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-inkmuted">{t('common.loading')}</p>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-line rounded-card p-12 text-center text-inkmuted">
          {t('dashboard.empty')}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <Link
              key={p.id}
              to={`/problem/${p.id}`}
              className="group border border-line bg-surface rounded-card p-5 hover:border-primary hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <span className={`text-xs font-mono px-2 py-1 rounded-full ${DIFFICULTY_STYLE[p.difficulty] || ''}`}>
                  {t(`teacher.difficultyValue.${p.difficulty}`)}
                </span>
                {p.solved_by_me && (
                  <span className="w-5 h-5 rounded-full bg-success flex items-center justify-center text-white text-xs">
                    ✓
                  </span>
                )}
              </div>
              <h3 className="font-display text-lg font-medium mb-1 group-hover:text-primary transition-colors">
                {p.title}
              </h3>
              <p className="text-xs text-inkmuted font-mono">{p.created_by_name}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
