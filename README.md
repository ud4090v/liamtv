# 🚛 Liam TV

A personalized, parent-curated kids' video app with AI-powered discovery and intentional curation. Built for a toddler — runs on Android TV, tablets, and any browser.

**Live:** [liamtv.vercel.app](https://liamtv.vercel.app)

---

## Philosophy

Most kids video platforms (YouTube Kids, TikTok) optimize for **engagement** — they learn what keeps a child watching and serve more of the same. This creates narrow rabbit holes, overstimulation, and passive consumption engineered to maximize screen time.

Liam TV is designed around the opposite principle: **intentional curation over algorithmic engagement**.

- Parents set the taste, not the algorithm
- Known-good content rotates evenly before new content is introduced
- New content is discovered broadly — breadth over confirmation bias
- A parent direction steers discovery toward developmental goals
- Content is screened by AI against a comprehensive safety baseline before Liam ever sees it

---

## Features

### 🚛 Liam TV — AI Discovery Mode (Live Play)
Continuous, curated video stream. No fixed playlist — AI discovers and queues content dynamically.

- Builds a taste profile from all saved playlists + watch history
- Pre-fetches a buffer of 10 videos so there's **zero wait between videos**
- Background refill triggers when buffer drops to 5 — Liam never waits
- Balanced queue: rotation (least-watched history first) + discovery (new content)
- Pauses with "Still watching?" check after 5 auto-advances

### 📋 Multi-Playlist Management
- Create multiple named playlists (Monster Trucks, Lego Cars, etc.)
- AI auto-generates playlist names from video content
- Add videos by pasting YouTube URLs — screened against content filters before adding
- AI-powered search: describe what you want, Claude generates queries, results are screened
- Reorder, remove, move videos up/down

### 🚫 Content Filtering (Two Layers)
**Global baseline** (always active, cannot be disabled) — blocks:
- Reaction content, fail/pain compilations, challenge & prank videos
- Clickbait formats (GONE WRONG, EXTREME, YOU WON'T BELIEVE, etc.)
- Influencer drama, unboxing/haul content
- Elsagate-style content (adults imitating cartoon characters in low-quality skits)
- Overstimulation/brain-rot rapid-cut videos
- Top-N algorithm bait, engagement manipulation, animals in distress

**Per-playlist filters** (optional) — add your own rules on top:
> "no animated content, only real vehicles" or "no animals at all, just machines"

### 🎯 Intentional Curation Model
Configured per-playlist in Settings:

| Setting | Default | Purpose |
|---------|---------|---------|
| **Min Watch Count** | 3 | Rotate all history videos this many times before going to full discovery |
| **Discovery Ratio** | 0.4 | Fraction of each batch that is new content (0.1–0.9) |
| **Skip Threshold** | 3 | Remove a video from history after this many quick skips |

**Rotation logic:** Least-watched history videos are served first (watchCount ASC), shuffled within equal-count groups to avoid repeating the same order. Once all history has hit `minWatchCount`, the next batch is full discovery.

**Skip tracking:** If Liam skips a video in under 10 seconds `skipThreshold` times, it's pruned from history. A real watch (≥10s) resets the skip streak.

### 🧭 Parent Direction
A free-text field that steers ALL new video discovery toward a developmental goal.

> "Focus on improving math and counting skills"
> "Encourage curiosity about the natural world"
> "Build vocabulary and early reading readiness"

When set, Claude finds content that satisfies **both** — something Liam will enjoy AND that serves the parent's intent. Taste and goal intersect, neither is ignored.

Built-in example cards let parents tap-to-use common directions.

### 🌙 Sleep Timer
- 10/20/30/45/60/90 minute options
- Screen gradually dims and volume fades over the last 50% (min 5 minutes)
- Ends with a goodnight screen
- Any keypress wakes it up

### 📺 TV Remote Compatible
- D-pad navigation for Android TV
- Pause overlay with pill-style controls (playlist, prev/next, sleep timer, home)
- Keyboard shortcuts for all controls

---

## Architecture

```
┌──────────────────────┐
│  Android TV / Tablet │
│  / Browser / PWA     │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────────────────────┐
│  Vercel (Frontend)                               │
│                                                  │
│  tv-player.html       — player + home screen     │
│  playlist-manager.html — parent editor UI        │
└──────────┬───────────────────────────────────────┘
           │  /api/videos/* (thin API client calls only)
           ▼
┌──────────────────────────────────────────────────┐
│  Vercel (API Layer)                              │
│                                                  │
│  api/_lib.js          — shared utilities         │
│  api/videos/search    — prompt → videos[]        │
│  api/videos/screen    — filter existing videos   │
│  api/videos/meta      — YouTube video metadata   │
│  api/videos/grow      — playlist auto-grow       │
│  api/videos/next      — single next video pick   │
│  api/videos/fill-queue — balanced queue batch    │
│  api/videos/name      — AI playlist naming       │
│  api/playlist         — blob CRUD                │
│  api/playlists        — list all playlists       │
└──────┬───────────────────────┬───────────────────┘
       │                       │
       ▼                       ▼
┌─────────────┐       ┌─────────────────┐
│ Vercel Blob │       │  External APIs  │
│ playlists/  │       │  YouTube Data   │
│   *.json    │       │  Anthropic      │
└─────────────┘       └─────────────────┘
```

### Design Principle: Dumb Frontend, Smart API
The frontend (`tv-player.html`, `playlist-manager.html`) contains **zero AI logic**. No prompts, no model names, no filter rules, no YouTube API calls. It only calls `/api/videos/*` endpoints with user inputs.

All intelligence lives in the API layer:
- Content filter rules → `api/_lib.js`
- Claude prompts → individual endpoint files
- YouTube search parameters → `api/_lib.js`
- Model selection → `api/_lib.js`

**To update any content rule, model, or prompt:** change `api/_lib.js` or the relevant endpoint. Frontend picks it up immediately on next deploy.

---

## API Reference

### Shared Library: `api/_lib.js`

| Export | Type | Purpose |
|--------|------|---------|
| `GLOBAL_CONTENT_FILTERS` | string | Master content filter ruleset (always applied) |
| `ANTHROPIC_MODEL_SMART` | string | `claude-sonnet-4-20250514` — used for discovery/search |
| `ANTHROPIC_MODEL_FAST` | string | `claude-haiku-4-20250514` — used for screening |
| `callClaude({model, system, userMessage, maxTokens})` | async fn | Claude API wrapper |
| `ytSearch({query, maxResults})` | async fn | YouTube search, returns `[{id, title, channel, thumb}]` |
| `ytVideoMeta(id)` | async fn | YouTube video metadata |
| `filterVideos(videos, playlistFilters)` | async fn | Batch screen via Haiku, fail-open |
| `screenVideo(title, channel, playlistFilters)` | async fn | Single video screen with reason |
| `buildFilters(playlistFilters)` | fn | Combines global + playlist-specific rules |
| `dedupe(videos)` | fn | Deduplicate by video id |
| `cors(res)` | fn | Set CORS headers |

---

### `POST /api/videos/search`
AI-powered video search. Claude generates queries, YouTube searches, results are filtered.

**Request:**
```json
{
  "prompt": "monster trucks for toddlers",
  "playlistFilters": "only real vehicles, no cartoons",
  "maxResults": 10
}
```

**Response:**
```json
{
  "videos": [{ "id": "...", "title": "...", "channel": "...", "thumb": "..." }],
  "filtered": 2
}
```

**Flow:** Claude → 4–6 search queries → YouTube (parallel) → dedupe → `filterVideos()` → trim to limit

---

### `POST /api/videos/screen`
Screen a list of videos against content rules. Single video returns `isBlocked` + `reason`. Batch returns `passed` / `blocked` arrays.

**Request:**
```json
{
  "videos": [{ "id": "...", "title": "...", "channel": "..." }],
  "playlistFilters": ""
}
```

**Response (single video):**
```json
{ "passed": [...], "blocked": [...], "isBlocked": true, "reason": "reaction video" }
```

**Response (batch):**
```json
{ "passed": [...], "blocked": [...] }
```

Fail-open: if Claude call fails, all videos pass through.

---

### `GET /api/videos/meta?id=VIDEO_ID`
Fetch YouTube video metadata.

**Response:**
```json
{ "id": "abc123", "title": "...", "channel": "...", "thumb": "https://..." }
```

---

### `POST /api/videos/fill-queue`
The core LiamTV queue-building endpoint. Returns a balanced batch of rotation + discovery videos.

**Request:**
```json
{
  "history": [{ "id": "...", "title": "...", "channel": "...", "thumb": "...", "watchCount": 2, "skipCount": 0, "lastWatched": 1234567890 }],
  "avoidIds": ["id1", "id2"],
  "playlistFilters": "",
  "parentDirection": "Focus on math and counting skills",
  "targetCount": 10,
  "minWatchCount": 3,
  "discoveryRatio": 0.4
}
```

**Response:**
```json
{
  "videos": [{ "id": "...", "_source": "rotation" }, { "id": "...", "_source": "discovery" }],
  "allRotated": false,
  "filtered": 1
}
```

**Queue composition logic:**
```
rotationSlots = floor(targetCount × (1 - discoveryRatio))  →  6 slots
discoverySlots = targetCount - rotationSlots               →  4 slots

Rotation:
  eligibleForRotation = history where watchCount < minWatchCount AND id not in avoidIds
  Sort by watchCount ASC, then lastWatched ASC
  Shuffle within equal-watchCount groups (avoids same order every time)

Discovery:
  Build broad taste sample (3-tertile sampling across full history)
  Claude generates queries informed by parentDirection + taste sample
  YouTube search → dedupe → filterVideos() → trim to discoverySlots

Final batch: rotation + discovery interleaved (random shuffle)

If allRotated (all history ≥ minWatchCount): full batch is discovery
```

---

### `POST /api/videos/next`
Pick the next video for LiamTV. Generates 6 diverse queries in one Claude call, tries each until a safe unplayed video is found. Guarantees a result (6 queries × 10 YouTube results = 60 candidates).

**Request:**
```json
{
  "taste": [{ "title": "...", "channel": "..." }],
  "played": ["id1", "id2"],
  "playlistFilters": "",
  "sessionSize": 5
}
```

**Response:**
```json
{ "video": { "id": "...", "title": "...", "channel": "...", "thumb": "..." }, "query": "...", "reason": "trucks" }
```

Soft-reset: if `played` has >80 entries, treat as empty (session runs indefinitely).

---

### `POST /api/videos/grow`
Auto-grow a named playlist. Generates search queries from playlist context, fetches, filters, generates summaries.

**Request:**
```json
{
  "playlistName": "monster-trucks",
  "channelTitle": "Monster Trucks 🚛",
  "existingIds": ["id1", "id2"],
  "searchHistory": ["monster truck jumps", "big trucks for kids"],
  "topWatched": [{ "title": "...", "channel": "...", "weight": 3 }],
  "playlistFilters": "",
  "targetCount": 8
}
```

**Response:**
```json
{
  "videos": [{ "id": "...", "title": "...", "channel": "...", "thumb": "...", "summary": "big trucks jump over ramps", "weight": 0 }],
  "filtered": 2
}
```

---

### `POST /api/videos/name`
Generate an AI playlist name from video titles.

**Request:** `{ "titles": ["Video Title 1", "Video Title 2"] }`

**Response:** `{ "name": "monster-trucks", "title": "Monster Trucks 🚛" }`

---

### `GET /api/playlists`
List all playlists. Internal playlists (prefixed `_`) are included in the raw response but filtered by the UI.

**Response:**
```json
{
  "playlists": [
    { "name": "monster-trucks", "title": "Monster Trucks 🚛", "videoCount": 12, "thumb": "https://..." }
  ]
}
```

---

### `GET|POST|DELETE /api/playlist?name=X`
CRUD for individual playlists stored in Vercel Blob.

| Method | Body | Action |
|--------|------|--------|
| GET | — | Load playlist `{videos, settings}` |
| POST | `{videos, settings}` | Save/overwrite playlist |
| DELETE | — | Delete playlist |

---

## Data Schemas

### Playlist Blob (`playlists/{name}.json`)
```json
{
  "videos": [
    {
      "id": "youtube-video-id",
      "title": "Video Title",
      "channel": "Channel Name",
      "thumb": "https://i.ytimg.com/vi/{id}/mqdefault.jpg",
      "weight": 3,
      "summary": "big trucks jump over ramps"
    }
  ],
  "settings": {
    "channelName": "Monster Trucks 🚛",
    "playOrder": "sequence | shuffle | repeat1",
    "sleepTimer": 30,
    "contentFilters": "no animated content, only real vehicles",
    "parentDirection": "Focus on improving math and counting skills",
    "minWatchCount": 3,
    "discoveryRatio": 0.4,
    "skipThreshold": 3,
    "prompts": ["monster truck jumps", "big trucks for kids"]
  }
}
```

### LiamTV History Blob (`playlists/_liamtv-history.json`)
Same structure as playlist, but `videos` carry enriched watch tracking fields:
```json
{
  "videos": [
    {
      "id": "youtube-video-id",
      "title": "...",
      "channel": "...",
      "thumb": "...",
      "watchCount": 3,
      "skipCount": 0,
      "lastWatched": 1710324000000
    }
  ],
  "settings": { "channelName": "Liam TV History", ... }
}
```

- `watchCount` — times watched ≥10 seconds (or to completion). Resets skip streak.
- `skipCount` — consecutive times skipped in <10 seconds. Resets to 0 on real watch.
- `lastWatched` — Unix ms timestamp of last watch

Video pruned from history when `skipCount >= skipThreshold` (default 3).

---

## LiamTV Auto-Play Flow

```
startLiamTV()
├── Load all playlists → build taste array [{title, channel}]
├── Load _liamtv-history → populate liamTVHistory[] (with watchCount/skipCount)
├── Add history titles to taste array
└── liamTVFillQueue() [BLOCKING — fills 10 videos before first play]
    └── POST /api/videos/fill-queue
        ├── rotationSlots: least-watched history videos
        └── discoverySlots: Claude queries (steered by parentDirection) → YouTube → filter
    └── liamTVNext() [plays first video from queue]

On video end / user skip:
├── watchedMs = now - liamTVWatchStart
├── ≥10s → updateLiamTVHistory(video, 'watch') [watchCount++, skipCount reset]
├── <10s  → updateLiamTVHistory(video, 'skip')  [skipCount++, prune if ≥ threshold]
├── If queue.length <= 5 → liamTVFillQueue() [NON-BLOCKING background refill]
└── liamTVNext() [dequeue next video — instant, no API call]

Queue state:
  liamTVQueue[]   — pre-fetched video objects
  liamTVQueued    — Set of IDs in buffer (not yet played)
  liamTVPlayed    — Set of IDs actually watched this session
  avoidIds = [...liamTVPlayed, ...liamTVQueued] passed to fill-queue API
```

---

## AI Cost Estimate (daily household use)

Assumptions: 3 hrs/day, ~22 videos, ~5 queue fills

| Model | Calls/day | Est. cost/day | Est. cost/month |
|-------|-----------|--------------|-----------------|
| Sonnet 4.5 (discovery) | ~6 | ~$0.036 | ~$1.10 |
| Haiku 4.5 (screening) | ~7 | ~$0.014 | ~$0.42 |
| YouTube Data API | ~25 searches | $0 (free tier) | $0 |
| Vercel Blob | minimal | $0 (free tier) | $0 |
| **Total** | | **~$0.05/day** | **~$1.50/mo** |

---

## Frontend Files

| File | Purpose |
|------|---------|
| `tv-player.html` | Main app — home screen, YouTube player, HUD, pause overlay, playlist manager panel, Liam TV mode |
| `playlist-manager.html` | Standalone parent editor — playlist grid home, editor with Videos/AI Search/Settings tabs |
| `sw.js` | Service worker (caches static assets, bypasses `/api/` routes) |
| `manifest.json` | PWA manifest (Add to Home Screen on iOS/Android) |

### API Client Pattern (both frontend files)
```javascript
// All AI/YouTube logic is server-side. Frontend only sends user inputs.
async function apiSearchVideos(prompt, playlistFilters, maxResults) {
  const resp = await fetch('/api/videos/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, playlistFilters, maxResults }),
  });
  return resp.json(); // { videos[], filtered }
}
```

---

## Android App

WebView wrapper loading `https://liamtv.vercel.app/tv-player.html`.

- `LiamTV` JavaScript interface: `LiamTV.exit()` → calls `Activity.finish()`
- APK builds via GitHub Actions on push when `android/**` changes
- Web changes are instant — no new APK needed for feature updates

---

## Environment Variables (Vercel)

| Variable | Purpose |
|----------|---------|
| `YOUTUBE_API_KEY` | YouTube Data API v3 |
| `ANTHROPIC_API_KEY` | Claude API (Sonnet + Haiku) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob store |

---

## Development

```bash
git clone https://github.com/ud4090v/liamtv.git
cd liamtv
npm install
vercel dev        # runs locally with real Vercel Blob + env vars
```

```bash
vercel --prod     # deploy to production
```

---

## Keyboard / Remote Controls

### During Playback
| Key | Action |
|-----|--------|
| Click / Tap / Space | Toggle pause overlay |
| ← / → | Prev / Next video |
| Escape | Home screen |

### Pause Overlay
| Button | Action |
|--------|--------|
| ▶ Play | Resume |
| ❮ / ❯ | Prev / Next |
| 📋 Manage | Open playlist manager |
| 🌙 Sleep | Set sleep timer |
| 🏠 Home | Home screen |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| v2.0 | 2026-03-13 | Full API layer refactor, content filter baseline, curation model, queue buffer, parent direction, anti-rabbit-hole rotation |
| v1.5 | 2026-03-12 | Multi-playlist, AI auto-play, home screen, Android exit interface |
| v1.4 | 2026-03-12 | Liam TV rename, server-side playlist, built-in manager |
| v1.3 | 2026-03-12 | Netlify → Vercel migration |
| v1.2 | 2026-03-11 | Original Roku + web hybrid (deprecated) |

---

## Legacy Components

`roku-channel/` and `stream-api/` are from an earlier architecture using yt-dlp to proxy YouTube streams to a BrightScript Roku channel. Deprecated — yt-dlp is blocked by YouTube bot protection on servers.

---

*Private family project. Not for distribution.*
