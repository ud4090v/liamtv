export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method Not Allowed" });

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "YOUTUBE_API_KEY not configured" });

  try {
    const queryParams = { ...req.query };
    const endpoint = queryParams.endpoint || "search";
    delete queryParams.endpoint;

    const params = new URLSearchParams(queryParams);
    params.set("key", apiKey);

    const url = `https://www.googleapis.com/youtube/v3/${endpoint}?${params.toString()}`;
    const response = await fetch(url);
    const data = await response.json();

    return res.status(response.ok ? 200 : response.status).json(
      response.ok ? data : { error: data.error?.message || "YouTube API error", detail: data }
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
