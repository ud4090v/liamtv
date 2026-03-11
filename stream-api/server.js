const express = require('express');
const { execFile } = require('child_process');

const app     = express();
const PORT    = 3456;
const API_KEY = process.env.LIAMTV_API_KEY || 'liam2026';
const YTDLP   = '/usr/local/bin/yt-dlp';

// ── Auth middleware ───────────────────────────────────────────
app.use((req, res, next) => {
    if (req.path === '/health') return next();
    if (req.headers['x-api-key'] !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
});

// ── GET /health ───────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

// ── GET /stream?id=VIDEOID ────────────────────────────────────
app.get('/stream', (req, res) => {
    const videoId = req.query.id;
    if (!videoId || !/^[a-zA-Z0-9_-]{8,16}$/.test(videoId)) {
        return res.status(400).json({ error: 'Invalid video ID' });
    }

    const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Get full JSON metadata from yt-dlp
    // -f: best single-file mp4 stream (no separate audio/video merge needed — Roku can't merge)
    const args = [
        '-f', 'best[ext=mp4]/best',
        '--no-playlist',
        '-j',           // dump JSON
        '--no-warnings',
        ytUrl
    ];

    execFile(YTDLP, args, { timeout: 20000 }, (err, stdout, stderr) => {
        if (err) {
            console.error(`yt-dlp error for ${videoId}:`, stderr?.slice(0, 200));
            return res.status(500).json({ error: 'Failed to fetch stream' });
        }

        let data;
        try {
            data = JSON.parse(stdout);
        } catch (e) {
            return res.status(500).json({ error: 'Failed to parse yt-dlp output' });
        }

        // Find best mp4 format with both video+audio
        let streamUrl = null;
        if (data.formats && Array.isArray(data.formats)) {
            // Prefer formats with both acodec and vcodec, mp4 container
            const candidates = data.formats.filter(f =>
                f.url &&
                f.acodec && f.acodec !== 'none' &&
                f.vcodec && f.vcodec !== 'none' &&
                (f.ext === 'mp4' || f.container === 'mp4_dash')
            );
            if (candidates.length > 0) {
                // Pick highest resolution
                candidates.sort((a, b) => (b.height || 0) - (a.height || 0));
                streamUrl = candidates[0].url;
            }
        }

        // Fallback to url field directly
        if (!streamUrl) streamUrl = data.url;

        if (!streamUrl) {
            return res.status(500).json({ error: 'No playable stream found' });
        }

        res.json({
            url:      streamUrl,
            title:    data.title   || 'Monster Truck Video',
            duration: data.duration || 0,
            id:       videoId
        });
    });
});

app.listen(PORT, () => {
    console.log(`LiamTV Stream API running on port ${PORT}`);
});
