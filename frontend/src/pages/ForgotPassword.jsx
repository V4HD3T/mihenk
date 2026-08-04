import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';
import { useT } from '../i18n/index.jsx';

/**
 * Asking for a reset link.
 *
 * The success message is deliberately the same whether or not the address has
 * an account - the server answers identically, and saying otherwise here would
 * undo that by leaking the answer in the interface instead.
 */
export default function ForgotPassword() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSending(true);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setMessage(data.message);
    } catch {
      // Even a failure gets the same answer, for the same reason.
      setMessage(t('auth.forgotSent'));
    } finally {
      setSending(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-paper">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl font-semibold mb-1">{t('auth.forgotTitle')}</h1>
        <p className="text-inkmuted text-sm mb-8">{t('auth.forgotSubtitle')}</p>

        {message ? (
          <div
            role="status"
            className="text-sm bg-surface border border-line px-4 py-3 rounded-card"
          >
            {message}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="forgot-email" className="block text-sm font-medium mb-1.5">
                {t('auth.email')}
              </label>
              <input
                id="forgot-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-card border border-line bg-surface focus:border-primary outline-none transition-colors"
                placeholder={t('auth.emailPlaceholder')}
              />
            </div>
            <button
              type="submit"
              disabled={sending}
              className="w-full py-2.5 rounded-card bg-primary text-white font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
            >
              {sending ? t('auth.sending') : t('auth.sendResetLink')}
            </button>
          </form>
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
