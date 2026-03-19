/**
 * POST /api/videos/reset
 *
 * Wipe a playlist and repopulate with 25 fresh AI-discovered videos.
 * Uses all current settings: content filters, parent direction,
 * preferred channels (~60% soft cap), blacklisted channels.
 *
 * Request body:
 *   playlistName       {string}  Playlist name/slug
 *   channelTitle       {string}  Display name
 *   playlistFilters    {string}  Per-playlist content rules
 *   parentDirection    {string}  Parent's intent for discovery
 *   preferredChannels  {Array}   Positive taste signal channels
 *   blacklistedChannels {Array}  Negative taste signal channels
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
    playlistFilters = '',
    parentDirection = '',
    preferredChannels = [],
    blacklistedChannels = [],
  } = req.body || {};

  const TARGET = 25;

  try {
    // Build context for Claude
    const contextParts = [];
    if (channelTitle || playlistName) contextParts.push(`Playlist: "${channelTitle || playlistName}"`);

    const directionBlock = parentDirection
      ? `PARENT'S INTENT: "${parentDirection}"\nEvery search query should serve this intent.`
      : `No specific parent direction — discover a balanced mix of educational and entertaining content for a 3-year-old.`;

    const channelTaste = buildChannelTasteBlock(preferredChannels, blacklistedChannels);
    const filterHint = 'NEVER suggest reaction videos, fail compilations, prank videos, clickbait channels, unboxing hauls, Elsagate content, or overstimulation rapid-cut videos.';
    const combinedFilters = playlistFilters + buildBlacklistScreenBlock(blacklistedChannels);

    const seen = new Set();
    let totalFiltered = 0;

    // Step 1a: Hard-fetch from preferred channels (~60% = 15 of 25)
    const preferredTarget = preferredChannels.length > 0 ? Math.ceil(TARGET * 0.6) : 0;
    let preferredVideos = [];

    if (preferredTarget > 0) {
      try {
        const prefCandidates = [];
        for (const ch of preferredChannels) {
          if (prefCandidates.length >= preferredTarget * 3) break;
          try {
            const videos = await ytSearch({ query: `"${ch}" for kids`, maxResults: 8 });
            for (const v of videos) {
              if (!seen.has(v.id)) { seen.add(v.id); prefCandidates.push(v); }
            }
          } catch (e) {
            console.warn(`Preferred channel search failed for "${ch}":`, e.message);
          }
        }
        const prefSafe = await filterVideos(prefCandidates, combinedFilters);
        totalFiltered += prefCandidates.length - prefSafe.length;
        preferredVideos = prefSafe.slice(0, preferredTarget).map(v => ({ ...v, summary: '', weight: 0 }));
        preferredVideos.forEach(v => seen.add(v.id));
      } catch (e) {
        console.warn('Preferred channel fetch failed (non-fatal):', e.message);
      }
    }

    // Step 1b: Broader AI discovery for remaining slots
    const remainingTarget = TARGET - preferredVideos.length;
    let discoveryVideos = [];

    if (remainingTarget > 0) {
      const queriesRaw = await callClaude({
        model: ANTHROPIC_MODEL_SMART,
        maxTokens: 600,
        system: `You build a fresh YouTube playlist for a 3-year-old from scratch. Generate 10 diverse search queries to find ${remainingTarget} high-quality videos. Mix different angles: specific channels, themes, compilations, educational content, entertainment. ${filterHint}`,
        userMessage: `${directionBlock}\n\n${contextParts.join('\n')}\n\n${channelTaste ? channelTaste + '\n\n' : ''}Generate 10 diverse YouTube search queries. Return JSON array only.`,
      });

      const queries = JSON.parse(queriesRaw.replace(/```json|```/g, '').trim());
      if (!Array.isArray(queries) || !queries.length) throw new Error('No queries generated');

      const rawCandidates = [];
      for (const q of queries) {
        if (rawCandidates.length >= remainingTarget * 3) break;
        try {
          const videos = await ytSearch({ query: q, maxResults: 8 });
          for (const v of videos) {
            if (!seen.has(v.id)) { seen.add(v.id); rawCandidates.push(v); }
          }
        } catch (e) {
          console.warn(`Reset search failed for "${q}":`, e.message);
        }
      }

      const filtered = await filterVideos(rawCandidates, combinedFilters);
      totalFiltered += rawCandidates.length - filtered.length;
      discoveryVideos = filtered.slice(0, remainingTarget).map(v => ({ ...v, summary: '', weight: 0 }));
    }

    // Combine preferred + discovery
    const newVideos = [...preferredVideos, ...discoveryVideos];

    // Step 4: Generate summaries
    if (newVideos.length > 0) {
      try {
        const titles = newVideos.map(v => v.title).join(' | ');
        const summariesRaw = await callClaude({
          model: ANTHROPIC_MODEL_FAST,
          maxTokens: 800,
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
    console.error('/api/videos/reset error:', err);
    return res.status(500).json({ error: err.message });
  }
}
