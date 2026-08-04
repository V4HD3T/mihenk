import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/axios';
import { useT } from '../i18n/index.jsx';

/** Confirms an address from an emailed link. */
export default function VerifyEmail() {
  const t = useT();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState(token ? 'working' : 'missing');
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    // The token is single-use, so React 18's double-invoked effects in
    // development would otherwise spend it on the first call and report the
    // second as invalid.
    attempted.current = true;

    api
      .post('/auth/verify-email', { token })
      .then(() => setState('done'))
      .catch(() => setState('failed'));
  }, [token]);

  const body = {
    missing: { role: 'alert', text: t('auth.missingToken') },
    working: { role: 'status', text: t('auth.verifying') },
    done: { role: 'status', text: t('auth.verified') },
    failed: { role: 'alert', text: t('auth.verifyFailed') },
  }[state];

  return (
    <main className="min-h-screen flex items-center justify-center p-8 bg-paper">
      <div className="w-full max-w-sm text-center">
        <h1 className="font-display text-2xl font-semibold mb-6">{t('auth.verifyTitle')}</h1>
        <p
          role={body.role}
          className={`text-sm px-4 py-3 rounded-card ${
            state === 'failed' || state === 'missing'
              ? 'text-error bg-error-bg'
              : 'bg-surface border border-line'
          }`}
        >
          {body.text}
        </p>
        <p className="text-sm text-inkmuted mt-6">
          <Link to="/login" className="text-primary font-medium hover:underline">
            {t('auth.backToSignIn')}
          </Link>
        </p>
      </div>
    </main>
  );
}
