import { useEffect, useState } from 'react';
import api from '../api/axios';

export default function StudentsPage() {
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
      <h1 className="font-display text-3xl font-semibold mb-8">Students</h1>

      {loading ? (
        <p className="text-inkmuted">Loading…</p>
      ) : students.length === 0 ? (
        <div className="border border-dashed border-line rounded-card p-12 text-center text-inkmuted">
          No registered students yet.
        </div>
      ) : (
        <div className="overflow-x-auto border border-line rounded-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink/5 text-left">
                <th className="p-3 font-medium">Full Name</th>
                <th className="p-3 font-medium">Email</th>
                <th className="p-3 font-medium">Submissions</th>
                <th className="p-3 font-medium">Problems Solved</th>
                <th className="p-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="p-3 font-medium">{s.name}</td>
                  <td className="p-3 font-mono text-xs text-inkmuted">{s.email}</td>
                  <td className="p-3 font-mono">{s.submission_count}</td>
                  <td className="p-3 font-mono">{s.solved_count}</td>
                  <td className="p-3 text-xs text-inkmuted font-mono">
                    {new Date(s.created_at).toLocaleDateString('en-US')}
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
