import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { EnvHttpProxyAgent, fetch as proxyFetch } from 'undici';
import { ALLOWED_FEED_HOSTS, CATEGORIES, getFeeds, REFRESH_INTERVAL_MS } from './feeds.js';

const MAX_FEED_BYTES = 2 * 1024 * 1024;
const MAX_ARTICLES_PER_FEED = 40;
const dispatcher = new EnvHttpProxyAgent();
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true });

const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function plainText(value, maxLength = 900) {
  const input = typeof value === 'object' ? value?.['#text'] ?? '' : value ?? '';
  return String(input)
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? match;
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim().slice(0, maxLength);
}

export function safeUrl(value) {
  try {
    const url = new URL(typeof value === 'object' ? value?.['#text'] : value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

function asArray(value) { return value == null ? [] : Array.isArray(value) ? value : [value]; }

export function articleSummary(description, title, source) {
  const summary = plainText(description);
  const normalized = value => value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\p{S}]/gu, '');
  // Google RSS often repeats only the headline and publisher in its description.
  // That is attribution, not an article excerpt.
  const value = normalized(summary);
  if (!value || [title, `${title} ${source}`, `${source} ${title}`].some(candidate => normalized(candidate) === value)) return '';
  const raw = typeof description === 'object' ? description?.['#text'] ?? '' : description ?? '';
  if (/<(?:ol|ul)\b/i.test(raw) && value.startsWith(normalized(title))) return '';
  return summary;
}

export function isAiArticle(title, summary = '') {
  // Search engines also match article bodies and navigation. Require visible
  // AI context so a general-news headline is not promoted into this edition.
  // Product names retain stories such as a Claude release without an "AI" prefix.
  return /\b(?:AI|A\.I\.?|LLMs?|AGI|artificial intelligence|machine learning|deep learning|neural networks?|large language models?|frontier models?|generative|agentic|superintelligence|OpenAI|ChatGPT|GPT|Anthropic|Claude|Gemini|Copilot|DeepSeek|Grok|Midjourney|Stable Diffusion|Hugging Face|TensorFlow|PyTorch|Perplexity|physical intelligence|vibe[ -]cod(?:e|ed|ing))\b|ปัญญาประดิษฐ์|เอไอ|โมเดลภาษา|การเรียนรู้ของเครื่อง|การเรียนรู้เชิงลึก/i.test(`${title} ${summary}`);
}

export function parseFeed(xml, feed, now = Date.now()) {
  if (Buffer.byteLength(xml) > MAX_FEED_BYTES) throw new Error('Feed exceeds size limit');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) throw new Error('Unsafe XML declarations');
  if (XMLValidator.validate(xml) !== true) throw new Error('Invalid RSS document');
  const document = parser.parse(xml);
  const channel = document.rss?.channel;
  if (!channel || !channel.title) throw new Error('Unsupported RSS document');
  return asArray(channel.item).slice(0, MAX_ARTICLES_PER_FEED).flatMap(item => {
    const originalTitle = plainText(item.title, 320);
    const url = safeUrl(item.link);
    if (!originalTitle || !url) return [];
    const timestamp = Date.parse(item.pubDate ?? item['dc:date']);
    // Future-dated items should not masquerade as the latest news.
    if (Number.isFinite(timestamp) && timestamp > now + 15 * 60 * 1000) return [];
    const source = plainText(item.source, 100) || feed.name;
    const title = originalTitle.endsWith(` - ${source}`) ? originalTitle.slice(0, -(source.length + 3)) : originalTitle;
    const summary = articleSummary(item.description ?? item['content:encoded'], title, source);
    if (!isAiArticle(title, summary)) return [];
    const media = [...asArray(item['media:thumbnail']), ...asArray(item['media:content'])]
      .find(media => safeUrl(media?.['@_url']));
    const enclosure = asArray(item.enclosure).find(value => String(value?.['@_type']).startsWith('image/'));
    const imageUrl = safeUrl(media?.['@_url'] ?? enclosure?.['@_url']);
    return [{
      id: createHash('sha256').update(url).digest('hex').slice(0, 20),
      title,
      summary, url, imageUrl, source,
      sourceUrl: safeUrl(item.source?.['@_url']) ?? new URL(url).origin,
      category: feed.category, publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
      language: feed.language, feedId: feed.id,
    }];
  });
}

