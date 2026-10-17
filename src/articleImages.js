const cache = new Map();
const MAX_ENTRIES = 200;
const PHOTO_TTL = 6 * 60 * 60 * 1000;
const EMPTY_TTL = 10 * 60 * 1000;

export function canResolveArticleImage(article) {
  return !article.isDemo && typeof article.id === 'string' && /^[a-f0-9]{20}$/.test(article.id);
}

function httpsImageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

async function fetchImageMetadata(id, language) {
  const request = () => fetch(`/api/article-image/${id}?lang=${language}`, {
    cache: 'no-store', signal: AbortSignal.timeout(30000),
  });
  let response = await request();
  if (response.status === 503 && navigator.onLine !== false) {
    const retryAfter = Number(response.headers.get('Retry-After') ?? 10);
    const delay = Math.min(10, Math.max(1, Number.isFinite(retryAfter) ? retryAfter : 10));
    await new Promise(resolve => setTimeout(resolve, delay * 1000));
    if (navigator.onLine === false) throw new Error('Offline');
    response = await request();
  }
  return response;
}

export function resolveArticleImage(id, language) {
  if (typeof id !== 'string' || !/^[a-f0-9]{20}$/.test(id) || !['en', 'th'].includes(language) || navigator.onLine === false) return Promise.resolve(null);
  const key = `${language}:${id}`;
  const existing = cache.get(key);
  if (existing && (existing.promise || existing.expires > Date.now())) {
    cache.delete(key);
    cache.set(key, existing);
    return existing.promise || Promise.resolve(existing.url);
  }
  cache.delete(key);
  if (cache.size >= MAX_ENTRIES) {
    const oldestSettled = [...cache].find(([, entry]) => !entry.promise);
    if (!oldestSettled) return Promise.resolve(null);
    cache.delete(oldestSettled[0]);
  }
  const entry = { url: null, expires: 0, promise: null };
  entry.promise = fetchImageMetadata(id, language).then(async response => {
    if (!response.ok) throw new Error('Image metadata unavailable');
    const data = await response.json();
    entry.url = httpsImageUrl(data?.imageUrl);
    entry.expires = Date.now() + (entry.url ? PHOTO_TTL : EMPTY_TTL);
    entry.promise = null;
    return entry.url;
  }).catch(() => {
    // A temporary request failure can be retried when a story is visited again.
    if (cache.get(key) === entry) cache.delete(key);
    return null;
  });
  cache.set(key, entry);
  return entry.promise;
}
