import { put, head } from '@vercel/blob';

const PLAYLIST_PATH = 'playlist.json';

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();

  const defaultPlaylist = { videos: [], settings: { channelName: 'Monster Truck TV 🚛', playOrder: 'sequence', sleepTimer: 30 } };

  if (req.method === "GET") {
    try {
      // Try to get the blob metadata first
      const meta = await head(PLAYLIST_PATH).catch(() => null);
      if (!meta) {
        return res.status(200).json(defaultPlaylist);
      }
      // Fetch the actual content with cache-bust
      const response = await fetch(meta.url + '?t=' + Date.now());
      if (!response.ok) {
        return res.status(200).json(defaultPlaylist);
      }
      const data = await response.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(200).json(defaultPlaylist);
    }
  }

  if (req.method === "POST") {
    try {
      const data = req.body;
      if (!data || !Array.isArray(data.videos)) {
        return res.status(400).json({ error: "Invalid playlist format. Expected { videos: [...], settings: {...} }" });
      }

      // Put overwrites when addRandomSuffix is false
      const blob = await put(PLAYLIST_PATH, JSON.stringify(data), {
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
