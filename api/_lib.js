// ─── Shared utilities for LiamTV API layer ───

import { put as realPut, list as realList } from '@vercel/blob';
import { createHash } from 'crypto';

export const ANTHROPIC_MODEL_SMART = 'claude-sonnet-4-20250514';
export const ANTHROPIC_MODEL_FAST  = 'claude-haiku-4-20250514';

// ── Global content filter baseline ──
// All discovery paths (search, grow, auto-play) apply this before returning videos to the client.
export const GLOBAL_CONTENT_FILTERS = `
REACTION CONTENT: videos where the main content is a person or group watching and reacting to other videos; reaction channels; commentary channels whose primary format is reacting to other content

FAIL & PAIN CONTENT: fail compilations, people or animals getting hurt, painful accidents filmed for laughs, epic fail videos, blooper reels involving injury or humiliation

CHALLENGE & PRANK VIDEOS: dangerous challenge trends, pranks played on people, hidden camera pranks, fake scare pranks, psychological manipulation framed as humor

CLICKBAIT FORMATS: titles containing "GONE WRONG", "EXTREME", "YOU WON'T BELIEVE", "GONE SEXUAL", "NOT CLICKBAIT", "I'M LEAVING", "WE NEED TO TALK", "EXPOSED", "SHOCKING"; videos with exaggerated shock/crying/screaming thumbnail faces with arrows or circles pointing at things

DRAMA & BEEF: creator drama, "responding to hate", "calling out", feuds between influencers, emotional manipulation ("I have something to tell you", "I'm quitting YouTube")

UNBOXING & HAUL CONTENT: unboxing luxury items, toy haul videos from influencer channels, mystery box videos, sponsor-disguised content presented as entertainment

ELSAGATE-STYLE CONTENT: adults dressed as or imitating cartoon characters (Spider-Man, Elsa, Peppa Pig, etc.) in live action skits not made by the IP owner; fast-cut nursery rhyme videos with violent or disturbing themes disguised as kids content; videos that superficially look like kids content but contain adult or disturbing themes

OVERSTIMULATION CONTENT: videos with relentless rapid-fire cuts every 1-2 seconds, constant screaming/yelling presenters, extreme sound effects used to keep toddlers in a trance-like state; brain rot short-form content repurposed as long videos

INFLUENCER PROMOTION: YouTubers promoting their own merch, "check the description", channels that exist primarily to sell products to children or parents

TOP-N ALGORITHM BAIT: "Top 10 scariest", "Top 5 most dangerous", countdown format videos designed purely for algorithm performance with no educational or entertainment value

ENGAGEMENT MANIPULATION: videos ending with "comment below if you want part 2", "smash the like button or this happens", manipulation of children's behavior through fake consequences

ANIMALS IN DISTRESS: videos framing animal suffering, animal fights, or animals in dangerous situations as entertaining content, even if presented as funny
`.trim();

// Build combined filter string for prompts
export function buildFilters(playlistFilters) {
  const parts = ['=== GLOBAL RULES (always apply) ===\n' + GLOBAL_CONTENT_FILTERS];
  if (playlistFilters && playlistFilters.trim()) {
    parts.push('=== ADDITIONAL PLAYLIST-SPECIFIC RULES ===\n' + playlistFilters.trim());
  }
  return parts.join('\n\n');
}

// Build channel taste signals block for Claude prompts
export function buildChannelTasteBlock(preferredChannels, blacklistedChannels) {
  const parts = [];
  if (preferredChannels && preferredChannels.length) {
    parts.push(
      `=== PREFERRED CHANNELS (positive taste signals) ===\n` +
      `Study these channels to understand the STYLE, QUALITY, and PATTERN the parent approves of. ` +
      `Use them as inspiration — about 60% of discovered videos should come from these channels or channels with very similar style/quality/content-type. ` +
      `The remaining 40% should be fresh discovery that still fits the same quality bar.\n` +
      preferredChannels.map(c => `• ${c}`).join('\n')
    );
  }
  if (blacklistedChannels && blacklistedChannels.length) {
    parts.push(
      `=== BLACKLISTED CHANNELS (negative taste signals) ===\n` +
      `Study these channels to understand what the parent DISLIKES — the style, format, quality, and content patterns they represent. ` +
      `NEVER include videos from these exact channels. Also avoid channels with similar style, format, or approach.\n` +
      blacklistedChannels.map(c => `• ${c}`).join('\n')
    );
  }
  return parts.join('\n\n');
}

