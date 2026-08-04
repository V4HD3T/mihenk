/**
 * The shape of the axios instance the app imports.
 *
 * Built by vi.hoisted() in each test file, because a vi.mock factory runs
 * before anything else in the module and cannot close over a normal const.
 */
import { vi } from 'vitest';

export function makeApiMock() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
  };
}
