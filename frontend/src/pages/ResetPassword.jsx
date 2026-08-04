import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/axios';
import { useT } from '../i18n/index.jsx';

/** Choosing a new password from an emailed link. */
export default function ResetPassword() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    // Caught here rather than server-side: the server only ever receives one
    // password, so the mismatch is a client-side concern by construction.
    if (password !== confirm) {
      setError(t('auth.passwordsDiffer'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.error || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-paper">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl font-semibold mb-1">{t('auth.resetTitle')}</h1>
        <p className="text-inkmuted text-sm mb-8">{t('auth.resetSubtitle')}</p>

        {!token && (
          <div role="alert" className="text-sm text-error bg-error-bg px-4 py-3 rounded-card">
            {t('auth.missingToken')}
          </div>
        )}

        {done ? (
          <div role="status" className="text-sm bg-surface border border-line px-4 py-3 rounded-card">
            {t('auth.passwordChanged')}
          </div>
        ) : (
          token && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="reset-password" className="block text-sm font-medium mb-1.5">
                  {t('auth.newPassword')}
                </label>
                <input
                  id="reset-password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-card border border-line bg-surface focus:border-primary outline-none transition-colors"
                  placeholder={t('auth.passwordPlaceholder')}
                />
              </div>
              <div>
                <label htmlFor="reset-confirm" className="block text-sm font-medium mb-1.5">
                  {t('auth.confirmPassword')}
                </label>
                <input
                  id="reset-confirm"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-card border border-line bg-surface focus:border-primary outline-none transition-colors"
                />
              </div>

              {error && (
                <div role="alert" className="text-sm text-error bg-error-bg px-4 py-2.5 rounded-card">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={saving}
                className="w-full py-2.5 rounded-card bg-primary text-white font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
              >
                {saving ? t('auth.sending') : t('auth.setPassword')}
              </button>
            </form>
          )
        )}

        <p className="text-sm text-inkmuted mt-6">
          <Link to="/login" className="text-primary font-medium hover:underline">
            {t('auth.backToSignIn')}
          </Link>
        </p>
      </div>
    </main>
  );
}
