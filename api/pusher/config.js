// GET /api/pusher/config — returns public Pusher credentials for client-side subscription
module.exports = (req, res) => {
  res.json({
    key: process.env.PUSHER_KEY || null,
    cluster: process.env.PUSHER_CLUSTER || null,
  });
};
