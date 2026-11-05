// tests/liamtv-a11y-driver-honours-target.test.mjs
// LIA-37: the a11y driver must FAIL LOUDLY when it cannot honour the target
// it was asked to test, and must pin the ref under test.
//
// The bug this locks down: an older checkout of the driver IGNORED BASE_URL,
// served LOCAL files, and printed a green "all passed" summary while claiming
// it was testing a deployed surface. That produced a false "all green against
// production" that contradicted the deployed bytes.
//
// Contract asserted here:
//   (a) deployed mode + supported driver version + reachable URL  -> ok
//   (b) deployed mode + UNSUPPORTED driver version                 -> error
//   (c) deployed mode + reachable-but-erroring URL (HTTP 500)      -> error
//   (d) local mode (no BASE_URL)                                   -> local, ok
//   (e) the driver itself declares a driver version that supports
//       deployed mode, and wires the resolver into main()
//   (f) end-to-end: the driver exits non-zero on an unreachable BASE_URL
//       and does NOT report a passing summary

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  resolveTarget,
  resolveGitRef,
  normalizeBaseUrl,
  scriptSupportsDeployedMode,
  MIN_DEPLOYED_MODE_DRIVER_VERSION,
} from '../scripts/liamtv-a11y-target.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DRIVER = path.join(REPO_ROOT, 'scripts', 'liamtv-a11y-keyboard-check.mjs');

/** Stub git runner: returns a fixed sha/branch pair. */
function stubGit(sha = 'abc123def456abc123def456abc123def456abcd', branch = 'fix/lia-37-driver-harden') {
  return async (args) => {
    if (args.includes('--abbrev-ref')) return branch + '\n';
    return sha + '\n';
  };
}

/** Stub fetch returning a fixed HTTP status. */
function stubFetch(status) {
  return async () => ({ status });
}

