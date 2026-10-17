import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './app.js';

test('image endpoint resolves only current stories in the requested language and enriches subsequent news snapshots', async t => {
  const id = 'abcdef0123456789abcd';
  const article = { id, title: 'AI coding tools', category: 'coding', categories: ['coding'], url: 'https://publisher.example/story', sourceUrl: 'https://publisher.example/', imageUrl: null };
  const snapshot = articles => ({ articles, categories: [{ id: 'coding' }], total: articles.length, edition: 'ai' });
  const services = { en: { snapshot: () => snapshot([article]) }, th: { snapshot: () => snapshot([]) } };
  let requests = 0;
  let resolved = null;
  const imageService = {
    peek: () => resolved,
    resolve: async value => { assert.equal(value, article); requests++; resolved = 'https://images.publisher.example/story.jpg'; return resolved; },
  };
  const { app } = createApp({ services, imageService, distPath: '/tmp/ai-brief-no-dist' });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const query of [`/api/article-image/${id}?lang=th`, '/api/article-image/not-a-story?lang=en', '/api/article-image/11111111111111111111?lang=en', '/api/article-image?url=https://localhost/private']) {
    assert.equal((await fetch(base + query)).status, 404);
  }
  assert.equal((await fetch(`${base}/api/article-image/${id}?lang=invalid`)).status, 400);
  assert.equal(requests, 0);
  const response = await fetch(`${base}/api/article-image/${id}?lang=en`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { imageUrl: 'https://images.publisher.example/story.jpg' });
  assert.equal(requests, 1);
  assert.equal((await (await fetch(`${base}/api/news?lang=en`)).json()).articles[0].imageUrl, resolved);
  assert.equal(article.imageUrl, null, 'RSS snapshot remains unchanged');
});
