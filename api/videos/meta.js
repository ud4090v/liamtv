/**
 * GET /api/videos/meta?id=VIDEO_ID
 *
 * Fetch YouTube metadata for a single video.
 *
 * Response:
 *   { id, title, channel, thumb }
 */

import { cors, ytVideoMeta } from '../_lib.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const { id } = req.query;
  if (!id || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(id.trim())) {
    return res.status(400).json({ error: 'Valid YouTube video id is required' });
  }

  try {
    const meta = await ytVideoMeta(id.trim());
    return res.status(200).json(meta);
  } catch (err) {
    console.error('/api/videos/meta error:', err);
    return res.status(500).json({ error: err.message });
  }
}
