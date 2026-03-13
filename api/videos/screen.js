/**
 * POST /api/videos/screen
 *
 * Batch-screen a list of videos against global + playlist-specific content rules.
 * Used when manually adding URLs or verifying an existing playlist.
 *
 * Request body:
 *   videos          {Array}  [{id, title, channel, thumb}]
 *   playlistFilters {string} Optional extra per-playlist rules
 *
 * Response:
 *   { passed: [{...video}], blocked: [{...video, reason?}] }
 *
 * ---
 * POST /api/videos/screen  (single video mode — when videos array has 1 item)
 * also returns { blocked: bool, reason: string } at top level for convenience
 */

import { cors, filterVideos, screenVideo } from '../_lib.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { videos, playlistFilters = '' } = req.body || {};

  if (!Array.isArray(videos) || !videos.length) {
    return res.status(400).json({ error: 'videos array is required' });
  }

  try {
    // Single video: use detailed screen (returns reason)
    if (videos.length === 1) {
      const v = videos[0];
      const result = await screenVideo(v.title, v.channel, playlistFilters);
      return res.status(200).json({
        passed: result.blocked ? [] : [v],
        blocked: result.blocked ? [{ ...v, reason: result.reason }] : [],
        // Convenience fields for single-video callers
        isBlocked: result.blocked,
        reason: result.reason,
      });
    }

    // Batch: use batch filter (more efficient — one Claude call)
    const passed = await filterVideos(videos, playlistFilters);
    const passedIds = new Set(passed.map(v => v.id));
    const blocked = videos.filter(v => !passedIds.has(v.id));

    return res.status(200).json({ passed, blocked });

  } catch (err) {
    console.error('/api/videos/screen error:', err);
    // Fail-open: return all passed if screening fails
    return res.status(200).json({ passed: videos, blocked: [], error: err.message });
  }
}
