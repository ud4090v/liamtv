/**
 * POST /api/videos/fill-queue
 *
 * Build a balanced queue batch for LiamTV continuous play.
 *
 * Philosophy: intentional curation over engagement optimization.
 * - Rotate through known-good library evenly before adding new content
 * - New discovery is a controlled budget (discoveryRatio), not the default
 * - Taste informs search direction but breadth is preserved deliberately
 * - Avoids the YouTube/TikTok rabbit-hole pattern of over-indexing on recent signals
 *
 * Queue composition:
 *   rotationSlots = floor(targetCount * (1 - discoveryRatio))
 *   discoverySlots = targetCount - rotationSlots
 *
 * Rotation slot selection:
 *   - Pull from history sorted by watchCount ASC (least-watched first)
 *   - Skip videos already in avoidIds (queued or played this session)
 *   - If all history videos have reached minWatchCount → all slots become discovery
 *
 * Discovery slot selection:
 *   - Claude generates diverse search queries from BROAD taste sample
 *     (not just recent favorites — intentionally samples across full history)
 *   - YouTube search + filter pipeline
 *
 * Request body:
 *   history         {Array}  [{id, title, channel, thumb, watchCount, skipCount, lastWatched}]
 *   avoidIds        {Array}  IDs to skip (already queued or played this session)
 *   playlistFilters {string} Per-playlist content rules
 *   targetCount     {number} Videos to return (default 10)
 *   minWatchCount   {number} Rotation threshold — all must hit this before all-discovery (default 3)
 *   discoveryRatio  {number} Fraction of queue that is new content (default 0.4)
 *
 * Response:
 *   {
 *     videos: [{...video, _source: 'rotation'|'discovery'}],
 *     allRotated: boolean,   // true if all history has hit minWatchCount
 *     filtered: number       // discovery videos blocked by content filters
 *   }
 */

