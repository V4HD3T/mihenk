import { describe, it, expect, beforeEach } from 'vitest';
import sandboxModule from '../src/services/sandbox.js';

const { buildDockerArgs, imageFor, resolveBackend, resetDockerProbe } = sandboxModule;

const baseArgs = {
  image: 'codecloud-python-sandbox',
  workDir: '/tmp/codecloud-exec/abc',
  command: 'python3 main.py',
  containerName: 'codecloud-run-1',
  memoryMb: 256,
  cpus: 0.5,
  pidsLimit: 64,
  tmpfsMb: 16,
  uid: 10001,
  gid: 10001,
};

describe('docker sandbox flags', () => {
  const args = buildDockerArgs(baseArgs);
  const joined = args.join(' ');

  // These assertions are the reason this file exists: CI has no Docker daemon,
  // so it cannot observe the isolation directly. Losing any one of these flags
  // silently weakens the sandbox, so each one is pinned here.
  it('disables networking entirely', () => {
    expect(args).toContain('--network=none');
  });

  it('caps memory and forbids escaping the cap through swap', () => {
    expect(args).toContain('--memory=256m');
    expect(args).toContain('--memory-swap=256m');
  });

  it('limits process count, which is what contains a fork bomb', () => {
    expect(args).toContain('--pids-limit=64');
  });

  it('mounts the root filesystem read-only with a noexec scratch dir', () => {
    expect(args).toContain('--read-only');
    expect(joined).toContain('--tmpfs=/tmp:rw,noexec,nosuid,size=16m');
  });

  it('drops all capabilities and blocks privilege escalation', () => {
    expect(args).toContain('--cap-drop=ALL');
    expect(args).toContain('--security-opt=no-new-privileges');
  });

  it('runs as an unprivileged uid, never root', () => {
    const idx = args.indexOf('--user');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('10001:10001');
    expect(args[idx + 1]).not.toMatch(/^0:/);
  });

  it('removes the container afterwards and names it so it can be killed', () => {
    expect(args).toContain('--rm');
    const idx = args.indexOf('--name');
    expect(args[idx + 1]).toBe('codecloud-run-1');
  });

  it('mounts only the run directory, at a fixed path', () => {
    const idx = args.indexOf('-v');
    expect(args[idx + 1]).toBe('/tmp/codecloud-exec/abc:/sandbox:rw');
    // Exactly one bind mount - nothing else from the host is exposed.
    expect(args.filter((a) => a === '-v')).toHaveLength(1);
  });

  it('passes the command through unchanged so both backends run the same thing', () => {
    expect(args.slice(-3)).toEqual(['bash', '-c', 'python3 main.py']);
  });

  it('gives java a bigger allowance without changing the other flags', () => {
    const java = buildDockerArgs({ ...baseArgs, memoryMb: 384, image: imageFor('java') });
    expect(java).toContain('--memory=384m');
    expect(java).toContain('--network=none');
    expect(java).toContain('codecloud-java-sandbox');
  });
});

describe('image naming', () => {
  it('derives the image from the language', () => {
    expect(imageFor('python', 'codecloud')).toBe('codecloud-python-sandbox');
    expect(imageFor('cpp', 'myorg')).toBe('myorg-cpp-sandbox');
  });
});

describe('backend selection', () => {
  beforeEach(() => resetDockerProbe());

  it('uses the host backend when explicitly asked', async () => {
    await expect(resolveBackend('host')).resolves.toBe('host');
  });

  it('refuses to run rather than silently downgrading when docker is required', async () => {
    // Point the CLI at a socket that cannot exist.
    const previous = process.env.DOCKER_HOST;
    process.env.DOCKER_HOST = 'unix:///nonexistent/codecloud-test.sock';
    try {
      await expect(resolveBackend('docker')).rejects.toThrow(/Refusing to execute/i);
    } finally {
      if (previous === undefined) delete process.env.DOCKER_HOST;
      else process.env.DOCKER_HOST = previous;
      resetDockerProbe();
    }
  });
});
