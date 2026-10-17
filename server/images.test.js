import test from 'node:test';
import assert from 'node:assert/strict';
import { createImageService } from './images.js';

const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
const article = (id = 'a') => ({ id, url: `https://publisher.com/${id}`, sourceUrl: 'https://www.publisher.com/', language: 'en' });
const metadata = image => new Response(`<html><head><meta property="og:image" content="${image}"></head></html>`);
const service = options => createImageService({ lookupImpl: publicLookup, ...options });
const genericGoogleImage = 'https://lh3.googleusercontent.com/J6_coFbogxhRI9iM864NL_liGXvsQp2AupsKei7z0cNNfDvGUmWUy20nuUhkREQyrpY4bEeIBuc=s0-w300';

const turn = () => new Promise(resolve => setImmediate(resolve));

test('publisher metadata supports attribute order, entities, relative images, and OG priority', async () => {
  const requests = [];
  const images = service({ fetchImpl: async (url, options) => {
    requests.push(url);
    assert.equal(options.redirect, 'manual');
    assert.ok(options.signal);
    return new Response(`<script>const example = '<meta property="og:image" content="https://bad.com/script.jpg">'</script>
      <!-- <meta property="og:image" content="https://bad.com/comment.jpg"> -->
      <meta name='twitter:image' content='https://cdn.publisher.com/twitter.jpg'>
      <META content='/photos/photo&#46;jpg?width=800&amp;quality=80' PROPERTY='og:image'>`);
  } });
  assert.equal(await images.resolve(article()), 'https://publisher.com/photos/photo.jpg?width=800&quality=80');
  assert.deepEqual(requests, ['https://publisher.com/a'], 'image bytes are never fetched by server');
  assert.equal(images.peek(article()), 'https://publisher.com/photos/photo.jpg?width=800&quality=80');
});

test('missing or empty metadata content never becomes an article URL', async () => {
  for (const markup of ['<meta property="og:image">', '<meta content="" property="og:image">', '<meta property="twitter:image" content="   ">']) {
    const images = service({ fetchImpl: async () => new Response(markup) });
    assert.equal(await images.resolve(article()), null);
  }
});

test('publisher previews stop at the head before a large article body', async () => {
  const images = service({ maxBytes: 500, fetchImpl: async () => new Response('<html><head><meta property="og:image" content="/photo.jpg"></head><body>' + 'x'.repeat(5000), { headers: { 'content-length': '5100' } }) });
  assert.equal(await images.resolve(article()), 'https://publisher.com/photo.jpg');
});

test('safe RSS images avoid publisher fetch and generic Google branding is ignored', async () => {
  let calls = 0;
  const images = service({ fetchImpl: async () => { calls += 1; return metadata(genericGoogleImage); } });
  assert.equal(await images.resolve({ ...article(), imageUrl: 'https://cdn.publisher.com/photo.jpg' }), 'https://cdn.publisher.com/photo.jpg');
  assert.equal(calls, 0);
  assert.equal(await images.resolve({ ...article('b'), imageUrl: genericGoogleImage }), null);
  assert.equal(calls, 1);
});

test('unsafe schemes, credentials, ports, IPs and unrelated publisher URLs never reach fetch', async () => {
  let calls = 0;
  const images = service({ fetchImpl: async () => { calls += 1; return metadata('/photo.jpg'); } });
  for (const url of ['http://publisher.com/a', 'https://user:pass@publisher.com/a', 'https://publisher.com:444/a', 'https://127.0.0.1/a', 'https://2130706433/a', 'https://[::1]/a', 'https://[::ffff:127.0.0.1]/a', 'https://localhost/a', 'https://metadata.internal/a', 'https://publisher.com.attacker.com/a', 'https://other.com/a']) {
    assert.equal(await images.resolve({ ...article(url), url }), null, url);
  }
  assert.equal(calls, 0);
});

