/**
 * POST /api/videos/grow
 *
 * Auto-grow a playlist. Given playlist context (name, recent searches, top watched),
 * Claude generates diverse search queries, fetches YouTube results, filters them,
 * generates summaries for new videos, and returns videos ready to append.
 *
 * Request body:
 *   playlistName    {string}  Playlist name/slug
 *   channelTitle    {string}  Display name ("Monster Trucks")
 *   existingIds     {Array}   Video IDs already in playlist (to avoid duplicates)
 *   searchHistory   {Array}   Past search prompts used for this playlist
 *   topWatched      {Array}   [{title, channel, weight}] most-watched videos
 *   playlistFilters {string}  Optional per-playlist content rules
 *   targetCount     {number}  How many new videos to add (default 8, max 15)
 *
 * Response:
 *   { videos: [{id, title, channel, thumb, summary, weight}], filtered: number }
 */

import { cors, callClaude, ytSearch, filterVideos, dedupe, ANTHROPIC_MODEL_SMART, ANTHROPIC_MODEL_FAST, buildChannelTasteBlock, buildBlacklistScreenBlock } from '../_lib.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const {
    playlistName = 'playlist',
    channelTitle = '',
    existingIds = [],
    searchHistory = [],
    topWatched = [],
    playlistFilters = '',
    preferredChannels = [],
    blacklistedChannels = [],
    targetCount = 8,
  } = req.body || {};

  const limit = Math.min(Math.max(parseInt(targetCount) || 8, 1), 15);
  const existingSet = new Set(existingIds);

  try {
    // Build context for Claude
    const contextParts = [];
    if (channelTitle || playlistName) contextParts.push(`Playlist: "${channelTitle || playlistName}"`);
    if (searchHistory.length) contextParts.push(`Past search history: ${searchHistory.slice(-5).join('; ')}`);
    if (topWatched.length) {
      const topStr = topWatched.slice(0, 8).map(v => `"${v.title}" by ${v.channel}${v.weight > 1 ? ` (watched ${v.weight}x)` : ''}`).join(', ');
      contextParts.push(`Most watched: ${topStr}`);
    }
    contextParts.push(`Need ${limit} new videos not already in the playlist.`);
    const context = contextParts.join('\n');

    const filterHint = 'NEVER suggest reaction videos, fail compilations, prank videos, clickbait channels, unboxing hauls, Elsagate content (adults imitating cartoon characters), or overstimulation rapid-cut videos.';
    const combinedFilters = playlistFilters + buildBlacklistScreenBlock(blacklistedChannels);
    let totalFiltered = 0;

    // Step 1a: Hard-fetch from preferred channels (~60% of target)
    const preferredTarget = preferredChannels.length > 0 ? Math.ceil(limit * 0.6) : 0;
    let preferredVideos = [];

    if (preferredTarget > 0) {
      try {
        const prefCandidates = [];
        for (const ch of preferredChannels) {
          if (prefCandidates.length >= preferredTarget * 3) break;
          try {
            const videos = await ytSearch({ query: `"${ch}" for kids`, maxResults: 6 });
            for (const v of videos) {
              if (!existingSet.has(v.id)) prefCandidates.push(v);
            }
          } catch (e) {
            console.warn(`Preferred channel search failed for "${ch}":`, e.message);
          }
        }
        const prefDeduped = dedupe(prefCandidates);
        const prefSafe = await filterVideos(prefDeduped, combinedFilters);
        totalFiltered += prefDeduped.length - prefSafe.length;
        preferredVideos = prefSafe.slice(0, preferredTarget).map(v => ({ ...v, summary: '', weight: 0 }));
        // Track preferred IDs so broader discovery doesn't duplicate
        preferredVideos.forEach(v => existingSet.add(v.id));
      } catch (e) {
        console.warn('Preferred channel fetch failed (non-fatal):', e.message);
      }
    }

    // Step 1b: Broader AI discovery for remaining slots
    const remainingTarget = limit - preferredVideos.length;
    let discoveryVideos = [];

    if (remainingTarget > 0) {
      // Build channel taste signals (AI pattern inference)
      const channelTaste = buildChannelTasteBlock(preferredChannels, blacklistedChannels);

      const queriesRaw = await callClaude({
        model: ANTHROPIC_MODEL_SMART,
        maxTokens: 300,
        system: `You generate YouTube search queries to grow a kids playlist for a 3-year-old. Based on the playlist context, generate 5 diverse search queries to find MORE similar videos. Return ONLY a JSON array of search query strings. Vary the queries — mix specific titles, channels, compilations, and related topics. ${filterHint}`,
        userMessage: context + (channelTaste ? '\n\n' + channelTaste : ''),
      });

      const queries = JSON.parse(queriesRaw.replace(/```json|```/g, '').trim());
      if (!Array.isArray(queries) || !queries.length) throw new Error('No queries generated');

      // Step 2: Search YouTube, exclude existing videos
      const rawCandidates = [];
      for (const q of queries) {
        if (rawCandidates.length >= remainingTarget * 3) break;
        try {
          const videos = await ytSearch({ query: q, maxResults: 6 });
          for (const v of videos) {
            if (!existingSet.has(v.id)) rawCandidates.push(v);
          }
        } catch (e) {
          console.warn(`YouTube search failed for "${q}":`, e.message);
        }
      }

      const deduped = dedupe(rawCandidates);
      const filtered = await filterVideos(deduped, combinedFilters);
      totalFiltered += deduped.length - filtered.length;
      discoveryVideos = filtered.slice(0, remainingTarget).map(v => ({ ...v, summary: '', weight: 0 }));
    }

    // Combine preferred + discovery
    const newVideos = [...preferredVideos, ...discoveryVideos];

    // Step 4: Generate summaries in one Claude call
    if (newVideos.length > 0) {
      try {
        const titles = newVideos.map(v => v.title).join(' | ');
        const summariesRaw = await callClaude({
          model: ANTHROPIC_MODEL_FAST,
          maxTokens: 400,
          system: 'Generate very short 5-8 word summaries for each video title. Return ONLY a JSON array of strings, one per video, in the same order. No other text.',
          userMessage: `Video titles (pipe-separated): ${titles}`,
        });
        const summaries = JSON.parse(summariesRaw.replace(/```json|```/g, '').trim());
        newVideos.forEach((v, i) => { if (summaries[i]) v.summary = summaries[i]; });
      } catch (e) {
        console.warn('Summary generation failed (non-fatal):', e.message);
      }
    }

    return res.status(200).json({
      videos: newVideos,
      filtered: totalFiltered,
    });

  } catch (err) {
    console.error('/api/videos/grow error:', err);
    return res.status(500).json({ error: err.message });
  }
}
