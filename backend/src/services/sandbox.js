/**
 * sandbox.js
 *
 * Decides *where* a submission's compile/run commands execute.
 *
 * Two backends:
 *   - docker: each command runs in a throwaway container with no network, a
 *     read-only root filesystem, a memory cap, a CPU share and a process-count
 *     limit. This is the real isolation boundary.
 *   - host:   the pre-0.0.4 behaviour - a child process on this machine,
 *     bounded only by a wall-clock timeout and a memory ulimit. Fine for a
 *     single-developer machine, not for untrusted users.
 *
 * The command strings themselves are unchanged between backends: the docker
 * backend takes the exact same `bash -c` command and runs it inside a
 * container instead of on the host, so compile/run semantics stay identical.
 */

const { spawn } = require('child_process');
const { config } = require('../config/env');
const logger = require('../logger');

const CONTAINER_WORKDIR = '/sandbox';

/**
 * Builds the `docker run` argument list for one command.
 *
 * Pure and exported so the security flags can be asserted in tests without a
 * Docker daemon - a missing --network=none must fail the build, not silently
 * ship an internet-connected sandbox.
 */
function buildDockerArgs({
  image,
  workDir,
  command,
  containerName,
  memoryMb,
  cpus,
  pidsLimit,
  tmpfsMb,
  uid,
  gid,
}) {
  return [
    'run',
    '--rm',
    '-i',
    '--name', containerName,
    // No network interface at all: submitted code cannot phone home, fetch a
    // payload, or reach other services on the host network.
    '--network=none',
    `--memory=${memoryMb}m`,
    // Without a swap cap equal to memory, the container can spill past the
    // memory limit into swap instead of being OOM-killed.
    `--memory-swap=${memoryMb}m`,
    `--cpus=${cpus}`,
    // Correctly namespaced process-count containment - this is what makes a
    // fork bomb a contained failure instead of a host-wide one. (ulimit -u,
    // deliberately avoided in the host backend, is per-user and cannot do this.)
    `--pids-limit=${pidsLimit}`,
    // Everything outside the mounted work directory is immutable.
    '--read-only',
    // Compilers need scratch space: gcc writes intermediates to /tmp and the
    // JVM wants a writable temp dir. noexec stops a payload being written and
    // then executed from there.
    `--tmpfs=/tmp:rw,noexec,nosuid,size=${tmpfsMb}m`,
    // Drop every capability and block privilege escalation via setuid binaries.
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--user', `${uid}:${gid}`,
    '-e', 'HOME=/tmp',
    '-v', `${workDir}:${CONTAINER_WORKDIR}:rw`,
    '-w', CONTAINER_WORKDIR,
    image,
    'bash',
    '-c',
    command,
  ];
}

function imageFor(language, prefix = config().SANDBOX_IMAGE_PREFIX) {
  return `${prefix}-${language}-sandbox`;
}

/**
 * Is a Docker daemon actually reachable?
 *
 * Cached after the first successful probe: this is called on every submission
 * and `docker info` is not free. A negative result is NOT cached, so starting
 * Docker after the server doesn't require a restart.
 */
let dockerAvailable = null;
function probeDocker() {
  return new Promise((resolve) => {
    const child = spawn('docker', ['info', '--format', '{{.ServerVersion}}'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(false);
    }, 5000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 && out.trim().length > 0);
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function isDockerAvailable() {
  if (dockerAvailable === true) return true;
  dockerAvailable = await probeDocker();
  return dockerAvailable;
}

/** Test seam: forget a cached probe result. */
function resetDockerProbe() {
  dockerAvailable = null;
}

/**
 * Chooses the backend for this run, or throws rather than quietly downgrading.
 *
 * SANDBOX_MODE=docker means docker is a requirement: if the daemon is gone we
 * fail the submission instead of running untrusted code unconfined. A grading
 * error is recoverable; a silent loss of isolation is not.
 */
async function resolveBackend(mode = config().SANDBOX_MODE) {
  if (mode === 'host') return 'host';
  const available = await isDockerAvailable();
  if (mode === 'docker') {
    if (!available) {
      throw new Error(
        'SANDBOX_MODE=docker but no Docker daemon is reachable. Refusing to execute submitted code without container isolation.'
      );
    }
    return 'docker';
  }
  // auto
  return available ? 'docker' : 'host';
}

module.exports = {
  buildDockerArgs,
  imageFor,
  isDockerAvailable,
  resetDockerProbe,
  resolveBackend,
  probeDocker,
  CONTAINER_WORKDIR,
};

// Kept out of the public surface above but useful for logging at startup.
module.exports._logBackendOnce = (() => {
  let logged = false;
  return (backend) => {
    if (logged) return;
    logged = true;
    if (backend === 'host') {
      logger.warn(
        'Running submissions WITHOUT container isolation (SANDBOX_MODE=host or no Docker daemon). Do not expose this to untrusted users.'
      );
    } else {
      logger.info('Submissions are isolated in per-run Docker containers');
    }
  };
})();
