/**
 * Sign-up and sign-in.
 *
 * The registration form carries a rule that matters: since v0.0.3 the client
 * cannot choose its own role. A test here would have caught the original bug,
 * where a role selector sent `role: 'teacher'` and the server believed it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, stubRoutes, fails } from './helpers.jsx';
import { makeApiMock } from './apiMock.js';
import Register from '../src/pages/Register';
import Login from '../src/pages/Login';

const api = vi.hoisted(() => {
  // eslint-disable-next-line no-undef
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
});
vi.mock('../src/api/axios', () => ({ default: api }));

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

const stub = (routes) => stubRoutes(api, routes);

describe('registration', () => {
  it('never sends a role - the server decides it', async () => {
    stub({
      'GET /auth/registration-options': { teacherRegistrationEnabled: false },
      'POST /auth/register': { user: { id: 1, role: 'student' }, token: 't' },
    });
    renderApp(<Register />);

    await userEvent.type(screen.getByLabelText(/full name/i), 'Ada');
    await userEvent.type(screen.getByLabelText(/^email$/i), 'ada@x.edu');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const [, body] = api.post.mock.calls.find(([url]) => url.includes('/auth/register'));
    expect(body).not.toHaveProperty('role');
    expect(body.email).toBe('ada@x.edu');
  });

  it('hides the invite field when the server does not accept one', async () => {
    stub({ 'GET /auth/registration-options': { teacherRegistrationEnabled: false } });
    renderApp(<Register />);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByLabelText(/invite code/i)).not.toBeInTheDocument();
  });

  it('offers the invite field when the server does accept one', async () => {
    stub({ 'GET /auth/registration-options': { teacherRegistrationEnabled: true } });
    renderApp(<Register />);
    expect(await screen.findByLabelText(/invite code/i)).toBeInTheDocument();
  });

  it('sends the invite code when one is typed', async () => {
    stub({
      'GET /auth/registration-options': { teacherRegistrationEnabled: true },
      'POST /auth/register': { user: { id: 1, role: 'teacher' }, token: 't' },
    });
    renderApp(<Register />);

    await userEvent.type(screen.getByLabelText(/full name/i), 'Grace');
    await userEvent.type(screen.getByLabelText(/^email$/i), 'grace@x.edu');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password123');
    await userEvent.type(await screen.findByLabelText(/invite code/i), 'SECRET');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    await waitFor(() => {
      const call = api.post.mock.calls.find(([url]) => url.includes('/auth/register'));
      expect(call[1].inviteCode).toBe('SECRET');
    });
  });

  it('shows the server error rather than failing silently', async () => {
    stub({
      'GET /auth/registration-options': { teacherRegistrationEnabled: false },
      'POST /auth/register': fails(409, { error: 'This email address is already registered' }),
    });
    renderApp(<Register />);

    await userEvent.type(screen.getByLabelText(/full name/i), 'Ada');
    await userEvent.type(screen.getByLabelText(/^email$/i), 'taken@x.edu');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /create account/i }));

    expect(await screen.findByText(/already registered/i)).toBeInTheDocument();
  });
});

describe('login', () => {
  it('stores the session so a reload stays signed in', async () => {
    stub({
      'POST /auth/login': {
        user: { id: 7, name: 'Ada', email: 'ada@x.edu', role: 'student' },
        token: 'jwt-token',
      },
    });
    renderApp(<Login />);

    await userEvent.type(screen.getByLabelText(/email/i), 'ada@x.edu');
    await userEvent.type(screen.getByLabelText(/password/i), 'password123');
    await userEvent.click(screen.getByRole('button', { name: /log in|sign in/i }));

    await waitFor(() => expect(localStorage.getItem('codecloud_token')).toBe('jwt-token'));
    expect(JSON.parse(localStorage.getItem('codecloud_user')).name).toBe('Ada');
  });

  it('does not store anything when the credentials are wrong', async () => {
    stub({ 'POST /auth/login': fails(401, { error: 'Invalid email or password' }) });
    renderApp(<Login />);

    await userEvent.type(screen.getByLabelText(/email/i), 'ada@x.edu');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /log in|sign in/i }));

    expect(await screen.findByText(/invalid email or password/i)).toBeInTheDocument();
    expect(localStorage.getItem('codecloud_token')).toBeNull();
  });
});
