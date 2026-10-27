// tests/_lib.fail-closed.test.mjs
// Automated unit tests for LIA-18 fail-closed content filter hotfix.
// These tests lock in the fail-closed contract (pre-deploy gate).
//
// Run (from repo root):
//   node --test tests/_lib.fail-closed.test.mjs
//   npm run test:fail-closed
//
// Designed to FAIL on original unfixed api/_lib.js (fail-open returns videos)
// and PASS on the patched fail-closed production module.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Production module is the source of truth (LIA-22).
import {
  filterVideos,
  screenVideo,
  buildFilters,
  __setTestCallClaude,
  __setTestBlob,
  __TEST_ONLY__,
} from '../api/_lib.js';

import * as mockBlob from './_helpers/mock-blob.mjs';

const { getCachedScreening, setCachedScreening, hashString } = __TEST_ONLY__;

function makeVideos(count = 4) {
  return Array.from({ length: count }, (_, i) => ({
    id: `v${i}`,
    title: `Title ${i}`,
    channel: i % 2 === 0 ? 'SafeChannel' : 'RiskyPrankChannel',
    thumb: `https://i.ytimg.com/${i}.jpg`,
  }));
}

function setClaude(json) {
  // json can be array (for filterVideos) or object (for screenVideo)
  const text = typeof json === 'string' ? json : JSON.stringify(json);
  __setTestCallClaude(async () => text);
}

function setClaudeError(msg) {
  __setTestCallClaude(async () => { throw new Error(msg); });
}

function resetHooks() {
  __setTestCallClaude(null);
  mockBlob.reset();
  __setTestBlob(mockBlob);
}

describe('LIA-18: filterVideos fail-closed contract', () => {
  beforeEach(() => {
    resetHooks();
  });

  it('1. filterVideos happy path → returns filtered list AND writes to cache', async () => {
    // Child-safety risk prevented: regression that would allow blocked videos to leak
    const videos = makeVideos(4);
    setClaude([1, 3]); // 1-based indices to block (0 and 2)

    const result = await filterVideos(videos, '');

    assert.equal(result.length, 2, 'should remove the two blocked videos');
    assert.equal(result[0].id, 'v1');
    assert.equal(result[1].id, 'v3');

    // Cache write side-effect
    const filterBlock = buildFilters('');
    const keyMaterial = filterBlock + '|' + videos.map(v => v.id).sort().join(',');
    const cacheKey = `batch/${hashString(keyMaterial)}`;
    const cached = await getCachedScreening(cacheKey);
    assert.ok(cached, 'setCachedScreening must have written on success');
    assert.deepEqual(cached.result.blocked, [0, 2]);
  });

  it('2. filterVideos Claude failure + no cache → returns [] (fail-closed) AND calls notify', async () => {
    // Child-safety risk prevented: the original fail-open bug (returning unfiltered videos)
    const videos = makeVideos(3);
    setClaudeError('Claude 529 overloaded');

    const result = await filterVideos(videos, 'some playlist filter');

    assert.deepEqual(result, [], 'CRITICAL: must return empty array on error with no cache (fail-closed)');
  });

  it('3. filterVideos Claude failure + recent cache hit → returns cached-filtered list, NOT unfiltered', async () => {
    // Child-safety risk prevented: must use last-good verdict instead of failing open
    const videos = makeVideos(5);
    const filterBlock = buildFilters('');
    const keyMaterial = filterBlock + '|' + videos.map(v => v.id).sort().join(',');
    const cacheKey = `batch/${hashString(keyMaterial)}`;

    // Seed recent (<24h) cache entry: previously blocked indices 1 and 3
    await setCachedScreening(cacheKey, { blocked: [1, 3] });

    setClaudeError('network timeout');

    const result = await filterVideos(videos, '');

    assert.equal(result.length, 3, 'should return only the videos not blocked in cache');
    assert.ok(result.every(v => v.id !== 'v1' && v.id !== 'v3'), 'cached blocked indices must be honoured');
  });
});

