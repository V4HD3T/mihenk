/**
 * Shared test helpers.
 *
 * `renderApp` mounts a component inside the same providers it has in the real
 * app - the router and the auth context - so tests exercise the component as it
 * actually runs rather than an artificially isolated version of it.
 */

import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../src/context/AuthContext';
import { I18nProvider } from '../src/i18n/index.jsx';
import { vi } from 'vitest';

/**
 * @param {JSX.Element} ui
 * @param {object} [options]
 * @param {string} [options.route] the URL to start at
 * @param {string} [options.path]  the route pattern, when the component reads
 *   params with useParams - a MemoryRouter alone does not populate them, so a
 *   component rendered without its pattern sees `undefined` for every param.
 */
export function renderApp(ui, { route = '/', path } = {}) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <I18nProvider>
        <AuthProvider>
          {path ? (
            <Routes>
              <Route path={path} element={ui} />
            </Routes>
          ) : (
            ui
          )}
        </AuthProvider>
      </I18nProvider>
    </MemoryRouter>
  );
}

/** Puts a logged-in user in localStorage, the way the app stores one. */
export function signIn({ role = 'student', name = 'Test User', id = 1 } = {}) {
  localStorage.setItem('codecloud_token', 'test-token');
  localStorage.setItem(
    'codecloud_user',
    JSON.stringify({ id, name, email: 'test@x.edu', role })
  );
}

/**
 * Points a mocked axios instance at a table of routes.
 *
 * The mock object itself has to be created with vi.hoisted() in each test file,
 * because vi.mock factories are hoisted above every other statement. This
 * function just installs behaviour onto it:
 *
 *   const api = vi.hoisted(() => makeApiMock());
 *   vi.mock('../src/api/axios', () => ({ default: api }));
 *   stubRoutes(api, { 'GET /courses': { courses: [] } });
 *
 * Routes match by method plus a substring of the URL, so a test only describes
 * the calls it cares about.
 */
export function stubRoutes(api, routes = {}) {
  const match = (method, url) => {
    const key = Object.keys(routes).find((k) => {
      const [m, path] = k.split(' ');
      return m.toUpperCase() === method.toUpperCase() && url.includes(path);
    });
    return key ? routes[key] : undefined;
  };

  const respond = (method) => async (url, body) => {
    const handler = match(method, url);
    if (handler === undefined) {
      // Fail loudly here, rather than as an undefined destructure ten frames away.
      throw new Error(`No mock for ${method} ${url}`);
    }
    const value = typeof handler === 'function' ? await handler(body, url) : handler;
    if (value?.__reject) {
      const err = new Error('request failed');
      err.response = { status: value.status ?? 400, data: value.data ?? {} };
      throw err;
    }
    return { data: value };
  };

  api.get.mockImplementation(respond('GET'));
  api.post.mockImplementation(respond('POST'));
  api.put.mockImplementation(respond('PUT'));
  api.delete.mockImplementation(respond('DELETE'));
  return api;
}

/** Shorthand for a mocked call that should fail. */
export const fails = (status, data) => ({ __reject: true, status, data });
