import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';

export default function SubmissionsView() {
  const { id } = useParams();
  const [submissions, setSubmissions] = useState([]);
  const [problemTitle, setProblemTitle] = useState('');

  useEffect(() => {
    api.get(`/submissions/problem/${id}`).then(({ data }) => setSubmissions(data.submissions));
    api.get(`/problems/${id}`).then(({ data }) => setProblemTitle(data.problem.title));
  }, [id]);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <Link to="/" className="text-sm text-primary hover:underline mb-4 inline-block">
        ← Back to dashboard
      </Link>
      <h1 className="font-display text-3xl font-semibold mb-6">{problemTitle} — Submissions</h1>

      {submissions.length === 0 ? (
        <p className="text-inkmuted">No submissions yet.</p>
      ) : (
        <div className="overflow-x-auto border border-line rounded-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink/5 text-left">
                <th className="p-3 font-medium">Student</th>
                <th className="p-3 font-medium">Language</th>
                <th className="p-3 font-medium">Result</th>
                <th className="p-3 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {submissions.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="p-3">
                    <div>{s.user_name}</div>
                    <div className="text-xs text-inkmuted font-mono">{s.user_email}</div>
                  </td>
                  <td className="p-3 font-mono uppercase text-xs">{s.language}</td>
                  <td className="p-3 font-mono">
                    <span className={s.passed_count === s.total_count ? 'text-success' : 'text-error'}>
                      {s.passed_count} / {s.total_count}
                    </span>
                  </td>
                  <td className="p-3 text-xs text-inkmuted font-mono">
                    {new Date(s.submitted_at).toLocaleString('en-US')}
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
