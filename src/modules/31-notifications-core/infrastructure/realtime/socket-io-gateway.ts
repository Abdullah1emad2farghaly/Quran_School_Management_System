import type { Server as HttpServer } from 'node:http';
import type { Server as IoServer, Socket } from 'socket.io';
import type { NotificationDto } from '../../application/dto/notification-dto';
import { REALTIME_EVENTS, type RealtimeConnectionControl, type RealtimeNotificationGateway } from '../../application/ports/realtime-gateway';

/** The verified caller behind an access token (Module 10's `AuthPrincipal`, reduced to what a connection needs). */
export interface RealtimePrincipal {
  readonly userId: string;
  readonly sessionId: string;
  readonly mustChangePassword: boolean;
}

export interface SocketIoGatewayOptions {
  readonly httpServer: HttpServer;
  /** Verifies an access token exactly like an HTTP request does (valid token, active session, active user). Throws when it is not valid. */
  readonly authenticate: (accessToken: string) => Promise<RealtimePrincipal>;
  readonly corsOrigins: readonly string[];
  readonly path: string;
  readonly pingIntervalMs: number;
  readonly pingTimeoutMs: number;
  /** When an account exceeds it, its OLDEST connection is closed (a reconnect never gets refused because of a half-dead old connection). */
  readonly maxConnectionsPerUser: number;
  readonly onError?: (message: string, error?: unknown) => void;
  /** How long "this session received this notification" is remembered (default 5 minutes). */
  readonly deliveredTtlMs?: number;
  readonly now?: () => number;
}

const MAX_TOKEN_LENGTH = 4096;
const BEARER = /^Bearer\s+(\S+)$/i;
const DEFAULT_DELIVERED_TTL_MS = 5 * 60 * 1000;

class RealtimeAuthError extends Error {
  readonly data: { readonly code: string };
  constructor(code: string) {
    super(code);
    this.data = { code };
  }
}

/** The access token comes from the handshake `auth.token` or the Authorization header, never from the URL (same rule as the HTTP API). */
function tokenOf(socket: Socket): string | null {
  const fromAuth: unknown = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  if (typeof fromAuth === 'string' && fromAuth !== '') return fromAuth.length <= MAX_TOKEN_LENGTH ? fromAuth : null;
  const header = socket.handshake.headers.authorization;
  const match = typeof header === 'string' ? BEARER.exec(header.trim()) : null;
  return match && match[1]!.length <= MAX_TOKEN_LENGTH ? match[1]! : null;
}

const userRoom = (userId: string): string => `user:${userId}`;

/**
 * Socket.IO implementation of the real-time gateway. Security rules:
 *  - every connection is authenticated on the server with the SAME check as an HTTP request; there is no anonymous connection;
 *  - the user id and session id come only from the verified token, never from the client; the connection joins exactly one room, `user:<verified id>`, chosen by the
 *    server. The client sends no events and cannot join, leave or name a room;
 *  - an account with a pending mandatory password change gets no connection (same as the HTTP notification endpoints);
 *  - the payload is the notification the same account can read through `GET /notifications`, nothing else.
 * Connections live in memory only: nothing about them is stored. Several devices of one account are several connections (possibly one per session).
 * This is a single-process registry: running several server instances needs sticky sessions and a shared adapter (see docs/NOTIFICATIONS.md).
 */
export class SocketIoNotificationGateway implements RealtimeNotificationGateway, RealtimeConnectionControl {
  /** userId -> sessionId -> socket ids (insertion ordered, so the first user socket is the oldest). */
  private readonly connections = new Map<string, Map<string, Set<string>>>();
  private readonly sessionOwner = new Map<string, string>();
  /** notificationId -> sessions reached (insertion ordered by time, pruned on publish). */
  private readonly delivered = new Map<string, { readonly at: number; readonly sessionIds: ReadonlySet<string> }>();
  private readonly now: () => number;
  private readonly deliveredTtlMs: number;

  private constructor(
    private readonly io: IoServer,
    private readonly options: SocketIoGatewayOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.deliveredTtlMs = options.deliveredTtlMs ?? DEFAULT_DELIVERED_TTL_MS;
    this.install();
  }

  /** `socket.io` is loaded here, only when real-time is enabled. */
  static async create(options: SocketIoGatewayOptions): Promise<SocketIoNotificationGateway> {
    const { Server } = await import('socket.io');
    const io = new Server(options.httpServer, {
      path: options.path,
      serveClient: false,
      cors: { origin: options.corsOrigins.length > 0 ? [...options.corsOrigins] : false },
      pingInterval: options.pingIntervalMs,
      pingTimeout: options.pingTimeoutMs,
      maxHttpBufferSize: 1024, // the client sends nothing meaningful
      connectTimeout: 10_000,
    });
    return new SocketIoNotificationGateway(io, options);
  }

  // ---- RealtimeNotificationGateway ----
  isUserOnline(userId: string): boolean {
    return (this.connections.get(userId)?.size ?? 0) > 0;
  }