test('DNS denies private, reserved and mixed answers before article or image use', async () => {
  let calls = 0;
  for (const addresses of [['10.0.0.1'], ['169.254.169.254'], ['100.64.0.1'], ['192.0.2.1'], ['fc00::1'], ['2001:db8::1'], ['::ffff:10.0.0.1'], ['93.184.216.34', '127.0.0.1']]) {
    const images = createImageService({ lookupImpl: async () => addresses.map(address => ({ address })), fetchImpl: async () => { calls += 1; return metadata('/photo.jpg'); } });
    assert.equal(await images.resolve(article()), null);
    assert.equal(await images.resolve({ ...article(), imageUrl: 'https://cdn.publisher.com/photo.jpg' }), null);
  }
  assert.equal(calls, 0);
});

test('every redirect retains publisher boundary and rechecks DNS', async () => {
  for (const destination of ['https://other.com/photo', 'https://127.0.0.1/photo', 'http://publisher.com/photo', 'https://private.publisher.com/photo']) {
    let calls = 0;
    const images = service({
      lookupImpl: async host => [{ address: host === 'private.publisher.com' ? '10.0.0.1' : '93.184.216.34' }],
      fetchImpl: async () => { calls += 1; return new Response(null, { status: 302, headers: { location: destination } }); },
    });
    assert.equal(await images.resolve(article()), null);
    assert.equal(calls, 1, destination);
  }
  const calls = [];
  const images = service({ fetchImpl: async url => {
    calls.push(url);
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://www.publisher.com/new' } }) : metadata('../photo.jpg');
  } });
  assert.equal(await images.resolve(article()), 'https://www.publisher.com/photo.jpg');
  assert.equal(calls.length, 2);
});

test('redirect loops and oversized declared or streamed bodies return null', async () => {
  let redirects = 0;
  const loop = service({ fetchImpl: async () => { redirects += 1; return new Response(null, { status: 302, headers: { location: '/loop' } }); } });
  assert.equal(await loop.resolve(article()), null);
  assert.equal(redirects, 4);
  for (const response of [new Response('x'.repeat(1001), { headers: { 'content-length': '1001' } }), new Response('x'.repeat(1001))]) {
    const images = service({ maxBytes: 1000, fetchImpl: async () => response });
    assert.equal(await images.resolve(article()), null);
  }
});

test('Google RPC resolves publisher URL while skipping interstitial branding', async () => {
  const calls = [];
  const id = 'CBMiTestArticle';
  const googleArticle = { ...article(), url: `https://news.google.com/rss/articles/${id}?oc=5` };
  const images = service({ fetchImpl: async (url, options) => {
    calls.push(url);
    if (calls.length === 1) return new Response(`<meta property="og:image" content="${genericGoogleImage}"><c-wiz data-n-a-sg="signature" data-n-a-id="${id}" data-n-a-ts="1792115874"></c-wiz>`);
    if (calls.length === 2) {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['User-Agent'], 'AIBrief/1.0 article preview');
      assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded;charset=UTF-8');
      const payload = JSON.parse(new URLSearchParams(options.body).get('f.req'));
      const message = JSON.parse(payload[0][0][1]);
      assert.deepEqual(message.slice(2), [id, 1792115874, 'signature']);
      return new Response(")]}'\n\n123\n" + JSON.stringify([['wrb.fr', 'Fbv4je', JSON.stringify(['garturlres', 'https://publisher.com/original', 1])]]));
    }
    assert.equal(url, 'https://publisher.com/original');
    return metadata('https://images.publisher.com/actual-story.jpg');
  } });
  assert.equal(await images.resolve(googleArticle), 'https://images.publisher.com/actual-story.jpg');
  assert.equal(calls.length, 3);
});

test('Google decoding cannot redirect outside publisher or Google hosts', async () => {
  const id = 'CBMiTestArticle';
  for (const target of ['https://localhost/private', 'https://attacker.com/story']) {
    let calls = 0;
    const images = service({ fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response(`<div data-n-a-id="${id}" data-n-a-sg="sig" data-n-a-ts="123"></div>`);
      return new Response(JSON.stringify([['wrb.fr', 'Fbv4je', JSON.stringify(['garturlres', target, 1])]]));
    } });
    assert.equal(await images.resolve({ ...article(), url: `https://news.google.com/articles/${id}` }), null);
    assert.equal(calls, 2);
  }
  let calls = 0;
  const images = service({ fetchImpl: async () => { calls += 1; return new Response(null, { status: 302, headers: { location: 'https://www.google.com/sorry/' } }); } });
  assert.equal(await images.resolve({ ...article(), url: `https://news.google.com/articles/${id}` }), null);
  assert.equal(calls, 1);
});

