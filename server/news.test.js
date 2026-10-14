import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './app.js';
import { articleSummary, createNewsService, fetchFeed, parseFeed, plainText, safeUrl } from './news.js';
import { CATEGORIES, getFeeds } from './feeds.js';

const feed = { id: 'test-world', name: 'Test publisher', category: 'world', language: 'en', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' };
const fixture = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Test feed</title><item><title><![CDATA[Sample &amp; headline - Example News]]></title><link>https://example.com/story</link><description><![CDATA[<p>A concise &amp; safe summary.</p><script>alert('bad')</script>]]></description><pubDate>Tue, 13 Oct 2026 10:00:00 GMT</pubDate><source url="https://example.com">Example News</source><media:thumbnail url="https://example.com/photo.jpg"/></item></channel></rss>`;
const clock = () => Date.parse('2026-10-13T12:00:00Z');
const article = (id, category = 'world') => ({ id, title: `Test ${id}`, summary: 'Summary', url: `https://example.com/${id}`, source: 'Example', category, publishedAt: '2026-10-13T10:00:00.000Z', feedId: feed.id });

test('RSS parsing retains attribution and timestamps while sanitizing text', () => {
  const [result] = parseFeed(fixture, feed, clock());
  assert.equal(result.title, 'Sample & headline');
  assert.equal(result.summary, 'A concise & safe summary.');
  assert.equal(result.source, 'Example News');
  assert.equal(result.sourceUrl, 'https://example.com/');
  assert.equal(result.imageUrl, 'https://example.com/photo.jpg');
  assert.equal(result.publishedAt, '2026-10-13T10:00:00.000Z');
  assert.equal(result.language, 'en');
});

test('malicious XML, malformed feeds, unsafe links and future dates are rejected', () => {
  assert.throws(() => parseFeed('<!DOCTYPE rss [<!ENTITY x "boom">]>' + fixture, feed), /Unsafe/);
  assert.throws(() => parseFeed('<rss><channel>', feed), /Invalid/);
  assert.throws(() => parseFeed('<html>not RSS</html>', feed), /Unsupported/);
  assert.deepEqual(parseFeed(fixture.replace('https://example.com/story', 'javascript:alert(1)'), feed, clock()), []);
  assert.deepEqual(parseFeed(fixture, feed, Date.parse('2020-01-01')), []);
  assert.equal(safeUrl('data:text/html,hello'), null);
  assert.equal(safeUrl('https://user:secret@example.com'), null);
  assert.equal(plainText('&lt;script&gt;bad&lt;/script&gt; fine &#x1F30D;'), 'fine 🌍');
});

test('fetches are HTTPS allowlisted and bounded with each redirect revalidated', async () => {
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls += 1;
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal);
    return new Response(fixture);
  };
  await assert.rejects(fetchFeed({ ...feed, url: 'http://feeds.bbci.co.uk/news' }, { fetchImpl }), /not allowed/);
  await assert.rejects(fetchFeed({ ...feed, url: 'https://localhost/rss' }, { fetchImpl }), /not allowed/);
  assert.equal(calls, 0);
  assert.equal((await fetchFeed(feed, { fetchImpl })).length, 1);
  await assert.rejects(fetchFeed(feed, { fetchImpl: async () => new Response('too large', { headers: { 'content-length': '3000000' } }) }), /size limit/);
  await assert.rejects(fetchFeed(feed, { fetchImpl: async () => new Response('error', { status: 403 }) }), /HTTP 403/);
  let redirectCalls = 0;
  let firstSignal;
  const redirected = await fetchFeed(feed, { fetchImpl: async (_url, { signal }) => {
    redirectCalls += 1;
    if (redirectCalls === 1) {
      firstSignal = signal;
      return new Response(null, { status: 302, headers: { location: 'https://news.google.com/rss/topics/example' } });
    }
    assert.equal(signal, firstSignal, 'Redirects must share the original timeout');
    return new Response(fixture);
  } });
  assert.equal(redirected.length, 1);
  assert.equal(redirectCalls, 2);
  let unsafeCalls = 0;
  await assert.rejects(fetchFeed(feed, { fetchImpl: async () => {
    unsafeCalls += 1;
    return new Response(null, { status: 302, headers: { location: 'https://localhost/private' } });
  } }), /not allowed/);
  assert.equal(unsafeCalls, 1);
  await assert.rejects(fetchFeed(feed, { fetchImpl: async () =>
    new Response(null, { status: 302, headers: { location: '/loop' } }) }), /redirect limit/);
});

test('duplicate headlines and Google related-story lists are not presented as summaries', () => {
  assert.equal(articleSummary('<a>Example headline</a>&nbsp;<font>Example News</font>', 'Example headline', 'Example News'), '');
  assert.equal(articleSummary('Example headline - Example News', 'Example headline', 'Example News'), '');
  assert.equal(articleSummary('<ol><li>Example headline Example News</li><li>Related headline Another News</li></ol>', 'Example headline', 'Example News'), '');
  assert.equal(articleSummary('Actual publisher excerpt with more detail.', 'Example headline', 'Example News'), 'Actual publisher excerpt with more detail.');
});

test('one refresh runs at a time, requests are bounded, dedup keeps categories', async () => {
  let active = 0;
  let maxActive = 0;
  let requests = 0;
  const feeds = Array.from({ length: 14 }, (_, i) => ({ ...feed, id: `feed-${i}`, category: i % 2 ? 'world' : 'politics' }));
  const service = createNewsService({ feeds, now: clock, loadFeed: async source => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    requests += 1;
    await new Promise(resolve => setTimeout(resolve, 4));
    active -= 1;
    return [article('same-story', source.category)];
  } });
  await Promise.all([service.refresh(), service.refresh(), service.refresh()]);
  assert.equal(requests, feeds.length);
  assert.equal(maxActive, 6);
  assert.equal(service.snapshot().total, 1);
  assert.deepEqual(service.snapshot().articles[0].categories.sort(), ['politics', 'world']);
  assert.equal(service.snapshot().status, 'live');
  assert.equal(service.snapshot().loading, false);
});

