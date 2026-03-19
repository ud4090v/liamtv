/**
 * POST /api/videos/scan
 *
 * Scan an existing playlist and return IDs of videos that should be removed
 * based on current content filters and blacklisted channels.
 * Called automatically on settings save.
 *
 * Request body:
 *   videos              {Array}   [{id, title, channel, thumb}]
 *   playlistFilters     {string}  Per-playlist content rules
 *   blacklistedChannels {Array}   Channels to block
 *
 * Response:
 *   { removeIds: [string], reasons: {[id]: string} }
 */

import { cors, filterVideos, buildBlacklistScreenBlock } from '../_lib.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const {
    videos = [],
    playlistFilters = '',
    blacklistedChannels = [],
  } = req.body || {};

  if (!videos.length) {
    return res.status(200).json({ removeIds: [], reasons: {} });
  }

  try {
    const combinedFilters = playlistFilters + buildBlacklistScreenBlock(blacklistedChannels);
    const passed = await filterVideos(videos, combinedFilters);
    const passedIds = new Set(passed.map(v => v.id));
    const removeIds = videos.filter(v => !passedIds.has(v.id)).map(v => v.id);

    return res.status(200).json({ removeIds, count: removeIds.length });

  } catch (err) {
    console.error('/api/videos/scan error:', err);
    // Fail-open: don't remove anything on error
    return res.status(200).json({ removeIds: [], error: err.message });
  }
}
