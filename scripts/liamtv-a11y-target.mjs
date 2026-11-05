/**
 * Target resolution for the LiamTV a11y keyboard driver (LIA-37).
 *
 * Why this module exists:
 * A prior lesson (LIA-37) showed the driver could silently IGNORE BASE_URL and
 * serve LOCAL files while the console claimed it was testing a deployed
 * surface. That produced a false "all green against production" that
 * contradicted the deployed bytes. An unannounced fallback is the whole bug;
 * an announced fallback is a feature.
 *
 * This module owns the decision of *what* is under test:
 *   - resolve the git ref (sha + branch) actually being exercised
 *   - decide local vs deployed mode
 *   - REFUSE deployed mode when this driver cannot honour it
 *   - REFUSE deployed mode when the deployed URL does not actually answer
 *
 * It NEVER falls back to the local checkout silently.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';

export const MIN_DEPLOYED_MODE_DRIVER_VERSION = 2;
export const REACHABILITY_TIMEOUT_MS = 15000;
export const GIT_TIMEOUT_MS = 10000;

// Markers that MUST be present in the running driver script for it to be able
// to honour BASE_URL. This is the self-evident part of the LIA-37 contract:
// a script without deployed-mode handling can never be trusted with a
// deployed target, no matter what its version constant claims.
export const DEPLOYED_MODE_MARKERS = ['DRIVER_VERSION', 'DEPLOYED', 'BASE_URL'];

/**
 * Verify that the running driver script actually contains deployed-mode
 * support. Returns { ok, reason } and never throws.
 *
 * @param {string} scriptPath
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function scriptSupportsDeployedMode(scriptPath) {
  let src;
  try {
    src = fs.readFileSync(scriptPath, 'utf8');
  } catch (e) {
    return { ok: false, reason: 'could not read the running driver script at ' + scriptPath + ': ' + describeError(e) };
  }
  const missing = DEPLOYED_MODE_MARKERS.filter((m) => !src.includes(m));
  if (missing.length) {
    return {
      ok: false,
      reason: 'the running driver script (' + scriptPath + ') has no deployed-mode support (missing: ' + missing.join(', ') + ')',
    };
  }
  return { ok: true, reason: null };
}

/** Build a human-readable message from a thrown error, including the cause. */
function describeError(e) {
  const msg = e && e.message ? e.message : String(e);
  const cause = e && e.cause && e.cause.message ? e.cause.message : null;
  return cause && !msg.includes(cause) ? msg + ' (' + cause + ')' : msg;
}

/** Strip whitespace and trailing slashes from a base URL. */
export function normalizeBaseUrl(raw) {
  return String(raw ?? '').trim().replace(/\/+$/, '');
}

/** Default git runner: returns stdout, rejects on non-zero exit. */
function defaultGitExec(args, cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout || ''));
    });
  });
}

/**
 * Resolve the ref under test. Never throws: a git failure yields an explicit
 * 'unknown' ref plus the error message, so the driver can print it instead of
 * silently omitting it.
 *
 * @param {{ cwd?: string, execImpl?: (args: string[], cwd: string) => Promise<string> }} opts
 * @returns {Promise<{ ref: string, branch: string, error: string|null }>}
 */
export async function resolveGitRef({ cwd = process.cwd(), execImpl } = {}) {
  const runner = typeof execImpl === 'function' ? execImpl : defaultGitExec;
  try {
    const raw = await runner(['rev-parse', 'HEAD'], cwd);
    const ref = String(raw || '').trim();
    if (!ref) {
      return { ref: 'unknown', branch: 'unknown', error: 'git rev-parse HEAD returned no output' };
    }
    let branch = 'unknown';
    try {
      branch = String(await runner(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) || '').trim() || 'unknown';
    } catch {
      branch = 'unknown';
    }
    return { ref, branch, error: null };
  } catch (e) {
    return { ref: 'unknown', branch: 'unknown', error: e && e.message ? e.message : String(e) };
  }
}

