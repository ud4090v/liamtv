/**
 * POST /api/videos/name
 *
 * Generate a short, kid-friendly playlist name from a list of video titles.
 *
 * Request body:
 *   titles  {Array<string>}  Video titles to base the name on
 *
 * Response:
 *   { name: "short-slug", title: "Display Title with Emoji" }
 */

import { cors, callClaude, ANTHROPIC_MODEL_SMART } from '../_lib.js';

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { titles = [] } = req.body || {};
  if (!Array.isArray(titles) || !titles.length) {
    return res.status(400).json({ error: 'titles array is required' });
  }

  try {
    const raw = await callClaude({
      model: ANTHROPIC_MODEL_SMART,
      maxTokens: 100,
      system: 'Generate a short, fun playlist name for a kids TV playlist based on the video titles. Return ONLY a JSON object: {"name": "short-slug", "title": "Display Title with Emoji"}. The slug should be lowercase with hyphens, max 3 words. The title should be 2-4 words with one relevant emoji. Keep it kid-friendly.',
      userMessage: `Videos: ${titles.join(', ')}`,
    });
    const result = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return res.status(200).json(result);
  } catch (err) {
    console.error('/api/videos/name error:', err);
    return res.status(500).json({ error: err.message });
  }
}
