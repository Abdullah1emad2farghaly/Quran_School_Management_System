import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { applyTrustedProxies } from '../../src/app/bootstrap/trusted-proxies';

function appWith(trusted: string[]) {
  const app = express();
  applyTrustedProxies(app, trusted);
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
}

describe('trusted proxies (X-Forwarded-For)', () => {
  it('ignores forwarding headers by default, so a client cannot forge its IP', async () => {
    const plain = await request(appWith([])).get('/ip');
    const forged = await request(appWith([])).get('/ip').set('X-Forwarded-For', '203.0.113.9');
    expect(forged.body.ip).toBe(plain.body.ip);
    expect(forged.body.ip).not.toBe('203.0.113.9');
  });

  it('uses the forwarded address only when the connecting proxy is explicitly trusted', async () => {
    const res = await request(appWith(['loopback'])).get('/ip').set('X-Forwarded-For', '203.0.113.9');
    expect(res.body.ip).toBe('203.0.113.9');
  });

  it('does not trust a proxy that is not listed', async () => {
    const res = await request(appWith(['10.9.8.7'])).get('/ip').set('X-Forwarded-For', '203.0.113.9');
    expect(res.body.ip).not.toBe('203.0.113.9');
  });

  it('ignores anything the client appended when the trusted proxy is the nearest hop', async () => {
    // client-supplied "1.1.1.1" is further left than the address the trusted proxy saw (203.0.113.9)
    const res = await request(appWith(['loopback'])).get('/ip').set('X-Forwarded-For', '1.1.1.1, 203.0.113.9');
    expect(res.body.ip).toBe('203.0.113.9');
  });
});