/**
 * Resolve what the driver is about to test.
 *
 * @param {{
 *   baseUrl?: string,
 *   driverVersion?: number|string,
 *   minDriverVersion?: number|string,
 *   fetchImpl?: (url: string, init?: object) => Promise<{ status?: number }>,
 *   gitExec?: (args: string[], cwd: string) => Promise<string>,
 *   cwd?: string,
 *   timeoutMs?: number,
 *   scriptPath?: string,
 * }} opts
 * @returns {Promise<{
 *   mode: 'local'|'deployed'|'unsupported',
 *   requestedMode: 'local'|'deployed',
 *   baseUrl: string,
 *   ref: string,
 *   branch: string,
 *   driverVersion: number,
 *   ok: boolean,
 *   error: string|null,
 *   refError: string|null,
 *   status: number|null,
 * }>}
 */
export async function resolveTarget({
  baseUrl = '',
  driverVersion = MIN_DEPLOYED_MODE_DRIVER_VERSION,
  minDriverVersion = MIN_DEPLOYED_MODE_DRIVER_VERSION,
  fetchImpl,
  gitExec,
  cwd = process.cwd(),
  timeoutMs = REACHABILITY_TIMEOUT_MS,
  scriptPath = null,
} = {}) {
  const normalized = normalizeBaseUrl(baseUrl);
  const version = Number(driverVersion);
  const minVersion = Number(minDriverVersion);
  const { ref, branch, error: refError } = await resolveGitRef({ cwd, execImpl: gitExec });
  const requestedMode = normalized ? 'deployed' : 'local';

  const out = {
    mode: requestedMode,
    requestedMode,
    baseUrl: normalized,
    ref,
    branch,
    driverVersion: Number.isFinite(version) ? version : driverVersion,
    ok: true,
    error: null,
    refError,
    status: null,
  };

  // Local mode needs no extra proof: the checkout is what it is, and the ref
  // under test is printed so the reader knows exactly what was exercised.
  if (!normalized) return out;

  // Deployed mode was requested. Refuse unless this driver supports it.
  // Two independent gates: the version marker AND the actual presence of
  // deployed-mode handling in the running script.
  if (scriptPath) {
    const support = scriptSupportsDeployedMode(scriptPath);
    if (!support.ok) {
      out.mode = 'unsupported';
      out.ok = false;
      out.error =
        'BASE_URL is set to ' + normalized +
        ' but this driver cannot honour a deployed target: ' + support.reason + '. ' +
        'Refusing to silently fall back to the local checkout. Ref under test: ' + ref + '.';
      return out;
    }
  }
  if (!Number.isFinite(version) || version < minVersion) {
    out.mode = 'unsupported';
    out.ok = false;
    out.error =
      'BASE_URL is set to ' + normalized +
      ' but this driver (version ' + out.driverVersion + ') does not support deployed mode ' +
      '(driver version ' + minVersion + '+ is required). ' +
      'Refusing to silently fall back to the local checkout. Ref under test: ' + ref + '.';
    return out;
  }

  // Cheap reachability check BEFORE launching Chrome, so a typo'd or dead URL
  // can never be reported as "0 failures" against a local server.
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : globalThis.fetch;
  let status = null;
  try {
    const res = await doFetch(normalized, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    status = res && typeof res.status === 'number' ? res.status : null;
  } catch (e) {
    out.mode = 'unsupported';
    out.ok = false;
    out.error =
      'BASE_URL is set to ' + normalized +
      ' but the target did not respond (' + describeError(e) + '). ' +
      'Refusing to silently fall back to the local checkout. Ref under test: ' + ref + '.';
    return out;
  }
  if (status === null || status < 200 || status >= 400) {
    out.mode = 'unsupported';
    out.ok = false;
    out.error =
      'BASE_URL is set to ' + normalized +
      ' but the target responded with HTTP ' + status + ' (expected 2xx/3xx). ' +
      'Refusing to silently fall back to the local checkout. Ref under test: ' + ref + '.';
    return out;
  }

  out.status = status;
  return out;
}