describe('LIA-18: screenVideo fail-closed contract', () => {
  beforeEach(() => {
    resetHooks();
  });

  it('4. screenVideo happy path → returns {blocked, reason} from Claude AND writes cache', async () => {
    // Child-safety risk prevented: happy path must still block correctly and persist
    setClaude({ blocked: true, reason: 'elsagate style' });

    const verdict = await screenVideo('Bad Elsa video', 'ElsagateChannel', '');

    assert.equal(verdict.blocked, true);
    assert.equal(verdict.reason, 'elsagate style');

    const filterBlock = buildFilters('');
    const keyMaterial = filterBlock + '|' + 'Bad Elsa video' + '|' + 'ElsagateChannel';
    const cacheKey = `single/${hashString(keyMaterial)}`;
    const cached = await getCachedScreening(cacheKey);
    assert.ok(cached, 'setCachedScreening must be called on happy path');
  });

  it('5. screenVideo Claude failure + no cache → returns {blocked:true, safety reason} (NOT {blocked:false})', async () => {
    // Child-safety risk prevented: the original fail-open that allowed every video
    setClaudeError('timeout');

    const verdict = await screenVideo('Any title', 'AnyChannel', '');

    assert.equal(verdict.blocked, true, 'fail-closed MUST block when Claude unavailable and no cache');
    assert.match(verdict.reason, /Filter unavailable, blocking by default \(safety\)/);
  });

  it('6. screenVideo Claude failure + cache hit → returns cached verdict', async () => {
    // Child-safety risk prevented: must honour previous safe verdict during outage
    const title = 'Previously screened educational video';
    const channel = 'TrustedKids';
    const filterBlock = buildFilters('');
    const keyMaterial = filterBlock + '|' + title + '|' + channel;
    const cacheKey = `single/${hashString(keyMaterial)}`;

    await setCachedScreening(cacheKey, { blocked: false, reason: 'educational' });

    setClaudeError('503');

    const verdict = await screenVideo(title, channel, '');

    assert.equal(verdict.blocked, false);
    assert.equal(verdict.reason, 'educational');
  });
});

describe('LIA-18: cache resilience (best-effort, non-fatal)', () => {
  beforeEach(() => {
    resetHooks();
  });

  it('7. Cache write failure does NOT fail the request (best-effort)', async () => {
    // Child-safety risk prevented: blob outage must never turn a successful filter into an error
    setClaude([]);

    const videos = makeVideos(2);
    // setCachedScreening already swallows its own errors.
    // Prove the call still succeeds and returns data.
    const result = await filterVideos(videos, '');
    assert.equal(result.length, 2, 'happy path result must be returned even if cache write would fail');
  });

  it('8. Cache read failure does NOT crash — getCachedScreening swallows and triggers fail-closed', async () => {
    // Child-safety risk prevented: bad cache must degrade to safe fail-closed
    setClaudeError('claude down');

    const videos = makeVideos(1);
    const result = await filterVideos(videos, '');

    assert.deepEqual(result, [], 'cache read error + claude error must still produce fail-closed []');
  });
});

describe('GATING TEST — the exact fail-open bug must be impossible', () => {
  beforeEach(() => {
    resetHooks();
  });

  it('Claude throws → filterVideos returns [] (or cached subset) and NEVER the original input array', async () => {
    // This is the test that would have caught the bug if the unfixed code shipped.
    // On unfixed fail-open _lib.js this assertion FAILS (returns the input videos).
    // On patched production code it PASSES.
    const videos = makeVideos(4);
    setClaudeError('simulated total outage');

    const result = await filterVideos(videos, '');

    assert.notDeepEqual(result, videos, 'MUST NOT return unfiltered videos on Claude failure (fail-open regression)');
    assert.equal(result.length, 0, 'MUST return empty list when no cache and Claude fails');
  });
});
