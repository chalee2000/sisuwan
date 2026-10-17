import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { EnvHttpProxyAgent, fetch as proxyFetch } from 'undici';

const privateAddresses = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) privateAddresses.addSubnet(address, prefix);
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) privateAddresses.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const GENERIC_GOOGLE_IMAGE = 'J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc';

function publicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !privateAddresses.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !privateAddresses.check(address, 'ipv6');
}

// Direct connections use the checked DNS answers for the socket itself, closing
// the gap between the preflight check and a second DNS resolution. When an
// inherited proxy is used, EnvHttpProxyAgent retains its normal proxy connector;
// that proxy must enforce its own destination policy and DNS checks.
export function createPublicLookup(lookupImpl = lookup) {
  return (hostname, options, callback) => {
    lookupImpl(hostname, { all: true, verbatim: true }).then(addresses => {
      if (!Array.isArray(addresses) || !addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('Unsafe destination');
      const family = typeof options === 'number' ? options : options?.family;
      const matches = addresses.filter(item => !family || item.family === family);
      if (!matches.length) throw new Error('No public address for requested family');
      if (options?.all) callback(null, matches);
      else callback(null, matches[0].address, matches[0].family);
    }).catch(error => callback(error));
  };
}

function urlSyntax(value, base) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (!host.includes('.') && !isIP(host)) return null;
    if (/(?:^|\.)(?:localhost|local|internal|invalid|test|example|home|lan|onion)$/.test(host) || host.endsWith('.')) return null;
    if (isIP(host) && !publicAddress(host)) return null;
    return url;
  } catch { return null; }
}

function decodeEntities(value) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', colon: ':', sol: '/', nbsp: ' ' };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|colon|sol|nbsp);/gi, (match, name) => {
    if (name[0] !== '#') return named[name.toLowerCase()] ?? match;
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4]);
  }
  return result;
}

