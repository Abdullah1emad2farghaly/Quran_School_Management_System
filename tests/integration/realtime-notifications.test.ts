import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket as ClientSocket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REALTIME_EVENTS, SocketIoNotificationGateway, type NotificationDto } from '../../src/modules/31-notifications-core/public';

// Real Socket.IO server + real Socket.IO clients over a real HTTP server. Tokens are `<userId>|<sessionId>` (or `pending|...`); the fake `authenticate` stands in for Module 10.
const ALICE = 'alice';
const BOB = 'bob';
const note = (id: string): NotificationDto => ({ id, type: 'T', title: 'title', body: 'body', data: null, readAt: null, createdAt: new Date('2026-11-16T09:00:00Z') });

let http: Server;
let gateway: SocketIoNotificationGateway;
let url: string;
const clients: ClientSocket[] = [];

function open(token: string | undefined): ClientSocket {
  const socket = connect(url, { path: '/socket.io', transports: ['websocket'], reconnection: false, auth: token === undefined ? {} : { token }, forceNew: true });
  clients.push(socket);
  return socket;
}
const once = <T = unknown>(socket: ClientSocket, event: string, ms = 2000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => { clearTimeout(timer); resolve(payload); });
  });
const connected = async (token: string) => {
  const socket = open(token);
  await once(socket, REALTIME_EVENTS.READY);
  return socket;
};
const silent = (socket: ClientSocket, event: string, ms = 300) =>
  new Promise<boolean>((resolve) => { const t = setTimeout(() => resolve(true), ms); socket.once(event, () => { clearTimeout(t); resolve(false); }); });

beforeAll(async () => {
  http = createServer();
  gateway = await SocketIoNotificationGateway.create({
    httpServer: http,
    authenticate: async (token) => {
      const [userId, sessionId] = token.split('|');
      if (!userId || !sessionId || userId === 'invalid') throw new Error('invalid token');
      return { userId, sessionId, mustChangePassword: userId === 'pending' };
    },
    corsOrigins: ['http://localhost:5173'],
    path: '/socket.io',
    pingIntervalMs: 5000,
    pingTimeoutMs: 5000,
    maxConnectionsPerUser: 3,
  });
  await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const c of clients) c.close();
  await gateway.close();
});

describe('authentication of connections', () => {
  it('refuses a connection without a token, with an invalid token, or with a pending password change', async () => {
    for (const token of [undefined, 'invalid|s1', 'garbage', 'pending|s1']) {
      const socket = open(token);
      const error = await once<Error & { data?: { code: string } }>(socket, 'connect_error');
      expect(error.data?.code).toMatch(/AUTHENTICATION_REQUIRED|AUTHENTICATION_FAILED|PASSWORD_CHANGE_REQUIRED/);
      expect(socket.connected).toBe(false);
    }
  });

  it('never reads the token from the URL', async () => {
    const socket = connect(`${url}?token=alice|s1`, { path: '/socket.io', transports: ['websocket'], reconnection: false, forceNew: true });
    clients.push(socket);
    expect((await once<Error & { data?: { code: string } }>(socket, 'connect_error')).data?.code).toBe('AUTHENTICATION_REQUIRED');
  });
});

describe('delivery', () => {
  it('delivers to every device of the account and to nobody else', async () => {
    const desktop = await connected(`${ALICE}|s-desktop`);
    const mobile = await connected(`${ALICE}|s-mobile`);
    const bob = await connected(`${BOB}|s-bob`);
    const got = [once<NotificationDto>(desktop, REALTIME_EVENTS.NOTIFICATION_NEW), once<NotificationDto>(mobile, REALTIME_EVENTS.NOTIFICATION_NEW)];
    const bobSilent = silent(bob, REALTIME_EVENTS.NOTIFICATION_NEW);
    expect([...gateway.publishNotification(ALICE, note('n1'))].sort()).toEqual(['s-desktop', 's-mobile']);
    expect((await Promise.all(got)).map((n) => n.id)).toEqual(['n1', 'n1']);
    expect(await bobSilent).toBe(true);
    expect(gateway.wasDeliveredToSession('s-desktop', 'n1')).toBe(true);
    expect(gateway.wasDeliveredToSession('s-bob', 'n1')).toBe(false);
  });

  it('a client cannot join another account\'s room or name a user id', async () => {
    const mallory = await connected('mallory|s-m');
    mallory.emit('join', 'user:alice');
    mallory.emit('join-room', { room: 'user:alice' });
    const nothing = silent(mallory, REALTIME_EVENTS.NOTIFICATION_NEW);
    await connected(`${ALICE}|s-a2`);
    gateway.publishNotification(ALICE, note('n2'));
    expect(await nothing).toBe(true);
  });

  it('an offline account reports nobody reached', () => {
    expect(gateway.isUserOnline('nobody')).toBe(false);
    expect(gateway.publishNotification('nobody', note('n3'))).toEqual([]);
  });
});

describe('disconnection and reconnection', () => {
  it('closes only the revoked session and cleans up; a new connection works again and is told to resync', async () => {
    const keep = await connected(`${ALICE}|s-keep`);
    const gone = await connected(`${ALICE}|s-gone`);
    const closed = new Promise<void>((resolve) => gone.once('disconnect', () => resolve()));
    gateway.disconnectSession('s-gone');
    await closed;
    expect(gateway.isSessionOnline('s-gone')).toBe(false);
    expect(gateway.isSessionOnline('s-keep')).toBe(true);
    expect(keep.connected).toBe(true);

    const again = open(`${ALICE}|s-gone`);
    await once(again, REALTIME_EVENTS.READY); // after every (re)connection the client refetches through the notification APIs
    expect(gateway.isSessionOnline('s-gone')).toBe(true);
  });

  it('closes the oldest connection when an account exceeds the limit', async () => {
    const sockets = [] as ClientSocket[];
    for (let i = 0; i < 4; i += 1) sockets.push(await connected(`limit|s-limit-${i}`));
    await new Promise((r) => setTimeout(r, 300));
    expect(sockets.filter((s) => s.connected)).toHaveLength(3);
  });
});
