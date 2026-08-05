import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useI18n, useT } from '../i18n/index.jsx';
import { dateLocale } from '../i18n/format.js';

const CHART_COLORS = ['#2B3A67', '#1F8A5F', '#C9862C', '#C1443D'];

function StatCard({ label, value }) {
  return (
    <div className="border border-line rounded-card p-5 bg-surface">
      <p className="text-xs text-inkmuted uppercase tracking-wide mb-1">{label}</p>
      <p className="font-display text-3xl font-semibold">{value}</p>
    </div>
  );
}

function TeacherAnalytics() {
  const t = useT();
  const { language } = useI18n();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/analytics/overview').then(({ data }) => setData(data));
  }, []);

  if (!data) return <p className="text-inkmuted">{t('common.loading')}</p>;

  const { totals, dailySubmissions, languageDistribution, problemSuccessRates } = data;

  return (
    <div className="space-y-8">
      <div className="grid sm:grid-cols-4 gap-4">
        <StatCard label={t('analytics.problems')} value={totals.problem_count} />
        <StatCard label={t('analytics.exams')} value={totals.exam_count} />
        <StatCard label={t('analytics.activeStudents')} value={totals.active_students} />
        <StatCard label={t('analytics.totalSubmissions')} value={totals.submission_count} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="border border-line rounded-card p-5 bg-surface">
          <h3 className="font-display text-lg font-medium mb-4">{t('analytics.last14Submissions')}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={dailySubmissions}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DEE1E6" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d) => new Date(d).getDate()} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip labelFormatter={(d) => new Date(d).toLocaleDateString(dateLocale(language))} />
              <Line type="monotone" dataKey="count" stroke="#2B3A67" strokeWidth={2} name={t('analytics.seriesSubmissions')} />
              <Line type="monotone" dataKey="passed_count" stroke="#1F8A5F" strokeWidth={2} name={t('analytics.seriesPassed')} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-line rounded-card p-5 bg-surface">
          <h3 className="font-display text-lg font-medium mb-4">{t('analytics.languageDistribution')}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={languageDistribution} dataKey="count" nameKey="language" outerRadius={80} label>
                {languageDistribution.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="border border-line rounded-card p-5 bg-surface">
        <h3 className="font-display text-lg font-medium mb-4">{t('analytics.attemptsSolves')}</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={problemSuccessRates} layout="vertical" margin={{ left: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#DEE1E6" />
            <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="title" width={140} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="attempt_count" fill="#DEE1E6" name={t('analytics.seriesAttempts')} />
            <Bar dataKey="solved_count" fill="#1F8A5F" name={t('analytics.seriesSolved')} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function StudentAnalytics() {
  const t = useT();
  const { language } = useI18n();
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get('/analytics/me').then(({ data }) => setData(data));
  }, []);

  if (!data) return <p className="text-inkmuted">{t('common.loading')}</p>;

  const { totals, dailyActivity, languageBreakdown, totalProblems } = data;

  return (
    <div className="space-y-8">
      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label={t('analytics.problemsSolved')} value={`${totals.solved_count} / ${totalProblems}`} />
        <StatCard label={t('analytics.problemsAttempted')} value={totals.attempted_count} />
        <StatCard label={t('analytics.totalSubmissions')} value={totals.submission_count} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="border border-line rounded-card p-5 bg-surface">
          <h3 className="font-display text-lg font-medium mb-4">{t('analytics.last14Activity')}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={dailyActivity}>
              <CartesianGrid strokeDasharray="3 3" stroke="#DEE1E6" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(d) => new Date(d).getDate()} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip labelFormatter={(d) => new Date(d).toLocaleDateString(dateLocale(language))} />
              <Line type="monotone" dataKey="count" stroke="#2B3A67" strokeWidth={2} name={t('analytics.seriesSubmissions')} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="border border-line rounded-card p-5 bg-surface">
          <h3 className="font-display text-lg font-medium mb-4">{t('analytics.myLanguageUsage')}</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={languageBreakdown} dataKey="count" nameKey="language" outerRadius={80} label>
                {languageBreakdown.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default function Analytics() {
  const t = useT();
  const { user } = useAuth();
  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <h1 className="font-display text-3xl font-semibold mb-8">
        {user.role === 'teacher' ? t('analytics.teacherTitle') : t('analytics.studentTitle')}
      </h1>
      {user.role === 'teacher' ? <TeacherAnalytics /> : <StudentAnalytics />}
    </div>
  );
}
