# 🚛 Liam TV

A personalized kids' video app with AI-powered discovery. Built for a toddler, runs on Android TV, tablets, and any browser.

**Live:** [liamtv.vercel.app](https://liamtv.vercel.app)

---

## Features

### 🚛 Liam TV Auto-Play (AI Discovery Mode)
The killer feature. Tap the "Liam TV" button on the home screen and it:
1. Builds a taste profile from all saved playlists + watch history
2. Uses Claude AI to generate targeted YouTube search queries
3. Plays matching kid-safe videos one after another
4. Learns over time — every video watched 10+ seconds is saved to a persistent history playlist
5. Auto-advances between videos; pauses with "Still watching?" after 5 auto-plays

### 📋 Multi-Playlist Management
- Create multiple playlists (Monster Trucks, Lego Cars, etc.)
- AI auto-generates playlist names from video content
- YouTube search + AI-powered smart search built into the manager
- Add/remove/reorder videos
- Both TV player and phone editor sync to the same server-side storage

### 🌙 Sleep Timer
- 10/20/30/45/60/90 minute options
- Screen gradually dims and volume fades over the last 50% (min 5 minutes)
- Ends with a goodnight screen and spoken "Спокойной ночи!" (Russian lullaby)
- Any keypress wakes it up

### 📺 TV Remote Compatible
- D-pad navigation for Android TV
- Pause overlay with pill-style buttons (manage playlist, prev/next, sleep timer, home)
- Keyboard shortcuts for all controls

---

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Android TV  │────▶│  Vercel (Web)    │────▶│  Vercel Blob    │
│  / Browser   │     │  tv-player.html  │     │  playlists/*.json│
│  / Tablet    │     │  API routes      │     └─────────────────┘
└─────────────┘     │                  │     ┌─────────────────┐
                     │  /api/playlist   │────▶│  YouTube API    │
                     │  /api/playlists  │     └─────────────────┘
                     │  /api/youtube    │     ┌─────────────────┐
                     │  /api/anthropic  │────▶│  Claude API     │
                     └──────────────────┘     └─────────────────┘
```

### Frontend
| File | Purpose |
|------|---------|
| `tv-player.html` | Main app — home screen, player, playlist manager, all overlays |
| `playlist-manager.html` | Standalone phone-friendly playlist editor |
| `sw.js` | Service worker (bypasses `/api/` routes) |
| `manifest.json` | PWA manifest |

### API Routes (`api/`)
| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/playlist?name=X` | GET, POST, DELETE | CRUD for individual playlists |
| `/api/playlists` | GET | List all playlists with metadata |
| `/api/youtube` | GET | Proxied YouTube Data API v3 (safeSearch=strict) |
| `/api/anthropic` | POST | Proxied Claude API for AI search and playlist naming |

### Storage
- **Vercel Blob** — each playlist stored as `playlists/{name}.json`
- `_liamtv-history` — internal playlist tracking Liam TV auto-play history (hidden from UI)
- Playlists prefixed with `_` are hidden from the home screen

### Android App (`android/`)
- WebView wrapper loading `https://liamtv.vercel.app/tv-player.html`
- `LiamTV` JavaScript interface for native exit (`LiamTV.exit()` → `finish()`)
- APK built automatically via GitHub Actions when `android/**` files change
- Web changes take effect immediately — no new APK needed

---

## Playlist JSON Format

```json
{
  "videos": [
    {
      "id": "youtube-video-id",
      "title": "Video Title",
      "channel": "Channel Name",
      "thumb": "https://i.ytimg.com/vi/{id}/mqdefault.jpg"
    }
  ],
  "settings": {
    "channelName": "Monster Trucks 🚛",
    "playOrder": "sequence",
    "sleepTimer": 30
  }
}
```

---

## Liam TV Auto-Play Flow

```
startLiamTV()
├── Fetch all playlists from /api/playlists
├── Load each playlist's videos → build taste profile
├── Load _liamtv-history → add to taste profile
└── liamTVNext()
    ├── Sample 8 random videos from taste profile
    ├── Send to Claude: "generate a YouTube search query for a 3-year-old"
    ├── YouTube search (safeSearch=strict, maxResults=10)
    ├── Pick first unwatched video
    ├── Play it
    ├── Start 10-second watch timer
    └── On video end:
        ├── Save to _liamtv-history (if watched 10+ seconds)
        ├── Increment auto-advance counter
        ├── If counter < 5 → liamTVNext()
        └── If counter >= 5 → "Still watching?" screen
```

**User pressing Next manually** resets the auto-advance counter (proves they're engaged).

---

## Environment Variables (Vercel)

| Variable | Purpose |
|----------|---------|
| `YOUTUBE_API_KEY` | YouTube Data API v3 key |
| `ANTHROPIC_API_KEY` | Claude API key |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob store access token |

---

## Development

### Local Setup
```bash
git clone https://github.com/ud4090v/liamtv.git
cd liamtv
npm install
vercel dev
```

### Deploy
```bash
vercel --prod
```

### Build APK
APK builds automatically via GitHub Actions on push when `android/**` files change.
Manual: import `android/` into Android Studio and build.

---

## Keyboard / Remote Controls

### During Playback
| Key | Action |
|-----|--------|
| Click / Tap / Space | Pause → show overlay |
| Escape | Open legacy menu |
| ← / → | Prev / Next video |

### Pause Overlay
| Button | Action |
|--------|--------|
| ▶ Play | Resume playback |
| ❮ / ❯ | Previous / Next video |
| 📋 Manage Playlist | Open playlist manager |
| 🌙 Sleep Timer | Set sleep timer |
| 🏠 Home | Return to home screen |

### Home Screen
| Button | Action |
|--------|--------|
| 🚛 Liam TV | Start AI auto-play discovery |
| ▶ {Playlist} | Play a saved playlist |
| + New Playlist | Create and populate a new playlist |
| ✕ Exit | Close the app |

---

## Legacy Components

The repo contains legacy Roku channel files (`roku-channel/`, `stream-api/`) from an earlier architecture that used yt-dlp on a server to proxy YouTube streams to a BrightScript Roku channel. This approach is deprecated — yt-dlp is blocked by YouTube bot protection on servers.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v1.5 | 2026-03-12 | Multi-playlist, AI auto-play, home screen, Exit JS interface |
| v1.4 | 2026-03-12 | Liam TV rename, server-side playlist, built-in manager, pause overlay |
| v1.3 | 2026-03-12 | Netlify → Vercel migration |
| v1.2 | 2026-03-11 | Original Roku + web hybrid |

---

## License

Private family project. Not for distribution.
