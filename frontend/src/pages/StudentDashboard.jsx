import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';

const DIFFICULTY_STYLE = {
  easy: 'text-success bg-success-bg',
  medium: 'text-warning bg-warning-bg',
  hard: 'text-error bg-error-bg',
};

export default function StudentDashboard() {
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
          <h1 className="font-display text-3xl font-semibold">Problems</h1>
          <p className="text-inkmuted mt-1">
            {solvedCount} / {problems.length} problems solved
          </p>
        </div>
        <div className="flex gap-1.5 bg-surface border border-line rounded-full p-1">
          {['all', 'easy', 'medium', 'hard'].map((d) => (
            <button
              key={d}
              onClick={() => setFilter(d)}
              className={`px-4 py-1.5 rounded-full text-sm capitalize transition-colors ${
                filter === d ? 'bg-primary text-white' : 'text-inkmuted hover:text-ink'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-inkmuted">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="border border-dashed border-line rounded-card p-12 text-center text-inkmuted">
          No problems in this category yet.
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
                <span className={`text-xs font-mono px-2 py-1 rounded-full capitalize ${DIFFICULTY_STYLE[p.difficulty] || ''}`}>
                  {p.difficulty}
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
