/**
 * Frontend test environment.
 *
 * These run in jsdom against the real components - no mocked React, no shallow
 * rendering. Only the network is stubbed, because that is the boundary; the
 * behaviour being tested is what a user sees and does.
 */

import '@testing-library/jest-dom/vitest';
import { expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

expect.extend(axeMatchers);
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
});

// jsdom implements neither of these, and the exam page uses both.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
}
if (!document.fullscreenElement) {
  Object.defineProperty(document, 'fullscreenElement', { value: null, writable: true });
}

// Monaco pulls in web workers and a canvas; neither exists here and neither is
// what these tests are about. The editor is replaced with a plain textarea that
// keeps the same contract: a value, an onChange, and paste events.
vi.mock('../src/components/CodeEditor', () => ({
  default: ({ value, onChange, onPaste }) => (
    <textarea
      aria-label="Code editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      onPaste={(e) => onPaste?.(e.clipboardData?.getData('text')?.length ?? 0)}
    />
  ),
}));

// Recharts measures its container, which jsdom reports as 0x0, so charts render
// nothing and warn. Give it a size.
window.ResizeObserver =
  window.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
