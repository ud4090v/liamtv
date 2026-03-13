/**
 * POST /api/videos/search
 *
 * AI-powered video search. Claude generates search queries from a natural
 * language prompt, runs them against YouTube, then filters the combined
 * results through the global + playlist-specific content rules.
 *
 * Request body:
 *   prompt         {string}  What to search for ("monster trucks for toddlers")
 *   playlistFilters {string} Optional extra per-playlist rules
 *   maxResults     {number}  Max videos to return (default 10, max 30)
 *
 * Response:
 *   { videos: [{id, title, channel, thumb}], filtered: number }
 */

import { cors, callClaude, ytSearch, filterVideos, dedupe, GLOBAL_CONTENT_FILTERS, ANTHROPIC_MODEL_SMART } from '../_lib.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { prompt, playlistFilters = '', maxResults = 10 } = req.body || {};
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const limit = Math.min(Math.max(parseInt(maxResults) || 10, 1), 30);

  try {
    // Step 1: Claude generates diverse, filter-aware search queries
    const filterHint = `NEVER generate queries that would surface: reaction videos, fail compilations, prank videos, clickbait channels ("GONE WRONG", "EXTREME"), unboxing hauls, Elsagate content (adults imitating cartoon characters), or overstimulation rapid-cut videos.`;

    const queriesRaw = await callClaude({
      model: ANTHROPIC_MODEL_SMART,
      maxTokens: 400,
      system: `You generate YouTube search queries for finding child-safe videos for a 3-year-old. Return ONLY a JSON array of 4-6 short search query strings. No other text or markdown. ${filterHint}`,
      userMessage: `Generate YouTube search queries for: "${prompt.trim()}". Focus on content appropriate for a 3-year-old. Return JSON array only.`,
    });

    const queries = JSON.parse(queriesRaw.replace(/```json|```/g, '').trim());
    if (!Array.isArray(queries) || !queries.length) throw new Error('No queries generated');

    // Step 2: Search YouTube with each query
    const maxPerQuery = Math.ceil(limit * 1.8 / queries.length); // over-fetch to allow for filtering
    const rawResults = [];
    for (const q of queries) {
      try {
        const videos = await ytSearch({ query: q, maxResults: maxPerQuery });
        rawResults.push(...videos);
      } catch (e) {
        console.warn(`YouTube search failed for "${q}":`, e.message);
      }
    }

    const deduped = dedupe(rawResults);

    // Step 3: Filter through global + playlist rules
    const filtered = await filterVideos(deduped, playlistFilters);
    const trimmed = filtered.slice(0, limit);

    return res.status(200).json({
      videos: trimmed,
      filtered: deduped.length - filtered.length, // how many were blocked
    });

  } catch (err) {
    console.error('/api/videos/search error:', err);
    return res.status(500).json({ error: err.message });
  }
}