// Build blacklist screening block for filterVideos-style checks
export function buildBlacklistScreenBlock(blacklistedChannels) {
  if (!blacklistedChannels || !blacklistedChannels.length) return '';
  return `\n=== BLACKLISTED CHANNELS (always block) ===\nBlock ANY video from these channels or channels with very similar names:\n` +
    blacklistedChannels.map(c => `• ${c}`).join('\n');
}

// ── Claude helper ──
export async function callClaude({ model, system, userMessage, maxTokens }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error ${resp.status}`);
  }
  const data = await resp.json();
  return data.content[0].text;
}


// ── YouTube Search Cache (Vercel Blob, 24h TTL) ──
//
// Cache key: yt-cache/{normalised_query}_n{maxResults}.json
// Normalisation: lowercase, collapse whitespace, trim — same effective query = same key.
// TTL is checked on read; stale blobs are replaced on next miss.
// Blob is used (not KV) because BLOB_READ_WRITE_TOKEN is already provisioned.
// Cache only applies to ytSearch — ytVideoMeta is not cached (single-video, cheap).
//
// Quota savings:
//   fill-queue: up to 4 searches × 100 units = 400 units/call → 0 on cache hit
//   grow:       up to 5 searches × 100 units = 500 units/call → 0 on cache hit
//   search:     up to 6 searches × 100 units = 600 units/call → 0 on cache hit

const YT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Simple consistent hash for use as a filename-safe cache key.
// We use a lightweight FNV-1a-style digest over the canonical key string.
// This avoids a crypto import and keeps the function synchronous.
function cacheKeyHash(query, maxResults) {
  const canonical = `${query.toLowerCase().replace(/\s+/g, ' ').trim()}|n${maxResults}`;
  // FNV-1a 32-bit
  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return `yt-cache/${hash.toString(16)}.json`;
}

async function ytCacheGet(blobToken, path) {
  try {
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: path, token: blobToken });
    if (!blobs.length) return null;
    const blob = blobs[0];
    const resp = await fetch(blob.url);
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.cachedAt || Date.now() - data.cachedAt > YT_CACHE_TTL_MS) {
      return null; // expired — treat as miss, will be overwritten
    }
    return data.videos;
  } catch (e) {
    console.warn('[yt-cache] read error (non-fatal):', e.message);
    return null;
  }
}

async function ytCachePut(blobToken, path, videos) {
  try {
    const { put } = await import('@vercel/blob');
    const payload = JSON.stringify({ cachedAt: Date.now(), videos });
    await put(path, payload, {
      access: 'public',
      contentType: 'application/json',
      token: blobToken,
      addRandomSuffix: false,
    });
  } catch (e) {
    console.warn('[yt-cache] write error (non-fatal):', e.message);
  }
}

// ── YouTube search helper (cache-wrapped) ──

// ── Test seams (null in production → real implementations) ──
let __testCallClaude = null;
let __testBlob = null;

export function __setTestCallClaude(fn) {
  __testCallClaude = fn || null;
}

export function __setTestBlob(blobApi) {
  __testBlob = blobApi || null;
}

async function invokeClaude(args) {
  if (__testCallClaude) return __testCallClaude(args);
  return callClaude(args);
}

async function put(path, payload, options) {
  if (__testBlob?.put) return __testBlob.put(path, payload, options);
  return realPut(path, payload, options);
}

async function list(opts) {
  if (__testBlob?.list) return __testBlob.list(opts);
  return realList(opts);
}

// ── YouTube search helper ──

export async function ytSearch({ query, maxResults = 10 }) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY not configured');

  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const cachePath = blobToken ? cacheKeyHash(query, maxResults) : null;

  // ── Cache read ──
  if (cachePath) {
    const cached = await ytCacheGet(blobToken, cachePath);
    if (cached) {
      console.log(`[yt-cache] HIT query="${query}" n=${maxResults} → ${cached.length} videos, 0 quota units`);
      return cached;
    }
  }

  // ── Cache miss → live API call ──
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    safeSearch: 'strict',
    videoEmbeddable: 'true',
    maxResults: String(maxResults),
    key: apiKey,
  });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!resp.ok) throw new Error(`YouTube API error ${resp.status}`);
  const data = await resp.json();

  const videos = (data.items || []).map(item => ({
    id: item.id.videoId,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    thumb: item.snippet.thumbnails?.medium?.url || `https://img.youtube.com/vi/${item.id.videoId}/mqdefault.jpg`,
  }));

  console.log(`[yt-cache] MISS query="${query}" n=${maxResults} → ${videos.length} videos, ~100 quota units consumed`);

  // ── Cache write (non-blocking) ──
  if (cachePath) {
    ytCachePut(blobToken, cachePath, videos).catch(() => {});
  }

  return videos;
}