function imageCandidates(html, base) {
  const candidates = [];
  // Ignore inert markup so a quoted example of a meta tag is not treated as metadata.
  const document = html.replace(/<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  for (const match of document.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const name = (attrs.property ?? attrs.name ?? '').toLowerCase();
    if (!['og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'].includes(name)) continue;
    const url = urlSyntax(attrs.content, base);
    if (!url || url.href.includes(GENERIC_GOOGLE_IMAGE) || url.hostname === 'news.google.com') continue;
    candidates.push({ url, priority: name.startsWith('og:') ? 0 : 1 });
  }
  return candidates.sort((a, b) => a.priority - b.priority).map(value => value.url);
}

/** Resolves only trusted feed articles; callers must look articles up by server-owned IDs. */
export function createImageService({
  fetchImpl = proxyFetch, lookupImpl = lookup, now = Date.now,
  timeoutMs = 12_000, queueTimeoutMs = 12_000, maxBytes = 1024 * 1024, maxActive = 6, maxQueue = 24,
  maxCache = 1000, successTtlMs = 6 * 60 * 60 * 1000, failureTtlMs = 10 * 60 * 1000,
} = {}) {
  const dispatcher = new EnvHttpProxyAgent({ connect: { lookup: createPublicLookup(lookupImpl) } });
  const cache = new Map();
  const pending = new Map();
  const queue = [];
  let active = 0;

  const keyFor = article => JSON.stringify([article?.id, article?.url, article?.sourceUrl, article?.imageUrl]);
  function cached(key) {
    const entry = cache.get(key);
    if (entry && entry.expiresAt > now()) return entry;
    if (entry) cache.delete(key);
    return undefined;
  }
  function save(key, value) {
    cache.delete(key);
    cache.set(key, { value, expiresAt: now() + (value ? successTtlMs : failureTtlMs) });
    while (cache.size > maxCache) cache.delete(cache.keys().next().value);
  }

  async function publicUrl(value, signal) {
    signal.throwIfAborted();
    const url = value instanceof URL ? value : urlSyntax(value);
    if (!url) throw new Error('Unsafe destination');
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!isIP(host)) {
      const addresses = await lookupImpl(host, { all: true, verbatim: true });
      signal.throwIfAborted();
      if (!Array.isArray(addresses) || !addresses.length || addresses.some(item => !publicAddress(item.address))) throw new Error('Unsafe destination');
    }
    return url;
  }

  async function bodyText(response, signal, headOnly = false) {
    if (!headOnly && Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw new Error('Image metadata size limit');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty response');
    let size = 0;
    const chunks = [];
    let tail = '';
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        let chunk = Buffer.from(value);
        const headEnd = headOnly ? /<\/head\s*>/i.exec(tail + chunk.toString('latin1')) : null;
        if (headEnd) chunk = chunk.subarray(0, Math.max(0, headEnd.index + headEnd[0].length - tail.length));
        size += chunk.byteLength;
        if (size > maxBytes) throw new Error('Image metadata size limit');
        chunks.push(chunk);
        if (headEnd) { await reader.cancel(); break; }
        tail = chunk.toString('latin1').slice(-32);
      }
      return Buffer.concat(chunks).toString('utf8');
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally { reader.releaseLock(); }
  }

  async function request(value, allowedHost, signal, options = {}) {
    let url = urlSyntax(value);
    const { headers: customHeaders = {}, headOnly = false, ...fetchOptions } = options;
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      if (!url || !allowedHost(url.hostname)) throw new Error('Unrelated publisher destination');
      await publicUrl(url, signal);
      const response = await fetchImpl(url.href, {
        dispatcher, signal, redirect: 'manual',
        ...fetchOptions,
        headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': 'AIBrief/1.0 article preview', ...customHeaders },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || redirects === 3 || options.method === 'POST') throw new Error('Image metadata redirect limit');
        url = urlSyntax(location, url);
        continue;
      }
      if (!response.ok) { await response.body?.cancel(); throw new Error('Image metadata unavailable'); }
      return { html: await bodyText(response, signal, headOnly), url };
    }
    throw new Error('Image metadata unavailable');
  }

  async function resolveGoogle(articleUrl, signal) {
    const googleHost = host => host === 'news.google.com';
    if (!/^\/(?:rss\/)?articles\/[\w-]+\/?$/.test(articleUrl.pathname)) throw new Error('Not a Google article');
    const { html } = await request(articleUrl.href, googleHost, signal);
    // Google exposes a short-lived signature on the RSS interstitial. Its OG
    // image is Google's own logo, so only the original publisher is queried.
    let data;
    for (const tag of html.matchAll(/<[^>]+\bdata-n-a-id\s*=[^>]+>/gi)) {
      const attrs = attributes(tag[0]);
      if (attrs['data-n-a-id'] && attrs['data-n-a-ts'] && attrs['data-n-a-sg']) { data = attrs; break; }
    }
    if (!data || data['data-n-a-id'] !== articleUrl.pathname.split('/').filter(Boolean).at(-1) || !/^\d{1,16}$/.test(data['data-n-a-ts']) || data['data-n-a-sg'].length > 500) throw new Error('No Google article signature');
    const locale = ['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1];
    const message = ['garturlreq', [locale, 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], data['data-n-a-id'], Number(data['data-n-a-ts']), data['data-n-a-sg']];
    const payload = [[['Fbv4je', JSON.stringify(message), null, 'generic']]];
    const { html: response } = await request('https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je', googleHost, signal, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ 'f.req': JSON.stringify(payload) }).toString(),
    });
    // batchexecute can include decimal length lines between JSON envelopes.
    for (const line of response.split('\n')) {
      if (!line.trimStart().startsWith('[')) continue;
      let envelope;
      try { envelope = JSON.parse(line); } catch { continue; }
      for (const row of envelope) {
        if (row?.[0] !== 'wrb.fr' || row[1] !== 'Fbv4je' || typeof row[2] !== 'string') continue;
        const result = JSON.parse(row[2]);
        if (result?.[0] === 'garturlres' && typeof result[1] === 'string') return result[1];
      }
    }
    throw new Error('No original article URL');
  }

  async function find(article, signal) {
    if (article?.imageUrl && !String(article.imageUrl).includes(GENERIC_GOOGLE_IMAGE)) {
      try { return (await publicUrl(article.imageUrl, signal)).href; } catch { signal.throwIfAborted(); }
    }
    const source = urlSyntax(article?.sourceUrl);
    const link = urlSyntax(article?.url);
    if (!source || !link || source.hostname === 'news.google.com') return null;
    const publisher = source.hostname.replace(/^www\./, '');
    const samePublisher = host => host === publisher || host.endsWith(`.${publisher}`);
    const original = link.hostname === 'news.google.com' ? await resolveGoogle(link, signal) : link.href;
    const { html, url } = await request(original, samePublisher, signal, { headOnly: true });
    for (const candidate of imageCandidates(html, url)) {
      try { return (await publicUrl(candidate, signal)).href; } catch { signal.throwIfAborted(); }
    }
    return null;
  }

  function drain() {
    while (active < maxActive && queue.length) {
      const job = queue.shift();
      clearTimeout(job.queueTimer);
      const controller = new AbortController();
      let abortResolve;
      const abortPromise = new Promise(resolveAbort => { abortResolve = resolveAbort; });
      // Waiting for a worker must not consume the article's network budget.
      const timer = setTimeout(() => { controller.abort(); abortResolve(null); }, timeoutMs);
      active += 1;
      Promise.race([find(job.article, controller.signal), abortPromise]).catch(() => null).then(value => {
        save(job.key, value);
        job.finish(value);
      }).finally(() => { clearTimeout(timer); active -= 1; drain(); });
    }
  }

  function resolve(article) {
    const key = keyFor(article);
    const entry = cached(key);
    if (entry) return Promise.resolve(entry.value);
    if (pending.has(key)) return pending.get(key);
    // undefined means capacity is temporarily unavailable, not that the article
    // has no image. Callers can retry; these outcomes must never enter the cache.
    if (active >= maxActive && queue.length >= maxQueue) return Promise.resolve(undefined);
    let finish;
    const promise = new Promise(resolveResult => { finish = resolveResult; });
    const queueTimer = setTimeout(() => {
      const index = queue.findIndex(job => job.key === key);
      if (index !== -1) queue.splice(index, 1)[0].finish(undefined);
    }, queueTimeoutMs);
    pending.set(key, promise);
    const complete = value => { clearTimeout(queueTimer); pending.delete(key); finish(value); };
    queue.push({ key, article, queueTimer, finish: complete });
    drain();
    return promise;
  }

  return { resolve, peek: article => cached(keyFor(article))?.value ?? null };
}
