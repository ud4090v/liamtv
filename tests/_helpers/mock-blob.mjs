// tests/_helpers/mock-blob.mjs
// In-memory mock for @vercel/blob put/list used by fail-closed cache

const store = new Map(); // key -> { url, uploadedAt, content }

let callLog = [];

export function reset() {
  store.clear();
  callLog = [];
}

export function getCallLog() {
  return [...callLog];
}

export async function put(path, payload, options = {}) {
  callLog.push({ op: 'put', path, options });
  const ts = Date.now();
  const key = path;
  const url = `https://mock.blob.local/${key}?t=${ts}`;
  const entry = {
    url,
    uploadedAt: new Date(ts).toISOString(),
    content: typeof payload === 'string' ? payload : JSON.stringify(payload),
  };
  store.set(key, entry);
  // Also store under prefix for list to find
  return { url, pathname: key };
}

export async function list({ prefix = '' } = {}) {
  callLog.push({ op: 'list', prefix });
  const matching = [];
  for (const [key, entry] of store.entries()) {
    if (!prefix || key.startsWith(prefix)) {
      matching.push({
        url: entry.url,
        uploadedAt: entry.uploadedAt,
        pathname: key,
        content: entry.content,   // test-only: allows getCachedScreening to avoid real fetch
      });
    }
  }
  return { blobs: matching };
}

// Helper to pre-populate cache for tests (simulates prior successful call)
export function seedCache(key, result, ageMs = 0) {
  const ts = Date.now() - ageMs;
  const payload = JSON.stringify({ result, cachedAt: new Date(ts).toISOString() });
  const url = `https://mock.blob.local/${key}?t=${ts}`;
  store.set(key, {
    url,
    uploadedAt: new Date(ts).toISOString(),
    content: payload,
  });
}

// Helper to force cache read to return specific JSON (for simulating fetch inside getCached)
export function seedCacheWithBlob(key, jsonResult, ageMs = 0) {
  const ts = Date.now() - ageMs;
  const payload = JSON.stringify({ result: jsonResult, cachedAt: new Date(ts).toISOString() });
  const url = `https://mock.blob.local/${key}?t=${ts}`;
  store.set(key, {
    url,
    uploadedAt: new Date(ts).toISOString(),
    content: payload,
  });
}

export function getStoreSnapshot() {
  return Array.from(store.entries()).map(([k, v]) => ({ key: k, uploadedAt: v.uploadedAt }));
}