export async function fetchFeed(feed, { fetchImpl = proxyFetch, timeoutMs = 6500 } = {}) {
  let url = new URL(feed.url);
  let response;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    if (url.protocol !== 'https:' || !ALLOWED_FEED_HOSTS.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) {
      throw new Error('Feed destination is not allowed');
    }
    response = await fetchImpl(url.href, {
      dispatcher, redirect: 'manual', signal,
      headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'AIBrief/1.0 RSS reader' },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location || redirects === 3) throw new Error('Feed redirect limit exceeded');
    url = new URL(location, url);
  }
  if (!response.ok) throw new Error(`Feed HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_FEED_BYTES) {
    await response.body?.cancel();
    throw new Error('Feed exceeds size limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Feed has no response body');
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_FEED_BYTES) throw new Error('Feed exceeds size limit');
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  return parseFeed(Buffer.concat(chunks).toString('utf8'), feed);
}

async function mapConcurrent(items, concurrency, callback) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await callback(items[index]);
    }
  }));
}

export function createNewsService({ language = 'th', feeds = getFeeds(language), loadFeed = fetchFeed, now = Date.now, intervalMs = REFRESH_INTERVAL_MS } = {}) {
  const cache = new Map(feeds.map(feed => [feed.id, {
    ...feed, status: 'pending', articles: [], lastSuccessAt: null, error: null,
  }]));
  let inFlight = null;
  let nextRefresh = null;
  let lastUpdated = null;
  let lastManualRefresh = null;
  let timer;

  async function refresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let succeeded = false;
      await mapConcurrent(feeds, 6, async feed => {
        const current = cache.get(feed.id);
        try {
          const articles = await loadFeed(feed);
          if (!articles.length) throw new Error('No valid articles in feed');
          cache.set(feed.id, { ...feed, articles, status: 'ok', lastSuccessAt: new Date(now()).toISOString(), error: null });
          succeeded = true;
        } catch (error) {
          cache.set(feed.id, {
            ...current, status: current.articles.length ? 'stale' : 'error',
            // Do not expose proxy addresses, credential material, or stack traces.
            error: /size limit/.test(error.message) ? 'feed_too_large'
              : /XML|RSS/.test(error.message) ? 'invalid_feed' : 'feed_unreachable',
          });
        }
      });
      if (succeeded) lastUpdated = new Date(now()).toISOString();
      nextRefresh = now() + intervalMs;
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  function snapshot() {
    const sources = [...cache.values()].map(({ articles, ...feed }) => ({ ...feed, articleCount: articles.length }));
    const articles = [...cache.values()].flatMap(feed => feed.articles.map(article => ({ ...article, stale: feed.status === 'stale' })));
    // The same RSS item can appear in several sections; keep it once and retain
    // all category memberships so a category filter does not hide the story.
    const unique = new Map();
    for (const article of articles) {
      const existing = unique.get(article.id);
      if (existing) {
        if (!existing.categories.includes(article.category)) existing.categories.push(article.category);
        existing.stale = existing.stale && article.stale;
      } else unique.set(article.id, { ...article, categories: [article.category] });
    }
    const result = [...unique.values()].sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
    const healthy = sources.filter(source => source.status === 'ok').length;
    return {
      articles: result, categories: CATEGORIES, sources, language, edition: 'ai',
      status: healthy === feeds.length ? 'live' : result.length ? 'partial' : 'unavailable',
      loading: Boolean(inFlight), stale: result.some(article => article.stale),
      lastUpdated, nextRefreshAt: nextRefresh ? new Date(nextRefresh).toISOString() : null,
      refreshIntervalMs: intervalMs, total: result.length,
    };
  }

  async function requestRefresh({ waitMs = 1000 } = {}) {
    const retryAfterMs = lastManualRefresh === null ? 0 : Math.max(0, lastManualRefresh + 30_000 - now());
    if (retryAfterMs > 0) return { ...snapshot(), refreshAccepted: false, retryAfterMs };
    lastManualRefresh = now();
    // HTTP callers can poll the existing cache if upstream requests need longer
    // than this bounded wait. Concurrent refreshes share the same jobs.
    const completion = refresh();
    let waitTimer;
    try {
      await Promise.race([completion, new Promise(resolve => { waitTimer = setTimeout(resolve, waitMs); })]);
    } finally { clearTimeout(waitTimer); }
    return { ...snapshot(), refreshAccepted: true, retryAfterMs: Math.max(0, lastManualRefresh + 30_000 - now()) };
  }

  function start() {
    if (timer) return;
    void refresh();
    timer = setInterval(() => { void refresh(); }, intervalMs);
    timer.unref();
  }
  function stop() { clearInterval(timer); timer = undefined; }

  return { refresh, requestRefresh, snapshot, start, stop };
}
