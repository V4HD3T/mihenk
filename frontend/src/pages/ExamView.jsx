import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import ResultBubbles from '../components/ResultBubbles';

function StudentExamView({ examId }) {
  const [exam, setExam] = useState(null);
  const [problems, setProblems] = useState([]);
  const [myProgress, setMyProgress] = useState([]);

  useEffect(() => {
    api.get(`/exams/${examId}`).then(({ data }) => {
      setExam(data.exam);
      setProblems(data.problems);
      setMyProgress(data.myProgress);
    });
  }, [examId]);

  if (!exam) return <p className="text-inkmuted">Loading…</p>;

  const now = new Date();
  const isActive = now >= new Date(exam.start_time) && now <= new Date(exam.end_time);

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold mb-2">{exam.title}</h1>
      <p className="text-inkmuted mb-1">{exam.description}</p>
      <p className="text-sm font-mono text-inkmuted mb-8">
        {new Date(exam.start_time).toLocaleString('en-US')} — {new Date(exam.end_time).toLocaleString('en-US')} ·{' '}
        {exam.duration_minutes} minutes
      </p>

      {!isActive && (
        <div className="mb-6 text-sm px-4 py-2.5 rounded-card bg-warning-bg text-warning">
          This exam is not currently active; submissions are not accepted.
        </div>
      )}

      <div className="space-y-3">
        {problems.map((p) => {
          const progress = myProgress.find((mp) => Number(mp.problem_id) === p.id);
          return (
            <Link
              key={p.id}
              to={`/problem/${p.id}?exam=${examId}`}
              className="flex items-center justify-between border border-line rounded-card p-4 bg-surface hover:border-primary transition-colors"
            >
              <div>
                <p className="font-medium">{p.title}</p>
                <p className="text-xs text-inkmuted font-mono capitalize">
                  {p.difficulty} · {p.points} points
                </p>
              </div>
              {progress ? (
                <span className="text-sm font-mono">
                  {progress.best_passed} / {progress.total_count}
                </span>
              ) : (
                <span className="text-sm text-inkmuted">Not attempted yet</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function IntegrityBadge({ summary }) {
  if (!summary) return <span className="text-inkmuted text-xs">—</span>;
  const total = Number(summary.tab_hidden_count) + Number(summary.paste_count);
  if (total === 0) return <span className="text-inkmuted text-xs">—</span>;
  const style = total >= 5 ? 'bg-error-bg text-error' : 'bg-warning-bg text-warning';
  return (
    <span className={`text-xs font-mono px-2 py-1 rounded-full whitespace-nowrap ${style}`}>
      ⚠ {summary.tab_hidden_count} tab · {summary.paste_count} paste
    </span>
  );
}

function TeacherExamResults({ examId }) {
  const [results, setResults] = useState([]);
  const [integrity, setIntegrity] = useState([]);

  useEffect(() => {
    api.get(`/exams/${examId}/results`).then(({ data }) => setResults(data.results));
    api.get(`/integrity/exam/${examId}`).then(({ data }) => setIntegrity(data.summary));
  }, [examId]);

  const students = [...new Map(results.map((r) => [r.user_id, r])).values()];
  const problemTitles = [...new Map(results.map((r) => [r.problem_id, r.problem_title])).entries()];
  const integrityByUser = new Map(integrity.map((i) => [i.user_id, i]));

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold mb-1">Exam Results</h1>
      <p className="text-xs text-inkmuted mb-6">
        The integrity column logs tab switches and pasted code during the exam window — a signal
        to review, not proof of misconduct on its own.
      </p>
      {results.length === 0 ? (
        <p className="text-inkmuted">No submissions yet.</p>
      ) : (
        <div className="overflow-x-auto border border-line rounded-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink/5 text-left">
                <th className="p-3 font-medium">Student</th>
                {problemTitles.map(([id, title]) => (
                  <th key={id} className="p-3 font-medium whitespace-nowrap">
                    {title}
                  </th>
                ))}
                <th className="p-3 font-medium">Integrity</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.user_id} className="border-t border-line">
                  <td className="p-3">
                    <div>{s.name}</div>
                    <div className="text-xs text-inkmuted font-mono">{s.email}</div>
                  </td>
                  {problemTitles.map(([pid]) => {
                    const r = results.find((row) => row.user_id === s.user_id && row.problem_id === pid);
                    return (
                      <td key={pid} className="p-3 font-mono">
                        {r ? `${r.best_passed} / ${r.total_count}` : '—'}
                      </td>
                    );
                  })}
                  <td className="p-3">
                    <IntegrityBadge summary={integrityByUser.get(s.user_id)} />
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

export default function ExamView() {
  const { id } = useParams();
  const { user } = useAuth();

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {user.role === 'teacher' ? <TeacherExamResults examId={id} /> : <StudentExamView examId={id} />}
    </div>
  );
}
