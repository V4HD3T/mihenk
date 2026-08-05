import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useI18n, useT } from '../i18n/index.jsx';
import { dateLocale } from '../i18n/format.js';

export default function StudentsPage() {
  const t = useT();
  const { language } = useI18n();
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/users/students')
      .then(({ data }) => setStudents(data.students))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <h1 className="font-display text-3xl font-semibold mb-8">{t('students.title')}</h1>

      {loading ? (
        <p className="text-inkmuted">{t('common.loading')}</p>
      ) : students.length === 0 ? (
        <div className="border border-dashed border-line rounded-card p-12 text-center text-inkmuted">
          {t('students.empty')}
        </div>
      ) : (
        <div className="overflow-x-auto border border-line rounded-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink/5 text-left">
                <th className="p-3 font-medium">{t('students.fullName')}</th>
                <th className="p-3 font-medium">{t('students.email')}</th>
                <th className="p-3 font-medium">{t('students.submissions')}</th>
                <th className="p-3 font-medium">{t('students.solved')}</th>
                <th className="p-3 font-medium">{t('students.joined')}</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="p-3 font-medium">
                    <Link to={`/students/${s.id}`} className="hover:text-primary transition-colors">
                      {s.name}
                    </Link>
                  </td>
                  <td className="p-3 font-mono text-xs text-inkmuted">{s.email}</td>
                  <td className="p-3 font-mono">{s.submission_count}</td>
                  <td className="p-3 font-mono">{s.solved_count}</td>
                  <td className="p-3 text-xs text-inkmuted font-mono">
                    {new Date(s.created_at).toLocaleDateString(dateLocale(language))}
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
