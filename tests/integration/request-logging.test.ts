import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { errorHandler, notFoundHandler } from '../../src/app/middleware/error-handler.middleware';
import { requestContextMiddleware } from '../../src/app/middleware/request-context.middleware';
import {
  createLogger,
  createRequestLogger,
  type EmittedLevel,
} from '../../src/modules/05-logging-request-context/public';

function build() {
  const lines: Array<{ level: EmittedLevel; entry: Record<string, unknown> }> = [];
  const logger = createLogger({ level: 'debug', sink: { write: (level, line) => lines.push({ level, entry: JSON.parse(line) }) } });
  const app = express();
  app.use(requestContextMiddleware);
  app.use(createRequestLogger(logger));
  app.use(express.json());
  app.get('/ok', (_req, res) => { res.json({ ok: true }); });
  app.post('/secret', (_req, res) => { res.json({ ok: true }); });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return { app, lines };
}

describe('request logging', () => {
  it('logs one entry per request with the request id, without the query string', async () => {
    const { app, lines } = build();
    const res = await request(app).get('/ok?token=abc123&page=2');
    expect(lines).toHaveLength(1);
    const { level, entry } = lines[0]!;
    expect(level).toBe('info');
    expect(entry.method).toBe('GET');
    expect(entry.path).toBe('/ok');
    expect(entry.status).toBe(200);
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.requestId).toBe(res.headers['x-request-id']);
    expect(JSON.stringify(entry).includes('abc123')).toBe(false);
  });
  it('uses warn for 4xx', async () => {
    const { app, lines } = build();
    await request(app).get('/missing');
    expect(lines[0]?.level).toBe('warn');
    expect(lines[0]?.entry.status).toBe(404);
  });
  it('never logs request bodies or headers', async () => {
    const { app, lines } = build();
    await request(app).post('/secret').set('Authorization', 'Bearer topsecret').send({ password: 'hunter2' });
    const text = JSON.stringify(lines);
    expect(text.includes('hunter2')).toBe(false);
    expect(text.includes('topsecret')).toBe(false);
  });
  it('reuses a safe client request id in the log', async () => {
    const { app, lines } = build();
    await request(app).get('/ok').set('X-Request-Id', 'client-req-12345');
    expect(lines[0]?.entry.requestId).toBe('client-req-12345');
  });
});
