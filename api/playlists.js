import { list, head } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  try {
    const { blobs } = await list({ prefix: 'playlists/' });
    const playlists = [];
    for (const blob of blobs) {
      const name = blob.pathname.replace('playlists/', '').replace('.json', '');
      if (!name || name.startsWith('_')) continue;
      try {
        const response = await fetch(blob.url + '?t=' + Date.now());
        const data = await response.json();
        playlists.push({
          name,
          title: data.settings?.channelName || name,
          videoCount: data.videos?.length || 0,
          thumb: data.videos?.[0]?.thumb || null
        });
      } catch(e) {
        playlists.push({ name, title: name, videoCount: 0, thumb: null });
      }
    }
    return res.status(200).json({ playlists });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