describe('LIA-37: a11y driver target resolution', () => {
  it('(a) deployed mode with a supported driver version and a reachable URL resolves ok', async () => {
    const t = await resolveTarget({
      baseUrl: 'https://liamtv.example.com',
      driverVersion: MIN_DEPLOYED_MODE_DRIVER_VERSION,
      gitExec: stubGit(),
      fetchImpl: stubFetch(200),
    });
    assert.equal(t.ok, true);
    assert.equal(t.error, null);
    assert.equal(t.mode, 'deployed');
    assert.equal(t.requestedMode, 'deployed');
    assert.equal(t.baseUrl, 'https://liamtv.example.com');
    assert.equal(t.ref, 'abc123def456abc123def456abc123def456abcd');
    assert.equal(t.branch, 'fix/lia-37-driver-harden');
    assert.equal(t.driverVersion, MIN_DEPLOYED_MODE_DRIVER_VERSION);
    assert.equal(t.status, 200);
  });

  it('(b) deployed mode with an UNSUPPORTED driver version errors instead of falling back to local', async () => {
    const t = await resolveTarget({
      baseUrl: 'https://liamtv.example.com',
      driverVersion: 1,
      minDriverVersion: MIN_DEPLOYED_MODE_DRIVER_VERSION,
      gitExec: stubGit(),
      fetchImpl: stubFetch(200),
    });
    assert.equal(t.ok, false);
    assert.equal(t.mode, 'unsupported');
    assert.notEqual(t.mode, 'local', 'must NOT silently fall back to the local checkout');
    assert.match(t.error, /BASE_URL/);
    assert.match(t.error, /https:\/\/liamtv\.example\.com/);
    assert.match(t.error, /version/i);
    assert.match(t.error, /abc123def456abc123def456abc123def456abcd/);
    // The URL must never be silently swapped for a local one.
    assert.equal(t.baseUrl, 'https://liamtv.example.com');
  });

  it('(c) deployed mode whose target responds with HTTP 500 errors rather than passing', async () => {
    const t = await resolveTarget({
      baseUrl: 'https://liamtv.example.com',
      driverVersion: MIN_DEPLOYED_MODE_DRIVER_VERSION,
      gitExec: stubGit(),
      fetchImpl: stubFetch(500),
    });
    assert.equal(t.ok, false);
    assert.equal(t.mode, 'unsupported');
    assert.match(t.error, /BASE_URL/);
    assert.match(t.error, /500/);
  });

  it('(c2) deployed mode whose target does not answer at all errors rather than passing', async () => {
    const t = await resolveTarget({
      baseUrl: 'https://liamtv.example.com',
      driverVersion: MIN_DEPLOYED_MODE_DRIVER_VERSION,
      gitExec: stubGit(),
      fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
    });
    assert.equal(t.ok, false);
    assert.equal(t.mode, 'unsupported');
    assert.match(t.error, /ENOTFOUND/);
  });

  it('(d) local mode with no BASE_URL resolves to local and ok', async () => {
    const t = await resolveTarget({
      baseUrl: '',
      driverVersion: MIN_DEPLOYED_MODE_DRIVER_VERSION,
      gitExec: stubGit(),
      fetchImpl: stubFetch(200),
    });
    assert.equal(t.ok, true);
    assert.equal(t.error, null);
    assert.equal(t.mode, 'local');
    assert.equal(t.baseUrl, '');
  });

  it('(d2) a driver script without deployed-mode support is refused for a deployed target', async () => {
    // Simulate the historical defect: an older checkout that ignores BASE_URL.
    const fakeScript = path.join(os.tmpdir(), 'lia37-no-deployed-mode-' + process.pid + '.mjs');
    fs.writeFileSync(fakeScript, '// historical driver: serves local files, ignores any remote target\nconst port = 3000;\n');
    try {
      const support = scriptSupportsDeployedMode(fakeScript);
      assert.equal(support.ok, false);
      assert.match(support.reason, /deployed-mode support/);

      const t = await resolveTarget({
        baseUrl: 'https://liamtv.example.com',
        driverVersion: MIN_DEPLOYED_MODE_DRIVER_VERSION,
        gitExec: stubGit(),
        fetchImpl: stubFetch(200),
        scriptPath: fakeScript,
      });
      assert.equal(t.ok, false);
      assert.equal(t.mode, 'unsupported');
      assert.notEqual(t.mode, 'local', 'must NOT silently fall back to the local checkout');
      assert.match(t.error, /BASE_URL/);
    } finally {
      fs.rmSync(fakeScript, { force: true });
    }
  });

  it('(e) the driver source declares a deployed-mode-capable version and wires in the resolver', () => {
    const src = fs.readFileSync(DRIVER, 'utf8');
    const m = src.match(/const DRIVER_VERSION = (\d+)/);
    assert.ok(m, 'driver must declare a DRIVER_VERSION constant');
    assert.ok(
      Number(m[1]) >= MIN_DEPLOYED_MODE_DRIVER_VERSION,
      'driver version ' + m[1] + ' must be >= ' + MIN_DEPLOYED_MODE_DRIVER_VERSION
    );
    assert.match(src, /resolveTarget/, 'driver must use the target resolver');
    assert.match(src, /Ref under test/, 'driver must print the ref under test');
    assert.match(src, /driverVersion/, 'result file must carry the driver version');

    const support = scriptSupportsDeployedMode(DRIVER);
    assert.equal(support.ok, true, 'this driver must pass the deployed-mode support scan');
  });

  it('(f) end-to-end: an unreachable BASE_URL makes the driver exit non-zero without a green summary', () => {
    const outFile = path.join(os.tmpdir(), 'lia37-negative-control-' + process.pid + '.json');
    const res = spawnSync(
      process.execPath,
      [DRIVER],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 120000,
        env: {
          ...process.env,
          BASE_URL: 'https://liamtv-typo-does-not-exist.invalid',
          RESULT_FILE: outFile,
        },
      },
    );
    const stdout = String(res.stdout || '');
    const stderr = String(res.stderr || '');
    assert.notEqual(res.status, 0, 'driver must exit non-zero for an unreachable target');
    assert.equal(res.status, 2);
    assert.match(stdout + stderr, /BASE_URL/);
    assert.doesNotMatch(stdout, /\d+\/\d+ passed, 0 failed/, 'must not print a passing summary');

    // The result file must record the failure, not a pass.
    assert.ok(fs.existsSync(outFile), 'driver must write a result file for the refused target');
    const parsed = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    assert.equal(parsed.failed, true);
    assert.equal(parsed.mode, 'unsupported');
    assert.equal(parsed.baseUrl, 'https://liamtv-typo-does-not-exist.invalid');
    assert.ok(parsed.error && parsed.error.length > 0);
    assert.ok(parsed.ref, 'result file must pin the ref under test');
    fs.rmSync(outFile, { force: true });
  });
});

describe('LIA-37: git ref resolution', () => {
  it('normalizes a base URL by trimming whitespace and trailing slashes', () => {
    assert.equal(normalizeBaseUrl('  https://x.dev///  '), 'https://x.dev');
    assert.equal(normalizeBaseUrl(''), '');
    assert.equal(normalizeBaseUrl(undefined), '');
  });

  it('reports ref: unknown (and never throws) when git fails', async () => {
    const r = await resolveGitRef({
      execImpl: async () => { throw new Error('not a git repository'); },
    });
    assert.equal(r.ref, 'unknown');
    assert.equal(r.branch, 'unknown');
    assert.match(r.error, /not a git repository/);
  });

  it('resolves the real ref of this checkout', async () => {
    const r = await resolveGitRef({ cwd: REPO_ROOT });
    assert.match(r.ref, /^[0-9a-f]{7,40}$/, 'expected a real sha, got: ' + r.ref);
    assert.ok(r.branch && r.branch !== 'unknown');
  });
});