test('failed refresh preserves cached articles and identifies stale data without inventing stories', async () => {
  let shouldFail = true;
  const service = createNewsService({ feeds: [feed], now: clock, loadFeed: async () => {
    if (shouldFail) throw new Error('proxy contains sensitive detail');
    return [article('one')];
  } });
  await service.refresh();
  assert.equal(service.snapshot().status, 'unavailable');
  assert.equal(service.snapshot().total, 0);
  assert.equal(service.snapshot().lastUpdated, null);
  assert.equal(service.snapshot().sources[0].error, 'feed_unreachable');
  shouldFail = false;
  await service.refresh();
  assert.equal(service.snapshot().status, 'live');
  shouldFail = true;
  await service.refresh();
  assert.equal(service.snapshot().status, 'partial');
  assert.equal(service.snapshot().articles[0].stale, true);
  assert.equal(service.snapshot().sources[0].status, 'stale');
  assert.equal(service.snapshot().lastUpdated, new Date(clock()).toISOString());
});

test('all 17 categories have language-specific, fixed Google RSS feeds', () => {
  assert.equal(CATEGORIES.length, 17);
  assert.equal(new Set(CATEGORIES.map(category => category.id)).size, 17);
  for (const language of ['th', 'en']) {
    const feeds = getFeeds(language).filter(source => source.id.startsWith('google-'));
    assert.equal(feeds.length, 17);
    for (const category of CATEGORIES) {
      const configured = feeds.find(source => source.category === category.id);
      assert.ok(configured, `Missing ${language}/${category.id}`);
      assert.equal(configured.language, language);
      const url = new URL(configured.url);
      assert.equal(url.origin, 'https://news.google.com');
      if (url.pathname.endsWith('/search')) assert.ok(url.searchParams.get('q'));
    }
  }
});

test('manual refresh retries sources once per 30 seconds and returns during slow refresh', async () => {
  let requests = 0;
  let currentTime = clock();
  const service = createNewsService({ feeds: [feed], now: () => currentTime, loadFeed: async () => {
    requests += 1;
    return [article(`article-${requests}`)];
  } });
  const first = await service.requestRefresh();
  assert.equal(first.refreshAccepted, true);
  assert.equal(first.articles[0].id, 'article-1');
  assert.equal(first.retryAfterMs, 30_000);
  const second = await service.requestRefresh();
  assert.equal(second.refreshAccepted, false);
  assert.equal(requests, 1);
  currentTime += 29_999;
  assert.equal((await service.requestRefresh()).retryAfterMs, 1);
  assert.equal(requests, 1);
  currentTime += 1;
  assert.equal((await service.requestRefresh()).refreshAccepted, true);
  assert.equal(requests, 2);

  let finish;
  const slow = createNewsService({ feeds: [feed], loadFeed: () => new Promise(resolve => { finish = resolve; }) });
  const pending = await slow.requestRefresh({ waitMs: 1 });
  assert.equal(pending.loading, true);
  assert.equal(pending.total, 0);
  assert.equal((await slow.requestRefresh()).refreshAccepted, false);
  finish([article('completed')]);
  await slow.refresh();
  assert.equal(slow.snapshot().loading, false);
  assert.equal(slow.snapshot().articles[0].id, 'completed');
});

test('Thai and English use independent feeds and cached results', async t => {
  assert.match(getFeeds('th')[0].url, /ceid=TH%3Ath/);
  assert.match(getFeeds('en')[0].url, /ceid=US%3Aen/);
  const services = Object.fromEntries(['th', 'en'].map(language => [language, createNewsService({
    language, feeds: [{ ...feed, language }], now: clock,
    loadFeed: async () => [{ ...article(language), title: language === 'th' ? 'ข่าวภาษาไทย' : 'English news', language }],
  })]));
  await Promise.all(Object.values(services).map(service => service.refresh()));
  const { app } = createApp({ services, distPath: '/tmp/worldbrief-does-not-exist' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const thai = await (await fetch(`${baseUrl}/api/news`)).json();
  const english = await (await fetch(`${baseUrl}/api/news?lang=en`)).json();
  assert.equal(thai.language, 'th');
  assert.equal(thai.articles[0].title, 'ข่าวภาษาไทย');
  assert.equal(english.language, 'en');
  assert.equal(english.articles[0].title, 'English news');
  assert.equal((await (await fetch(`${baseUrl}/api/news?lang=en&search=missing`)).json()).total, 0);
  assert.equal((await fetch(`${baseUrl}/api/news?category=invalid`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/news?lang=invalid`)).status, 400);
  assert.equal((await (await fetch(`${baseUrl}/api/sources?lang=en`)).json()).language, 'en');
  assert.equal((await (await fetch(`${baseUrl}/api/health`)).json()).status, 'ok');
  const refreshed = await fetch(`${baseUrl}/api/refresh?lang=en`, { method: 'POST' });
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.headers.get('retry-after'), '30');
  assert.equal((await refreshed.json()).refreshAccepted, true);
  const cooldown = await (await fetch(`${baseUrl}/api/refresh?lang=en`, { method: 'POST' })).json();
  assert.equal(cooldown.refreshAccepted, false);
  assert.equal(cooldown.language, 'en');
  assert.equal((await (await fetch(`${baseUrl}/api/refresh?lang=th`, { method: 'POST' })).json()).refreshAccepted, true);
});
