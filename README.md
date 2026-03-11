# 🚛 Monster Truck TV — Roku Channel

A native Roku channel for Liam. Plays YouTube monster truck videos via a stream proxy API running on Saxa.

---

## Architecture

```
Roku TV → Stream API on Saxa (port 3456) → yt-dlp → YouTube direct stream
```

- `roku-channel/` — BrightScript channel (zip and sideload to Roku)
- `stream-api/`   — Express.js proxy server (runs on Saxa)

---

## Step 1: Start the Stream API on Saxa

### Install systemd service (one-time)
```bash
cp stream-api/liamtv-stream.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable liamtv-stream
systemctl start liamtv-stream
```

### Verify it's running
```bash
systemctl status liamtv-stream
curl http://localhost:3456/health
```

### Change the API key (recommended)
Edit `/etc/systemd/system/liamtv-stream.service`, update `LIAMTV_API_KEY=yourkey`.
Then update `API_KEY` in `roku-channel/components/VideoPlayer.brs` to match.
Re-zip the channel after any BrightScript changes.

---

## Step 2: Enable Developer Mode on your Roku

1. On your Roku remote, press this exact sequence:
   **Home × 3, Up × 2, Right, Left, Right, Left, Right**
2. A dialog will appear — enable Developer Mode
3. Set a password (remember it!)
4. Note your Roku's IP address shown on screen (e.g. `192.168.1.45`)

---

## Step 3: Update the Stream API URL in the channel

Before sideloading, open `roku-channel/components/VideoPlayer.brs` and update line 6:

```brightscript
' Change this to your Saxa server's IP or domain
const STREAM_API_URL = "http://96.126.106.225:3456"
```

If Saxa is on your local network, use the local IP. If Roku is on a different network than Saxa, use Saxa's public IP (96.126.106.225) — make sure port 3456 is open in the firewall.

Then rebuild the zip:
```bash
cd roku-channel
python3 -c "import zipfile,os; z=zipfile.ZipFile('../liamtv-roku.zip','w',zipfile.ZIP_DEFLATED); [z.write(os.path.join(r,f),os.path.join(r,f)) for r,d,files in os.walk('.') for f in files]; z.close()"
```

---

## Step 4: Sideload to Roku

1. Open your browser and go to: `http://[ROKU-IP]` (e.g. `http://192.168.1.45`)
2. Log in with username `rokudev` and the password you set
3. Click **"Upload"** and select `liamtv-roku.zip`
4. Click **"Install"**
5. The channel launches automatically 🚛

---

## Remote Control

| Button | Action |
|--------|--------|
| ▶ Play/Pause | Pause / Resume |
| → Right arrow | Next video |
| ← Left arrow | Previous video |
| ↩ Back | Exit channel |

---

## Updating the Playlist

Edit the `PLAYLIST` array in `roku-channel/components/VideoPlayer.brs`:

```brightscript
const PLAYLIST = ["E6ZaFdwpFhk", "HdXYPGmzGlk", "G9eVF2jFHNY", "pM_GB5Sv02c", "_y2yXCWqTzg"]
```

Replace with any YouTube video IDs. Re-zip and re-sideload.

---

## Push channel to GitHub

The original repo is `ud4090v/liamtv`. To push updates:
```bash
cd /root/.openclaw/workspace/codex-sessions/liamtv-roku
git add -A && git commit -m "Add Roku channel + stream API"
git remote add origin https://github.com/ud4090v/liamtv.git  # if not already set
git push origin main
```