// ── YouTube video meta helper ──
export async function ytVideoMeta(id) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY not configured');
  const params = new URLSearchParams({ part: 'snippet', id, key: apiKey });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  if (!resp.ok) throw new Error(`YouTube API error ${resp.status}`);
  const data = await resp.json();
  if (!data.items?.[0]) return { id, title: `Video ${id}`, channel: 'YouTube', thumb: `https://img.youtube.com/vi/${id}/mqdefault.jpg` };
  const s = data.items[0].snippet;
  return { id, title: s.title, channel: s.channelTitle, thumb: s.thumbnails?.medium?.url || `https://img.youtube.com/vi/${id}/mqdefault.jpg` };
}

// ── Screening cache (fail-closed fallback) ──
const SCREENING_CACHE_PREFIX = 'screening-cache';
const SCREENING_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function hashString(s) {
  return createHash('sha256').update(s).digest('hex');
}

async function getCachedScreening(key) {
  try {
    const { blobs } = await list({ prefix: `${SCREENING_CACHE_PREFIX}/${key}` });
    if (!blobs.length) return null;
    const newest = blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0];
    const ageMs = Date.now() - new Date(newest.uploadedAt).getTime();
    if (ageMs > SCREENING_CACHE_TTL_MS) return null;
    // Test mock may attach .content to avoid real fetch
    if (newest.content) {
      try { return JSON.parse(newest.content); } catch (_) { /* fall through */ }
    }
    const resp = await fetch(newest.url);
    if (!resp.ok) return null;
    return await resp.json();
  } catch (e) {
    console.warn('getCachedScreening failed (fail-closed will trigger):', e.message);
    return null;
  }
}

async function setCachedScreening(key, result) {
  try {
    const payload = JSON.stringify({ result, cachedAt: new Date().toISOString() });
    await put(`${SCREENING_CACHE_PREFIX}/${key}/${Date.now()}.json`, payload, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
    });
  } catch (e) {
    console.warn('setCachedScreening failed (non-fatal):', e.message);
  }
}

async function notifyParentFilterFailed(context) {
  // Phase 1.5: real notification UI. Hotfix logs + writes a failures blob for visibility.
  console.error('[LiamTV] Content filter failed in fail-closed mode:', JSON.stringify(context));
  try {
    await put(`_filter-failures/${Date.now()}.json`, JSON.stringify({
      timestamp: new Date().toISOString(),
      ...context,
    }), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: true,
    });
  } catch (e) {
    // Best-effort. Don't fail the request if notification write fails.
  }
}

