/**
 * POST /api/videos/next
 *
 * Liam TV auto-play: pick the next video to play based on taste profile.
 * Guarantees a result by trying multiple Claude-generated queries until one
 * yields a safe, unplayed video. The search space is infinite — this should
 * never legitimately dead-end unless external APIs are down.
 *
 * Request body:
 *   taste           {Array}   [{title, channel}] videos the kid likes (up to 15)
 *   played          {Array}   Video IDs already played this session
 *   playlistFilters {string}  Optional per-playlist content rules
 *   sessionSize     {number}  How many videos played so far (for query variety hint)
 *
 * Response:
 *   { video: {id, title, channel, thumb}, query: string, reason: string }
 *
 * Strategy:
 *   - Ask Claude for MAX_QUERIES diverse queries in one call
 *   - Try each in sequence until one yields a safe unplayed video
 *   - If played set is large (>80), treat it as soft-reset (ignore played constraint)
 *     so session can continue indefinitely
 *   - Only returns null if all external API calls fail
 */

import { cors, callClaude, ytSearch, filterVideos, ANTHROPIC_MODEL_SMART } from '../_lib.js';

const MAX_QUERIES = 6; // generate this many diverse queries, try each in turn

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const {
    taste = [],
    played = [],
    playlistFilters = '',
    sessionSize = 0,
  } = req.body || {};

  // Soft-reset played constraint after long sessions so stream never stalls
  const playedSet = played.length > 80 ? new Set() : new Set(played);

  const sample = [...taste].sort(() => Math.random() - 0.5).slice(0, 10);
  const tasteStr = sample.length
    ? sample.map(v => `"${v.title}" by ${v.channel}`).join(', ')
    : 'various kid-friendly content for a 3-year-old';

  const filterHint = 'NEVER suggest reaction videos, fail compilations, prank videos, clickbait channels, unboxing hauls, Elsagate content (adults imitating cartoon characters), or overstimulation rapid-cut videos.';

  try {
    // Step 1: Claude generates MAX_QUERIES diverse queries in one call
    const queriesRaw = await callClaude({
      model: ANTHROPIC_MODEL_SMART,
      maxTokens: 400,
      system: `You pick YouTube search queries to find kid-safe videos for a 3-year-old based on their watch history. Return ONLY a JSON array of ${MAX_QUERIES} search query strings — each targeting a different angle (specific channel, compilation, related topic, theme, show). Make them varied so if one search yields nothing good, the next is a fresh direction. ${filterHint}`,
      userMessage: `Kid's favorites: ${tasteStr}\n\nSession videos played: ${sessionSize}. Generate ${MAX_QUERIES} diverse queries, most promising first. Return JSON array only.`,
    });

    const queries = JSON.parse(queriesRaw.replace(/```json|```/g, '').trim());
    if (!Array.isArray(queries) || !queries.length) throw new Error('No queries generated');

    // Step 2: Try each query until we find a safe unplayed video
    for (const query of queries) {
      try {
        const candidates = await ytSearch({ query, maxResults: 10 });

        // Filter out already-played
        const unplayed = candidates.filter(v => !playedSet.has(v.id));
        if (!unplayed.length) continue; // all played, try next query

        // Screen against content filters
        const safe = await filterVideos(unplayed, playlistFilters);
        if (!safe.length) continue; // all blocked, try next query

        // Got one
        return res.status(200).json({
          video: safe[0],
          query,
          reason: '',
        });
      } catch (e) {
        console.warn(`Query "${query}" failed:`, e.message);
        // Try next query
      }
    }

    // All queries exhausted — extremely unlikely in practice.
    // Return null so frontend can call again (Claude will generate different queries next time).
    console.warn('/api/videos/next: all queries exhausted — returning null');
    return res.status(200).json({ video: null, query: '', reason: 'exhausted' });

  } catch (err) {
    console.error('/api/videos/next error:', err);
    return res.status(500).json({ error: err.message });
  }
}
