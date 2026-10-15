import { createApp } from './app.js';

const port = Number(process.env.PORT || 3001);
const { app, services } = createApp();
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`AIBrief listening on http://0.0.0.0:${port}`);
  Object.values(services).forEach(service => service.start());
});

function shutdown() {
  Object.values(services).forEach(service => service.stop());
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