test('success and failure caches expire separately and have bounded entry count', async () => {
  let time = 0;
  let calls = 0;
  const images = service({ now: () => time, maxCache: 2, successTtlMs: 100, failureTtlMs: 10, fetchImpl: async url => {
    calls += 1;
    return url.endsWith('/bad') ? new Response('No image') : metadata('/photo.jpg');
  } });
  await images.resolve(article('good'));
  await images.resolve(article('bad'));
  await images.resolve(article('good'));
  await images.resolve(article('bad'));
  assert.equal(calls, 2);
  time = 11;
  await images.resolve(article('bad'));
  assert.equal(calls, 3);
  assert.ok(images.peek(article('good')));
  time = 101;
  assert.equal(images.peek(article('good')), null);
  await images.resolve(article('good'));
  await images.resolve(article('third'));
  await images.resolve(article('fourth'));
  assert.equal(images.peek(article('good')), null, 'oldest cache entry evicted');
});

test('concurrency is bounded, in-flight requests deduplicate and overload is retryable', async () => {
  const releases = [];
  let calls = 0;
  const images = service({ maxActive: 2, maxQueue: 1, fetchImpl: async () => {
    calls += 1;
    return new Promise(resolve => releases.push(() => resolve(metadata('/photo.jpg'))));
  } });
  const first = images.resolve(article('one'));
  assert.equal(images.resolve(article('one')), first);
  const second = images.resolve(article('two'));
  const third = images.resolve(article('three'));
  assert.equal(await images.resolve(article('four')), undefined);
  await turn();
  assert.equal(calls, 2);
  releases.shift()();
  await first;
  await turn();
  assert.equal(calls, 3);
  releases.splice(0).forEach(release => release());
  assert.ok(await second);
  assert.ok(await third);
  const retry = images.resolve(article('four'));
  await turn();
  releases.shift()();
  assert.ok(await retry, 'overload must not negatively cache the article');
});

test('queued jobs receive a full execution budget after an earlier request times out', async () => {
  const calls = [];
  const images = service({ timeoutMs: 30, queueTimeoutMs: 100, maxActive: 1, fetchImpl: async url => {
    calls.push(url);
    if (url.endsWith('/first')) return new Promise(() => {});
    return metadata('/photo.jpg');
  } });
  const first = images.resolve(article('first'));
  const second = images.resolve(article('second'));
  assert.equal(await first, null);
  assert.equal(await second, 'https://publisher.com/photo.jpg');
  assert.equal(calls.length, 2);
});

test('queue expiry returns undefined without a cached negative and permits immediate retry', async () => {
  let release;
  const calls = [];
  const images = service({ timeoutMs: 200, queueTimeoutMs: 15, maxActive: 1, fetchImpl: async url => {
    calls.push(url);
    if (url.endsWith('/first')) return new Promise(resolve => { release = () => resolve(metadata('/photo.jpg')); });
    return metadata('/photo.jpg');
  } });
  const first = images.resolve(article('first'));
  const second = images.resolve(article('second'));
  assert.equal(await second, undefined);
  assert.equal(calls.length, 1, 'expired queued article was never fetched');
  release();
  await first;
  assert.equal(await images.resolve(article('second')), 'https://publisher.com/photo.jpg');
  assert.equal(calls.length, 2);
});

test('execution timeout bounds hung fetch and DNS; workers recover', async () => {
  let calls = 0;
  let stuck = true;
  const images = service({ timeoutMs: 30, maxActive: 1, maxQueue: 1, fetchImpl: async (_url, options) => {
    calls += 1;
    if (stuck) return new Promise(() => { options.signal.addEventListener('abort', () => {}); });
    return metadata('/photo.jpg');
  } });
  const first = images.resolve(article('first'));
  const second = images.resolve(article('second'));
  assert.equal(await first, null);
  assert.equal(await second, null);
  stuck = false;
  assert.ok(await images.resolve(article('third')));
  assert.ok(calls <= 3);
  const dns = createImageService({ timeoutMs: 20, lookupImpl: () => new Promise(() => {}), fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal(await dns.resolve(article()), null);
});
