// POST /api/pusher/trigger — sends refresh event to TV player via Pusher
// Body: { type: "gentle" | "forced" }
const Pusher = require('pusher');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { type } = req.body || {};
  if (!type || !['gentle', 'forced'].includes(type)) {
    return res.status(400).json({ error: 'Invalid type. Must be "gentle" or "forced".' });
  }

  if (!process.env.PUSHER_APP_ID || !process.env.PUSHER_KEY || !process.env.PUSHER_SECRET) {
    return res.status(503).json({ error: 'Pusher not configured. Set PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER env vars.' });
  }

  const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER || 'us2',
    useTLS: true,
  });

  try {
    await pusher.trigger('liamtv-main', 'refresh', { type, timestamp: Date.now() });
    return res.status(200).json({ ok: true, type });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
