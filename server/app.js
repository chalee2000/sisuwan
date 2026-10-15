import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { createNewsService } from './news.js';

const defaultDist = fileURLToPath(new URL('../dist', import.meta.url));

export function createApp({ services = { th: createNewsService({ language: 'th' }), en: createNewsService({ language: 'en' }) }, distPath = defaultDist } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.get('/api/health', (_request, response) => {
    const { status, total, loading } = services.th.snapshot();
    response.json({ status: 'ok', newsStatus: status, articles: total, loading });
  });
  app.use('/api', (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const language = request.query.lang ?? 'th';
    if (language !== 'th' && language !== 'en') return response.status(400).json({ error: 'Unsupported language' });
    response.locals.newsService = services[language];
    next();
  });
  app.get('/api/news', (request, response) => {
    const snapshot = response.locals.newsService.snapshot();
    const category = typeof request.query.category === 'string' ? request.query.category : 'all';
    const search = typeof request.query.search === 'string' ? request.query.search.trim().slice(0, 150).toLocaleLowerCase() : '';
    if (category !== 'all' && !snapshot.categories.some(item => item.id === category)) {
      return response.status(400).json({ error: 'Unknown category' });
    }
    const articles = snapshot.articles.filter(article =>
      (category === 'all' || article.categories.includes(category)) &&
      (!search || `${article.title} ${article.summary} ${article.source}`.toLocaleLowerCase().includes(search)));
    response.setHeader('Cache-Control', 'no-store');
    response.json({ ...snapshot, articles, total: articles.length });
  });
  app.get('/api/sources', (_request, response) => {
    const { sources, categories, status, lastUpdated, nextRefreshAt, language, edition } = response.locals.newsService.snapshot();
    response.json({ sources, categories, status, lastUpdated, nextRefreshAt, language, edition });
  });
  app.post('/api/refresh', async (_request, response) => {
    const result = await response.locals.newsService.requestRefresh();
    if (result.retryAfterMs > 0) response.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
    response.status(result.loading ? 202 : 200).json(result);
  });
  app.use('/api', (_request, response) => response.status(404).json({ error: 'Not found' }));
  if (existsSync(path.join(distPath, 'index.html'))) {
    app.use(express.static(distPath, {
      setHeaders(response, filePath) {
        if (path.basename(filePath) === 'sw.js') response.setHeader('Cache-Control', 'no-cache');
      },
    }));
    app.use((request, response, next) => {
      if (request.method !== 'GET' || !request.accepts('html')) return next();
      response.sendFile(path.join(distPath, 'index.html'));
    });
  }
  return { app, services };
}
