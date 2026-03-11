# LiamTV Roku Build

## What to build

Two things:

### 1. Stream API (runs on this server, Saxa)
- File: `/root/.openclaw/workspace/codex-sessions/liamtv-roku/stream-api/server.js`
- Express.js server on port 3456
- Uses yt-dlp (already installed at `/usr/local/bin/yt-dlp`) to extract stream URLs
- Endpoints:
  - `GET /stream?id=YOUTUBE_VIDEO_ID` → returns JSON `{ url: "...", title: "...", duration: N }`
    - Use yt-dlp to get best mp4/m4a merged stream, or best video+audio available
    - yt-dlp command: `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --get-url --get-title "https://youtube.com/watch?v=ID"`
    - Actually use: `yt-dlp -j "https://youtube.com/watch?v=ID"` to get JSON, extract url from formats
    - Return the direct stream URL that Roku can play
  - `GET /health` → `{ ok: true }`
- Add simple API key auth: check header `X-API-Key` against env var `LIAMTV_API_KEY`
- package.json with start script
- README with setup instructions

### 2. Roku BrightScript Channel
- Directory: `/root/.openclaw/workspace/codex-sessions/liamtv-roku/roku-channel/`
- Standard Roku channel structure ready to zip and sideload:
  ```
  roku-channel/
  ├── manifest
  ├── source/
  │   └── main.brs
  ├── components/
  │   ├── MainScene.xml
  │   ├── MainScene.brs
  │   ├── VideoPlayer.xml
  │   └── VideoPlayer.brs
  └── images/
      └── (placeholder splash/icon - simple text files describing what images are needed)
  ```

**Manifest content:**
```
title=Monster Truck TV
major_version=1
minor_version=0
build_version=1
ui_resolution=FHD
splash_screen_fhd=pkg:/images/splash_fhd.jpg
splash_color=#000000
splash_min_time=0
bs_libs_required=roku_ads_lib
```

**Channel behavior:**
- On launch: show a simple "Monster Truck TV 🚛" splash screen (black bg, yellow text)
- Load playlist from a hardcoded URL: `https://liamtv.netlify.app/api/playlist` (we'll set this up later — for now just use a hardcoded demo playlist of 5 YouTube video IDs in the BrightScript)
- For each video: call `https://saxa.yourdomain.com:3456/stream?id=VIDEO_ID` (use a placeholder URL constant `STREAM_API_URL` at the top of main.brs that's easy to change)
- Play videos sequentially in a loop using Roku's native Video node
- Remote control:
  - OK/Play → pause/resume
  - Right arrow → next video
  - Left arrow → previous video  
  - Back → exit channel
- Show video title overlay for 3 seconds when video starts
- Simple, clean — no complex menus needed for v1

**Demo playlist to hardcode (5 video IDs):**
```
E6ZaFdwpFhk
HdXYPGmzGlk  
G9eVF2jFHNY
dQw4w9WgXcQ
jNQXAC9IVRw
```

**Important BrightScript notes:**
- Use `roSGScreen` + SceneGraph (not legacy BrightScript components)
- Video playback via `Video` node with `content` set to `roSGNode("ContentNode")`
- ContentNode needs `url` field set to the stream URL
- HTTP requests via `roUrlTransfer` in Task nodes (not in main thread)
- All network calls must be in Task nodes

### 3. Systemd service file
- File: `stream-api/liamtv-stream.service`
- Systemd unit to run the Express server on startup
- User: root, WorkingDirectory: `/root/.openclaw/workspace/codex-sessions/liamtv-roku/stream-api`
- Environment: `LIAMTV_API_KEY=liam2026` (placeholder, easy to change)

### 4. README.md (top level)
Full setup instructions:
1. How to install dependencies (`npm install` in stream-api/)
2. How to install and start the systemd service
3. How to enable Roku developer mode (the key sequence)
4. How to zip roku-channel/ and sideload via Roku's web interface
5. What to change before deploying (API URL, API key)

## Completion
When done, run:
openclaw system event --text "Done: LiamTV Roku channel + stream API built" --mode now