import { cors, callClaude, ytSearch, filterVideos, dedupe, ANTHROPIC_MODEL_SMART } from '../_lib.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const {
    history = [],
    avoidIds = [],
    playlistFilters = '',
    targetCount = 10,
    minWatchCount = 3,
    discoveryRatio = 0.4,
  } = req.body || {};

  const avoid = new Set(avoidIds);
  const limit = Math.min(Math.max(parseInt(targetCount) || 10, 1), 20);

  // ── Step 1: Determine rotation vs discovery split ──
  const eligibleForRotation = history.filter(v =>
    !avoid.has(v.id) && (v.watchCount || 0) < minWatchCount
  );

  const allRotated = eligibleForRotation.length === 0 && history.length > 0;

  let rotationSlots, discoverySlots;
  if (allRotated) {
    // All videos have hit minWatchCount — go full discovery this batch
    rotationSlots = 0;
    discoverySlots = limit;
  } else {
    rotationSlots = Math.min(Math.floor(limit * (1 - discoveryRatio)), eligibleForRotation.length);
    discoverySlots = limit - rotationSlots;
  }

  const results = [];
  let filtered = 0;

  // ── Step 2: Rotation slots — least-watched first ──
  if (rotationSlots > 0) {
    const sorted = [...eligibleForRotation]
      .sort((a, b) => {
        const wa = a.watchCount || 0, wb = b.watchCount || 0;
        if (wa !== wb) return wa - wb; // least watched first
        return (a.lastWatched || 0) - (b.lastWatched || 0); // then least recent
      });

    // Shuffle videos with equal watch counts to avoid always repeating same order
    // Group by watchCount, shuffle within each group
    const groups = new Map();
    for (const v of sorted) {
      const wc = v.watchCount || 0;
      if (!groups.has(wc)) groups.set(wc, []);
      groups.get(wc).push(v);
    }
    const shuffledRotation = [];
    for (const [, group] of [...groups.entries()].sort((a, b) => a[0] - b[0])) {
      shuffledRotation.push(...group.sort(() => Math.random() - 0.5));
    }

    for (const v of shuffledRotation) {
      if (results.length >= rotationSlots) break;
      results.push({ id: v.id, title: v.title, channel: v.channel, thumb: v.thumb, _source: 'rotation' });
      avoid.add(v.id);
    }
  }

  // ── Step 3: Discovery slots — broad taste-informed search ──
  if (discoverySlots > 0) {
    try {
      // Build a BROAD taste sample — intentionally not just recent/top favorites
      // Sample from across the full history to preserve breadth
      const sample = buildBroadSample(history, 12);
      const tasteStr = sample.length
        ? sample.map(v => `"${v.title}" by ${v.channel}`).join(', ')
        : 'various kid-friendly educational and entertaining content';

      const filterHint = 'NEVER suggest reaction videos, fail compilations, prank videos, clickbait channels, unboxing hauls, Elsagate content, or overstimulation rapid-cut videos.';

      // Ask Claude for diverse queries — explicitly instruct breadth over depth
      const queriesRaw = await callClaude({
        model: ANTHROPIC_MODEL_SMART,
        maxTokens: 500,
        system: `You find new YouTube content for a 3-year-old's curated stream. Generate ${Math.min(discoverySlots + 3, 8)} diverse search queries. IMPORTANT: prioritize breadth and variety over confirming recent preferences. Mix different themes, formats, and subject areas — educational content, music, nature, vehicles, animals, art, science, stories. Do not over-index on the most recent taste signals. Return ONLY a JSON array of search query strings. ${filterHint}`,
        userMessage: `Child's watch history sample (for context only — use as inspiration, not as narrow targeting): ${tasteStr}\n\nGenerate diverse queries exploring DIFFERENT angles and themes. Return JSON array only.`,
      });

      const queries = JSON.parse(queriesRaw.replace(/```json|```/g, '').trim());

      // Search YouTube with each query, collect candidates
      const rawCandidates = [];
      for (const q of queries) {
        if (rawCandidates.length >= discoverySlots * 3) break;
        try {
          const videos = await ytSearch({ query: q, maxResults: 6 });
          for (const v of videos) {
            if (!avoid.has(v.id)) rawCandidates.push(v);
          }
        } catch (e) {
          console.warn(`Discovery search failed for "${q}":`, e.message);
        }
      }

      const deduped = dedupe(rawCandidates);

      // Filter through content rules
      const safe = await filterVideos(deduped, playlistFilters);
      filtered = deduped.length - safe.length;

      for (const v of safe.slice(0, discoverySlots)) {
        results.push({ ...v, _source: 'discovery' });
        avoid.add(v.id);
      }
    } catch (e) {
      console.error('Discovery fill failed:', e.message);
      // Non-fatal — return whatever rotation gave us
    }
  }

  // Shuffle the final batch so rotation and discovery videos are interleaved
  // (don't play all rotation first then all discovery — mix them)
  const shuffled = results.sort(() => Math.random() - 0.5);

  return res.status(200).json({
    videos: shuffled,
    allRotated,
    filtered,
  });
}

/**
 * Build a broad taste sample from history.
 * Intentionally samples across the full range rather than just top-watched,
 * to prevent the taste profile from narrowing over time.
 */
function buildBroadSample(history, n) {
  if (!history.length) return [];
  if (history.length <= n) return history;

  // Split history into tertiles by watchCount
  const sorted = [...history].sort((a, b) => (a.watchCount || 0) - (b.watchCount || 0));
  const third = Math.floor(sorted.length / 3);

  const low = sorted.slice(0, third);           // least watched
  const mid = sorted.slice(third, third * 2);   // middle
  const high = sorted.slice(third * 2);         // most watched

  // Sample proportionally from each tertile
  const pick = (arr, count) => arr.sort(() => Math.random() - 0.5).slice(0, count);
  const perTertile = Math.floor(n / 3);
  const remainder = n - perTertile * 3;

  return [
    ...pick(low, perTertile + remainder), // give remainder to low (least-watched gets slight boost)
    ...pick(mid, perTertile),
    ...pick(high, perTertile),
  ];
}
