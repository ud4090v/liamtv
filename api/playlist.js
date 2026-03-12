import { put, list, del } from '@vercel/blob';

const PLAYLIST_KEY = 'playlist.json';

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();

  if (req.method === "GET") {
    try {
      const { blobs } = await list({ prefix: PLAYLIST_KEY });
      if (blobs.length === 0) {
        return res.status(200).json({ videos: [], settings: { channelName: 'Monster Truck TV 🚛', playOrder: 'sequence', sleepTimer: 30 } });
      }
      const response = await fetch(blobs[0].url);
      const data = await response.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    try {
      const data = req.body;
      if (!data || !Array.isArray(data.videos)) {
        return res.status(400).json({ error: "Invalid playlist format. Expected { videos: [...], settings: {...} }" });
      }

      // Delete old blob if exists
      const { blobs } = await list({ prefix: PLAYLIST_KEY });
      for (const blob of blobs) {
        await del(blob.url);
      }

      // Write new
      const blob = await put(PLAYLIST_KEY, JSON.stringify(data), {
        contentType: 'application/json',
        access: 'public',
        addRandomSuffix: false,
      });

      return res.status(200).json({ ok: true, url: blob.url, count: data.videos.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