// ── Batch filter: returns only videos that pass all rules ──
// Sends one Claude Haiku call for the whole batch. Fail-closed on error.
export async function filterVideos(videos, playlistFilters) {
  if (!videos.length) return videos;
  const filterBlock = buildFilters(playlistFilters);
  const listStr = videos.map((v, i) => `${i + 1}. [${v.channel}] ${v.title}`).join('\n');
  const cacheKey = `batch/${hashString(filterBlock + '|' + videos.map(v => v.id).sort().join(','))}`;
  try {
    const raw = await invokeClaude({
      model: ANTHROPIC_MODEL_FAST,
      maxTokens: 200,
      system: 'You screen YouTube videos for a parent protecting a young child. Given a numbered list of videos and content filter rules, return ONLY a JSON array of the 1-based numbers that should be BLOCKED. Example: [2,5]. If none blocked, return []. No other text.',
      userMessage: filterBlock + '\n\nVideos:\n' + listStr + '\n\nWhich numbers are blocked? Return JSON array only.',
    });
    const blocked = new Set(JSON.parse(raw.replace(/```json|```/g, '').trim()).map(n => n - 1));
    const filtered = videos.filter((_, i) => !blocked.has(i));
    // Cache the good result (best-effort, non-blocking on success)
    await setCachedScreening(cacheKey, { blocked: Array.from(blocked) });
    return filtered;
  } catch (e) {
    console.warn('filterVideos failed (falling back to cache or fail-closed):', e.message);
    const cached = await getCachedScreening(cacheKey);
    if (cached?.result?.blocked) {
      const blocked = new Set(cached.result.blocked);
      return videos.filter((_, i) => !blocked.has(i));
    }
    // No usable cache — fail closed: return empty list + notify parent.
    await notifyParentFilterFailed({ fn: 'filterVideos', error: e.message, videoCount: videos.length });
    return [];
  }
}

// ── Screen single video ──
// Fail-closed on error: block when filter unavailable and no cache.
export async function screenVideo(title, channel, playlistFilters) {
  const filterBlock = buildFilters(playlistFilters);
  const cacheKey = `single/${hashString(filterBlock + '|' + (title || '') + '|' + (channel || ''))}`;
  try {
    const raw = await invokeClaude({
      model: ANTHROPIC_MODEL_FAST,
      maxTokens: 80,
      system: 'You screen YouTube videos for a parent protecting a young child. Reply with JSON only: {"blocked": true/false, "reason": "short reason or empty string"}. No other text.',
      userMessage: filterBlock + '\n\nVideo title: ' + title + '\nChannel: ' + channel + '\n\nIs this video blocked by any of the above rules?',
    });
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    // Cache the good verdict (best-effort)
    await setCachedScreening(cacheKey, { blocked: !!parsed.blocked, reason: parsed.reason || '' });
    return { blocked: !!parsed.blocked, reason: parsed.reason || '' };
  } catch (e) {
    console.warn('screenVideo failed (falling back to cache or fail-closed):', e.message);
    const cached = await getCachedScreening(cacheKey);
    if (cached?.result) {
      return { blocked: !!cached.result.blocked, reason: cached.result.reason || '' };
    }
    // No usable cache — fail closed: block this video.
    await notifyParentFilterFailed({ fn: 'screenVideo', error: e.message, title, channel });
    return { blocked: true, reason: 'Filter unavailable, blocking by default (safety)' };
  }
}

// ── Deduplicate by video id ──
export function dedupe(videos) {
  const seen = new Set();
  return videos.filter(v => { if (seen.has(v.id)) return false; seen.add(v.id); return true; });
}

// ── CORS helper ──
export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

// Test-only exports for cache assertions (no production callers)
export const __TEST_ONLY__ = {
  SCREENING_CACHE_PREFIX,
  SCREENING_CACHE_TTL_MS,
  hashString,
  getCachedScreening,
  setCachedScreening,
  notifyParentFilterFailed,
};
