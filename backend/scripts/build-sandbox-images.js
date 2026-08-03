/**
 * build-sandbox-images.js
 *
 * Builds the per-language sandbox images the docker execution backend runs
 * submissions in:
 *
 *   npm run sandbox:build          # build all five
 *   npm run sandbox:build python   # build one
 *   npm run sandbox:check          # verify the images exist and their toolchains work
 *
 * Run this once on each machine that hosts a grading worker. Without these
 * images, SANDBOX_MODE=docker refuses to grade rather than running submitted
 * code unconfined.
 */

require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const { imageFor } = require('../src/services/sandbox');

const DOCKER_DIR = path.join(__dirname, '..', 'docker');

// Read this one setting directly rather than through the validated app config:
// building images is an ops task that shouldn't require a complete, valid
// server configuration (a JWT secret, database credentials) to be present.
const IMAGE_PREFIX = process.env.SANDBOX_IMAGE_PREFIX || 'codecloud';

// Command proving the language's toolchain is present and runnable as the
// unprivileged container user.
const TOOLCHAIN_CHECK = {
  python: 'python3 --version',
  cpp: 'g++ --version | head -1',
  java: 'javac -version 2>&1 | head -1',
  javascript: 'node --version',
  c: 'gcc --version | head -1',
};

const LANGUAGES = Object.keys(TOOLCHAIN_CHECK);

function run(file, args) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out: out.trim() }));
    child.on('error', (err) => resolve({ code: -1, out: err.message }));
  });
}

async function build(languages) {
  const prefix = IMAGE_PREFIX;
  let failed = 0;
  for (const language of languages) {
    const image = imageFor(language, prefix);
    process.stdout.write(`Building ${image} ... `);
    const { code, out } = await run('docker', [
      'build',
      '-q',
      '-f',
      path.join(DOCKER_DIR, `${language}.Dockerfile`),
      '-t',
      image,
      DOCKER_DIR,
    ]);
    if (code === 0) {
      console.log('ok');
    } else {
      failed++;
      console.log(`FAILED\n${out}`);
    }
  }
  return failed;
}

/**
 * Confirms each image not only exists but can actually compile/run as the
 * unprivileged user under the same security flags used for real submissions.
 */
async function check(languages) {
  const prefix = IMAGE_PREFIX;
  let failed = 0;
  for (const language of languages) {
    const image = imageFor(language, prefix);
    process.stdout.write(`Checking ${image} ... `);
    const { code, out } = await run('docker', [
      'run', '--rm',
      '--network=none',
      '--read-only',
      '--tmpfs=/tmp:rw,noexec,nosuid,size=16m',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--user', '10001:10001',
      '-e', 'HOME=/tmp',
      image,
      'bash', '-c', TOOLCHAIN_CHECK[language],
    ]);
    if (code === 0) {
      console.log(out.split('\n')[0]);
    } else {
      failed++;
      console.log(`FAILED\n${out}`);
    }
  }
  return failed;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--check') ? 'check' : 'build';
  const selected = args.filter((a) => !a.startsWith('--'));
  const languages = selected.length ? selected : LANGUAGES;

  for (const language of languages) {
    if (!LANGUAGES.includes(language)) {
      console.error(`Unknown language "${language}". Known: ${LANGUAGES.join(', ')}`);
      process.exit(1);
    }
  }

  const probe = await run('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (probe.code !== 0) {
    console.error('No Docker daemon is reachable - start Docker and try again.');
    process.exit(1);
  }

  const failed = mode === 'check' ? await check(languages) : await build(languages);
  if (failed) {
    console.error(`\n${failed} image(s) failed.`);
    process.exit(1);
  }
  console.log(`\n${languages.length} image(s) ${mode === 'check' ? 'verified' : 'built'}.`);
}

main();