  isSessionOnline(sessionId: string): boolean {
    return this.sessionOwner.has(sessionId);
  }

  publishNotification(userId: string, notification: NotificationDto): readonly string[] {
    const sessions = this.connections.get(userId);
    if (!sessions || sessions.size === 0) return [];
    this.io.to(userRoom(userId)).emit(REALTIME_EVENTS.NOTIFICATION_NEW, notification);
    const sessionIds = [...sessions.keys()];
    this.prune();
    this.delivered.delete(notification.id);
    this.delivered.set(notification.id, { at: this.now(), sessionIds: new Set(sessionIds) });
    return sessionIds;
  }

  wasDeliveredToSession(sessionId: string, notificationId: string): boolean {
    return this.delivered.get(notificationId)?.sessionIds.has(sessionId) ?? false;
  }

  // ---- RealtimeConnectionControl ----
  disconnectSession(sessionId: string): void {
    const userId = this.sessionOwner.get(sessionId);
    const socketIds = userId ? this.connections.get(userId)?.get(sessionId) : undefined;
    if (!socketIds) return;
    for (const id of [...socketIds]) this.io.sockets.sockets.get(id)?.disconnect(true);
  }

  /** Closes every connection and the Socket.IO server (it also closes the underlying HTTP server). */
  async close(): Promise<void> {
    this.io.disconnectSockets(true);
    await new Promise<void>((resolve) => void this.io.close(() => resolve()));
    this.connections.clear();
    this.sessionOwner.clear();
    this.delivered.clear();
  }

  /** Number of live connections (for logs and tests). */
  get connectionCount(): number {
    let n = 0;
    for (const sessions of this.connections.values()) for (const ids of sessions.values()) n += ids.size;
    return n;
  }

  // ---- internals ----
  private install(): void {
    this.io.use((socket, next) => {
      void this.authenticate(socket).then(
        () => next(),
        (error: unknown) => next(error instanceof RealtimeAuthError ? error : new RealtimeAuthError('AUTHENTICATION_FAILED')),
      );
    });
    this.io.on('connection', (socket) => this.onConnection(socket));
  }

  private async authenticate(socket: Socket): Promise<void> {
    const token = tokenOf(socket);
    if (token === null) throw new RealtimeAuthError('AUTHENTICATION_REQUIRED');
    let principal: RealtimePrincipal;
    try {
      principal = await this.options.authenticate(token);
    } catch {
      throw new RealtimeAuthError('AUTHENTICATION_FAILED'); // expired, malformed, revoked session, inactive user: one answer, no detail
    }
    if (principal.mustChangePassword) throw new RealtimeAuthError('PASSWORD_CHANGE_REQUIRED');
    socket.data.userId = principal.userId;
    socket.data.sessionId = principal.sessionId;
  }

  private onConnection(socket: Socket): void {
    const userId = socket.data.userId as string | undefined;
    const sessionId = socket.data.sessionId as string | undefined;
    if (!userId || !sessionId) {
      socket.disconnect(true); // cannot happen after the middleware; refuse anything unverified
      return;
    }
    this.register(userId, sessionId, socket.id);
    void socket.join(userRoom(userId)); // the ONLY room, derived from the verified token
    socket.on('error', (error) => this.options.onError?.('socket error', error));
    socket.on('disconnect', () => this.unregister(userId, sessionId, socket.id));
    socket.emit(REALTIME_EVENTS.READY, { serverTime: new Date(this.now()).toISOString() });
    this.enforceLimit(userId);
  }

  private register(userId: string, sessionId: string, socketId: string): void {
    let sessions = this.connections.get(userId);
    if (!sessions) this.connections.set(userId, (sessions = new Map()));
    let sockets = sessions.get(sessionId);
    if (!sockets) sessions.set(sessionId, (sockets = new Set()));
    sockets.add(socketId);
    this.sessionOwner.set(sessionId, userId);
  }

  private unregister(userId: string, sessionId: string, socketId: string): void {
    const sessions = this.connections.get(userId);
    const sockets = sessions?.get(sessionId);
    if (!sessions || !sockets) return;
    sockets.delete(socketId);
    if (sockets.size === 0) {
      sessions.delete(sessionId);
      this.sessionOwner.delete(sessionId);
    }
    if (sessions.size === 0) this.connections.delete(userId);
  }

  private enforceLimit(userId: string): void {
    const sessions = this.connections.get(userId);
    if (!sessions) return;
    const all = [...sessions.values()].flatMap((ids) => [...ids]);
    for (const id of all.slice(0, Math.max(0, all.length - this.options.maxConnectionsPerUser))) this.io.sockets.sockets.get(id)?.disconnect(true);
  }

  private prune(): void {
    const cutoff = this.now() - this.deliveredTtlMs;
    for (const [id, entry] of this.delivered) {
      if (entry.at >= cutoff) break; // insertion order = time order
      this.delivered.delete(id);
    }
  }
}
