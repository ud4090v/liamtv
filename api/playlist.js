import { put, head, del } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();

  const name = (req.query.name || 'default').replace(/[^a-zA-Z0-9_-]/g, '');
  const path = `playlists/${name}.json`;
  const defaultData = { videos: [], settings: { channelName: name, playOrder: 'sequence', sleepTimer: 30 } };

  if (req.method === "GET") {
    try {
      const meta = await head(path).catch(() => null);
      if (!meta) return res.status(200).json(defaultData);
      const response = await fetch(meta.url + '?t=' + Date.now());
      if (!response.ok) return res.status(200).json(defaultData);
      const data = await response.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(200).json(defaultData);
    }
  }

  if (req.method === "POST") {
    try {
      const data = req.body;
      if (!data || !Array.isArray(data.videos)) {
        return res.status(400).json({ error: "Invalid format. Expected { videos: [...], settings: {...} }" });
      }
      const blob = await put(path, JSON.stringify(data), {
        contentType: 'application/json',
        access: 'public',
        addRandomSuffix: false,
      });
      return res.status(200).json({ ok: true, url: blob.url, name, count: data.videos.length });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "DELETE") {
    try {
      const meta = await head(path).catch(() => null);
      if (meta) await del(meta.url);
      return res.status(200).json({ ok: true, deleted: name });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
