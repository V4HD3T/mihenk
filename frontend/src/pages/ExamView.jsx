import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useI18n, useT } from '../i18n/index.jsx';
import { dateLocale } from '../i18n/format.js';

function StudentExamView({ examId }) {
  const t = useT();
  const { language } = useI18n();
  const [exam, setExam] = useState(null);
  const [problems, setProblems] = useState([]);
  const [myProgress, setMyProgress] = useState([]);
  // The server's answer for when *this* student's window closes - it includes
  // any extra time they've been granted, which exam.end_time does not.
  const [endsAt, setEndsAt] = useState(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    api.get(`/exams/${examId}`).then(({ data }) => {
      setExam(data.exam);
      setProblems(data.problems);
      setMyProgress(data.myProgress);
      setEndsAt(data.endsAt ? new Date(data.endsAt) : null);
    });
  }, [examId]);

  // Drives the countdown.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!exam) return <p className="text-inkmuted">{t('common.loading')}</p>;

  const deadline = endsAt || new Date(exam.end_time);
  const isActive = now >= new Date(exam.start_time) && now <= deadline;
  const hasExtraTime = endsAt && endsAt.getTime() > new Date(exam.end_time).getTime();
  const msLeft = deadline - now;

  const formatLeft = (ms) => {
    if (ms <= 0) return '0:00';
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
      : `${m}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold mb-2">{exam.title}</h1>
      <p className="text-inkmuted mb-1">{exam.description}</p>
      <p className="text-sm font-mono text-inkmuted mb-4">
        {t('exam.schedule', {
          start: new Date(exam.start_time).toLocaleString(dateLocale(language)),
          end: deadline.toLocaleString(dateLocale(language)),
          minutes: t('exam.minutes', { count: exam.duration_minutes }),
        })}
      </p>

      {isActive && (
        <div className="mb-6 inline-flex items-center gap-2 px-4 py-2 rounded-card border border-line bg-surface">
          <span className={`w-2 h-2 rounded-full ${msLeft < 5 * 60 * 1000 ? 'bg-error animate-pulse' : 'bg-primary'}`} />
          <span className="font-mono text-sm">{t('exam.timeLeft', { time: formatLeft(msLeft) })}</span>
          {hasExtraTime && <span className="text-xs text-inkmuted">{t('exam.includesExtraTime')}</span>}
        </div>
      )}

      {!isActive && (
        <div className="mb-6 text-sm px-4 py-2.5 rounded-card bg-warning-bg text-warning">
          {t('exam.notActive')}
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
                <p className="text-xs text-inkmuted font-mono">
                  {t('exam.problemMeta', {
                    difficulty: t(`teacher.difficultyValue.${p.difficulty}`),
                    points: p.points,
                  })}
                </p>
              </div>
              {progress ? (
                <span className="text-sm font-mono">
                  {progress.best_passed} / {progress.total_count}
                </span>
              ) : (
                <span className="text-sm text-inkmuted">{t('exam.notAttempted')}</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function IntegrityBadge({ summary }) {
  const t = useT();
  if (!summary) return <span className="text-inkmuted text-xs">—</span>;
  const fullscreens = Number(summary.fullscreen_exit_count || 0);
  const total = Number(summary.tab_hidden_count) + Number(summary.paste_count) + fullscreens;
  if (total === 0) return <span className="text-inkmuted text-xs">—</span>;
  const style = total >= 5 ? 'bg-error-bg text-error' : 'bg-warning-bg text-warning';
  return (
    <span
      className={`text-xs font-mono px-2 py-1 rounded-full whitespace-nowrap ${style}`}
      // The visible text is abbreviated to fit the column; the label spells
      // out what the numbers count.
      aria-label={t('exam.integrityLabel', {
        tabs: summary.tab_hidden_count,
        pastes: summary.paste_count,
        fullscreens,
      })}
    >
      {t('exam.integrityCounts', { tabs: summary.tab_hidden_count, pastes: summary.paste_count })}
      {fullscreens > 0 && t('exam.integrityFullscreen', { count: fullscreens })}
    </span>
  );
}

function TeacherExamResults({ examId }) {
  const t = useT();
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
      <h1 className="font-display text-3xl font-semibold mb-1">{t('exam.resultsTitle')}</h1>
      <p className="text-xs text-inkmuted mb-6">{t('exam.integrityNote')}</p>
      {results.length === 0 ? (
        <p className="text-inkmuted">{t('exam.noSubmissions')}</p>
      ) : (
        <div className="overflow-x-auto border border-line rounded-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink/5 text-left">
                <th className="p-3 font-medium">{t('exam.student')}</th>
                {problemTitles.map(([id, title]) => (
                  <th key={id} className="p-3 font-medium whitespace-nowrap">
                    {title}
                  </th>
                ))}
                <th className="p-3 font-medium">{t('exam.integrity')}</th>
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
