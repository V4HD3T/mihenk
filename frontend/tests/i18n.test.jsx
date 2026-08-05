/**
 * Language switching and the recovery pages.
 *
 * The catalogue test is the one that earns its keep: two translation files
 * drift apart the moment someone adds a string to one and forgets the other,
 * and the result is English text appearing mid-sentence in a Turkish interface.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { renderApp, stubRoutes, signIn } from './helpers.jsx';
import en from '../src/i18n/en.json';
import tr from '../src/i18n/tr.json';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
}));
vi.mock('../src/api/axios', () => ({ default: api }));

const { default: Navbar } = await import('../src/components/Navbar');
const { default: ForgotPassword } = await import('../src/pages/ForgotPassword');
const { default: ResetPassword } = await import('../src/pages/ResetPassword');
const { default: VerifyEmail } = await import('../src/pages/VerifyEmail');

const stub = (routes) => stubRoutes(api, routes);

beforeEach(() => {
  for (const fn of [api.get, api.post, api.put, api.delete]) fn.mockReset();
});

/** Every leaf key in a catalogue, as dotted paths. */
function keysOf(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  );
}

describe('translation catalogues', () => {
  it('English and Turkish define exactly the same keys', () => {
    const enKeys = keysOf(en).sort();
    const trKeys = keysOf(tr).sort();
    expect(trKeys.filter((k) => !enKeys.includes(k))).toEqual([]); // extra in Turkish
    expect(enKeys.filter((k) => !trKeys.includes(k))).toEqual([]); // missing from Turkish
  });

  it('no Turkish string is left as the English original', () => {
    // A handful legitimately match - the product name, the names of
    // programming languages, and strings that are only punctuation and
    // placeholders. Everything else being identical means it was never
    // translated.
    const allowed = new Set([
      'app.name',
      'nav.brand',
      'languages.python',
      'languages.java',
      'languages.javascript',
      'exam.schedule',
    ]);
    const identical = keysOf(en).filter((key) => {
      const read = (o) => key.split('.').reduce((n, p) => n?.[p], o);
      const e = read(en);
      const t = read(tr);
      return !allowed.has(key) && e === t && /[a-zA-Z]{4,}/.test(e);
    });
    expect(identical).toEqual([]);
  });

  it('placeholders survive translation', () => {
    // A dropped {count} renders as literal text where a number should be.
    for (const key of keysOf(en)) {
      const read = (o) => key.split('.').reduce((n, p) => n?.[p], o);
      const placeholders = (s) => (String(s).match(/\{(\w+)\}/g) || []).sort();
      expect(placeholders(read(tr)), `placeholders differ in ${key}`).toEqual(
        placeholders(read(en))
      );
    }
  });
});

describe('language switching', () => {
  it('starts in English and switches the interface to Turkish', async () => {
    signIn({ role: 'student' });
    localStorage.setItem('codecloud_language', 'en');
    renderApp(<Navbar />);

    expect(screen.getByText('Problems')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/language/i), 'tr');

    expect(await screen.findByText('Sorular')).toBeInTheDocument();
    expect(screen.queryByText('Problems')).not.toBeInTheDocument();
  });

  it('remembers the choice for the next visit', async () => {
    signIn({ role: 'student' });
    localStorage.setItem('codecloud_language', 'en');
    renderApp(<Navbar />);

    await userEvent.selectOptions(screen.getByLabelText(/language/i), 'tr');
    expect(localStorage.getItem('codecloud_language')).toBe('tr');
  });

  it('sets the document language, which assistive technology reads', async () => {
    signIn({ role: 'student' });
    renderApp(<Navbar />);
    await userEvent.selectOptions(screen.getByLabelText(/language/i), 'tr');
    expect(document.documentElement.lang).toBe('tr');
  });
});

describe('password recovery pages', () => {
  it('asks for an address and shows the server message', async () => {
    stub({
      'POST /auth/forgot-password': { message: 'If that address has an account, a reset link is on its way.' },
    });
    renderApp(<ForgotPassword />);

    await userEvent.type(screen.getByLabelText(/email/i), 'ada@x.edu');
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(/reset link is on its way/i);
  });

  it('refuses to submit two different passwords', async () => {
    stub({});
    renderApp(<ResetPassword />, { route: '/reset-password?token=abc' });

    await userEvent.type(screen.getByLabelText(/new password/i), 'password123');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'password124');
    await userEvent.click(screen.getByRole('button', { name: /save new password/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/don't match/i);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('sends the token from the link', async () => {
    stub({ 'POST /auth/reset-password': { success: true } });
    renderApp(<ResetPassword />, { route: '/reset-password?token=the-token' });

    await userEvent.type(screen.getByLabelText(/new password/i), 'password123');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /save new password/i }));

    await waitFor(() => {
      const call = api.post.mock.calls.find(([url]) => url.includes('/auth/reset-password'));
      expect(call[1]).toEqual({ token: 'the-token', password: 'password123' });
    });
    expect(await screen.findByRole('status')).toHaveTextContent(/password has been changed/i);
  });

  it('explains a link that arrived without a token', async () => {
    stub({});
    renderApp(<ResetPassword />, { route: '/reset-password' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/missing its token/i);
  });

  it('confirms an address exactly once', async () => {
    stub({ 'POST /auth/verify-email': { success: true } });
    renderApp(<VerifyEmail />, { route: '/verify-email?token=abc' });

    expect(await screen.findByRole('status')).toHaveTextContent(/confirmed/i);
    // The token is single-use, so a double-invoked effect must not spend it twice.
    expect(api.post.mock.calls.filter(([url]) => url.includes('/verify-email'))).toHaveLength(1);
  });

  it('reports a dead confirmation link', async () => {
    stub({ 'POST /auth/verify-email': { __reject: true, status: 400 } });
    renderApp(<VerifyEmail />, { route: '/verify-email?token=stale' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or has expired/i);
  });
});

describe('accessibility of the new pages', () => {
  it('forgot password', async () => {
    stub({});
    const { container } = renderApp(<ForgotPassword />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('reset password', async () => {
    stub({});
    const { container } = renderApp(<ResetPassword />, { route: '/reset-password?token=abc' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
