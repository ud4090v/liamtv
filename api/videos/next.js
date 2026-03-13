/**
 * POST /api/videos/next
 *
 * Liam TV auto-play: pick the next video to play based on taste profile.
 * Claude picks a search query based on what the kid likes, searches YouTube,
 * filters results, and returns the best candidate not already played.
 *
 * Request body:
 *   taste           {Array}   [{title, channel}] videos the kid likes (up to 15)
 *   played          {Array}   Video IDs already played this session (to avoid repeats)
 *   playlistFilters {string}  Optional per-playlist content rules
 *   sessionSize     {number}  How many videos played so far (for "fresh" hint)
 *
 * Response:
 *   { video: {id, title, channel, thumb}, query: string, reason: string }
 *   or { video: null } if nothing found after exhausting attempts
 */

import { cors, callClaude, ytSearch, filterVideos, ANTHROPIC_MODEL_SMART } from '../_lib.js';

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

  const playedSet = new Set(played);

  // Shuffle + sample taste profile
  const sample = [...taste].sort(() => Math.random() - 0.5).slice(0, 8);
  const tasteStr = sample.length
    ? sample.map(v => `"${v.title}" by ${v.channel}`).join(', ')
    : 'various kid-friendly content';

  const filterHint = 'NEVER suggest reaction videos, fail compilations, prank videos, clickbait channels, unboxing hauls, Elsagate content (adults imitating cartoon characters), or overstimulation rapid-cut videos.';

  try {
    // Step 1: Claude picks a search query based on taste
    const queryRaw = await callClaude({
      model: ANTHROPIC_MODEL_SMART,
      maxTokens: 150,
      system: `You pick YouTube search queries to find kid-safe videos for a 3-year-old based on their taste. Return ONLY a JSON object: {"query": "search query string", "reason": "1-2 word reason"}. Make the query specific and varied — try different angles: compilations, specific channels, related topics, specific shows. Keep it fresh and age-appropriate. ${filterHint}`,
      userMessage: `Kid's favorites: ${tasteStr}\n\nPlayed ${sessionSize} videos this session. Find something ${sessionSize === 0 ? 'great to start with' : 'fresh and different'}.`,
    });

    const result = JSON.parse(queryRaw.replace(/```json|```/g, '').trim());
    const { query, reason = '' } = result;

    // Step 2: Search YouTube
    const candidates = await ytSearch({ query, maxResults: 12 });

    // Step 3: Remove already-played
    const unplayed = candidates.filter(v => !playedSet.has(v.id));

    // Step 4: Filter through content rules
    const safe = await filterVideos(unplayed, playlistFilters);

    if (!safe.length) {
      // Nothing passed — return null, frontend will retry
      return res.status(200).json({ video: null, query, reason });
    }

    return res.status(200).json({
      video: safe[0],
      query,
      reason,
    });

  } catch (err) {
    console.error('/api/videos/next error:', err);
    return res.status(500).json({ error: err.message });
  }
}
