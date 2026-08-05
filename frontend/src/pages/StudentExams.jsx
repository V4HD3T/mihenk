import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useI18n, useT } from '../i18n/index.jsx';
import { dateLocale } from '../i18n/format.js';

function examStatus(exam) {
  const now = new Date();
  const start = new Date(exam.start_time);
  const end = new Date(exam.end_time);
  if (now < start) return { key: 'upcoming', style: 'bg-warning-bg text-warning' };
  if (now > end) return { key: 'ended', style: 'bg-ink/10 text-inkmuted' };
  return { key: 'active', style: 'bg-success-bg text-success' };
}

export default function StudentExams() {
  const t = useT();
  const { language } = useI18n();
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/exams')
      .then(({ data }) => setExams(data.exams))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <h1 className="font-display text-3xl font-semibold mb-8">{t('studentExams.title')}</h1>

      {loading ? (
        <p className="text-inkmuted">{t('common.loading')}</p>
      ) : exams.length === 0 ? (
        <div className="border border-dashed border-line rounded-card p-12 text-center text-inkmuted">
          {t('studentExams.empty')}
        </div>
      ) : (
        <div className="space-y-3">
          {exams.map((exam) => {
            const status = examStatus(exam);
            return (
              <Link
                key={exam.id}
                to={`/exam/${exam.id}`}
                className="block border border-line rounded-card p-5 bg-surface hover:border-primary transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-display text-lg font-medium">{exam.title}</h3>
                  <span className={`text-xs font-mono px-2 py-1 rounded-full ${status.style}`}>{t(`studentExams.${status.key}`)}</span>
                </div>
                <p className="text-sm text-inkmuted">
                  {t('studentExams.meta', {
                    problems: exam.problem_count,
                    minutes: t('exam.minutes', { count: exam.duration_minutes }),
                    start: new Date(exam.start_time).toLocaleString(dateLocale(language)),
                  })}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
