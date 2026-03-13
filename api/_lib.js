// ─── Shared utilities for LiamTV API layer ───

export const ANTHROPIC_MODEL_SMART = 'claude-sonnet-4-20250514';
export const ANTHROPIC_MODEL_FAST  = 'claude-haiku-4-20250514';

// ── Global content filter baseline ──
// All discovery paths (search, grow, auto-play) apply this before returning videos to the client.
export const GLOBAL_CONTENT_FILTERS = `
REACTION CONTENT: videos where the main content is a person or group watching and reacting to other videos; reaction channels; commentary channels whose primary format is reacting to other content

FAIL & PAIN CONTENT: fail compilations, people or animals getting hurt, painful accidents filmed for laughs, epic fail videos, blooper reels involving injury or humiliation

CHALLENGE & PRANK VIDEOS: dangerous challenge trends, pranks played on people, hidden camera pranks, fake scare pranks, psychological manipulation framed as humor

CLICKBAIT FORMATS: titles containing "GONE WRONG", "EXTREME", "YOU WON'T BELIEVE", "GONE SEXUAL", "NOT CLICKBAIT", "I'M LEAVING", "WE NEED TO TALK", "EXPOSED", "SHOCKING"; videos with exaggerated shock/crying/screaming thumbnail faces with arrows or circles pointing at things

DRAMA & BEEF: creator drama, "responding to hate", "calling out", feuds between influencers, emotional manipulation ("I have something to tell you", "I'm quitting YouTube")

UNBOXING & HAUL CONTENT: unboxing luxury items, toy haul videos from influencer channels, mystery box videos, sponsor-disguised content presented as entertainment

ELSAGATE-STYLE CONTENT: adults dressed as or imitating cartoon characters (Spider-Man, Elsa, Peppa Pig, etc.) in live action skits not made by the IP owner; fast-cut nursery rhyme videos with violent or disturbing themes disguised as kids content; videos that superficially look like kids content but contain adult or disturbing themes

OVERSTIMULATION CONTENT: videos with relentless rapid-fire cuts every 1-2 seconds, constant screaming/yelling presenters, extreme sound effects used to keep toddlers in a trance-like state; brain rot short-form content repurposed as long videos

INFLUENCER PROMOTION: YouTubers promoting their own merch, "check the description", channels that exist primarily to sell products to children or parents

TOP-N ALGORITHM BAIT: "Top 10 scariest", "Top 5 most dangerous", countdown format videos designed purely for algorithm performance with no educational or entertainment value

ENGAGEMENT MANIPULATION: videos ending with "comment below if you want part 2", "smash the like button or this happens", manipulation of children's behavior through fake consequences

ANIMALS IN DISTRESS: videos framing animal suffering, animal fights, or animals in dangerous situations as entertaining content, even if presented as funny
`.trim();

// Build combined filter string for prompts
export function buildFilters(playlistFilters) {
  const parts = ['=== GLOBAL RULES (always apply) ===\n' + GLOBAL_CONTENT_FILTERS];
  if (playlistFilters && playlistFilters.trim()) {
    parts.push('=== ADDITIONAL PLAYLIST-SPECIFIC RULES ===\n' + playlistFilters.trim());
  }
  return parts.join('\n\n');
}

// ── Claude helper ──
export async function callClaude({ model, system, userMessage, maxTokens }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error ${resp.status}`);
  }
  const data = await resp.json();
  return data.content[0].text;
}

// ── YouTube search helper ──
export async function ytSearch({ query, maxResults = 10 }) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY not configured');
  const params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    safeSearch: 'strict',
    videoEmbeddable: 'true',
    maxResults: String(maxResults),
    key: apiKey,
  });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
  if (!resp.ok) throw new Error(`YouTube API error ${resp.status}`);
  const data = await resp.json();
  return (data.items || []).map(item => ({
    id: item.id.videoId,
    title: item.snippet.title,
    channel: item.snippet.channelTitle,
    thumb: item.snippet.thumbnails?.medium?.url || `https://img.youtube.com/vi/${item.id.videoId}/mqdefault.jpg`,
  }));
}

// ── YouTube video meta helper ──
export async function ytVideoMeta(id) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new Error('YOUTUBE_API_KEY not configured');
  const params = new URLSearchParams({ part: 'snippet', id, key: apiKey });
  const resp = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
  if (!resp.ok) throw new Error(`YouTube API error ${resp.status}`);
  const data = await resp.json();
  if (!data.items?.[0]) return { id, title: `Video ${id}`, channel: 'YouTube', thumb: `https://img.youtube.com/vi/${id}/mqdefault.jpg` };
  const s = data.items[0].snippet;
  return { id, title: s.title, channel: s.channelTitle, thumb: s.thumbnails?.medium?.url || `https://img.youtube.com/vi/${id}/mqdefault.jpg` };
}

// ── Batch filter: returns only videos that pass all rules ──
// Sends one Claude Haiku call for the whole batch. Fail-open.
export async function filterVideos(videos, playlistFilters) {
  if (!videos.length) return videos;
  const filterBlock = buildFilters(playlistFilters);
  const list = videos.map((v, i) => `${i + 1}. [${v.channel}] ${v.title}`).join('\n');
  try {
    const raw = await callClaude({
      model: ANTHROPIC_MODEL_FAST,
      maxTokens: 200,
      system: 'You screen YouTube videos for a parent protecting a 3-year-old. Given a numbered list of videos and content filter rules, return ONLY a JSON array of the 1-based numbers that should be BLOCKED. Example: [2,5]. If none blocked, return []. No other text.',
      userMessage: filterBlock + '\n\nVideos:\n' + list + '\n\nWhich numbers are blocked? Return JSON array only.',
    });
    const blocked = new Set(JSON.parse(raw.replace(/```json|```/g, '').trim()).map(n => n - 1));
    return videos.filter((_, i) => !blocked.has(i));
  } catch (e) {
    console.warn('filterVideos failed (fail-open):', e.message);
    return videos;
  }
}

// ── Screen single video ──
export async function screenVideo(title, channel, playlistFilters) {
  const filterBlock = buildFilters(playlistFilters);
  try {
    const raw = await callClaude({
      model: ANTHROPIC_MODEL_FAST,
      maxTokens: 80,
      system: 'You screen YouTube videos for a parent protecting a 3-year-old. Reply with JSON only: {"blocked": true/false, "reason": "short reason or empty string"}. No other text.',
      userMessage: filterBlock + '\n\nVideo title: ' + title + '\nChannel: ' + channel + '\n\nIs this video blocked by any of the above rules?',
    });
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return { blocked: !!parsed.blocked, reason: parsed.reason || '' };
  } catch (e) {
    return { blocked: false, reason: '' }; // fail-open
  }
}

// ── Deduplicate by video id ──
export function dedupe(videos) {
  const seen = new Set();
  return videos.filter(v => { if (seen.has(v.id)) return false; seen.add(v.id); return true; });
}

// ── CORS helper ──
export function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}
