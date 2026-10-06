import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../../src/modules/00-shared-kernel/public';
import {
  createLogger,
  requestContext,
  type EmittedLevel,
  type LogSink,
} from '../../../src/modules/05-logging-request-context/public';

function memorySink() {
  const lines: Array<{ level: EmittedLevel; entry: Record<string, unknown> }> = [];
  const sink: LogSink = { write: (level, line) => lines.push({ level, entry: JSON.parse(line) }) };
  return { sink, lines };
}
const clock = new FixedClock(new Date('2026-01-01T00:00:00Z'));

describe('structured logger', () => {
  it('writes one JSON entry with level, time and message', () => {
    const { sink, lines } = memorySink();
    createLogger({ level: 'info', sink, clock }).info('hello', { a: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.entry).toEqual({ level: 'info', time: '2026-01-01T00:00:00.000Z', msg: 'hello', a: 1 });
  });
  it('filters by level', () => {
    const { sink, lines } = memorySink();
    const log = createLogger({ level: 'warn', sink, clock });
    log.debug('d'); log.info('i'); log.warn('w'); log.error('e');
    expect(lines.map((l) => l.level)).toEqual(['warn', 'error']);
  });
  it('silent writes nothing', () => {
    const { sink, lines } = memorySink();
    const log = createLogger({ level: 'silent', sink, clock });
    log.error('e');
    expect(lines).toHaveLength(0);
  });
  it('redacts secrets in fields and messages', () => {
    const { sink, lines } = memorySink();
    createLogger({ level: 'info', sink, clock }).info('login with Bearer abc123', {
      password: 'hunter2', otp: '999999', refreshToken: 'r', user: 'ali',
    });
    const text = JSON.stringify(lines[0]?.entry);
    for (const secret of ['hunter2', '999999', 'abc123', '"r"']) expect(text.includes(secret)).toBe(false);
    expect(lines[0]?.entry.user).toBe('ali');
  });
  it('cannot have reserved keys overridden by fields', () => {
    const { sink, lines } = memorySink();
    createLogger({ level: 'info', sink, clock }).info('real', { level: 'fake', time: 'fake', msg: 'fake' });
    expect(lines[0]?.entry.level).toBe('info');
    expect(lines[0]?.entry.msg).toBe('real');
    expect(lines[0]?.entry.time).toBe('2026-01-01T00:00:00.000Z');
  });
  it('child loggers add bindings', () => {
    const { sink, lines } = memorySink();
    createLogger({ level: 'info', sink, clock, bindings: { service: 's' } }).child({ module: 'm' }).info('x');
    expect(lines[0]?.entry.service).toBe('s');
    expect(lines[0]?.entry.module).toBe('m');
  });
  it('includes request context automatically, only inside a request', async () => {
    const { sink, lines } = memorySink();
    const log = createLogger({ level: 'info', sink, clock });
    log.info('outside');
    await requestContext.run({ requestId: 'req-12345678', locale: 'ar' }, async () => {
      await Promise.resolve();
      requestContext.update({ actorUserId: 'user-1' });
      log.info('inside');
    });
    expect('requestId' in (lines[0]?.entry ?? {})).toBe(false);
    expect(lines[1]?.entry.requestId).toBe('req-12345678');
    expect(lines[1]?.entry.actorUserId).toBe('user-1');
  });
  it('logs errors with stack but without crashing on circular fields', () => {
    const { sink, lines } = memorySink();
    const circular: Record<string, unknown> = {};
    circular.me = circular;
    createLogger({ level: 'info', sink, clock }).error('boom', { err: new Error('bad'), circular });
    expect((lines[0]?.entry.err as Record<string, unknown>).message).toBe('bad');
    expect((lines[0]?.entry.circular as Record<string, unknown>).me).toBe('[Circular]');
  });
});

describe('requestContext', () => {
  it('isolates concurrent requests', async () => {
    const seen: string[] = [];
    await Promise.all(
      ['a', 'b'].map((id) =>
        requestContext.run({ requestId: `req-${id}-0000`, locale: 'en' }, async () => {
          await new Promise((r) => setTimeout(r, id === 'a' ? 10 : 1));
          seen.push(requestContext.requestId() ?? 'none');
        }),
      ),
    );
    expect(seen.sort()).toEqual(['req-a-0000', 'req-b-0000']);
  });
  it('update is a no-op outside a request', () => {
    requestContext.update({ actorUserId: 'x' });
    expect(requestContext.get()).toBe(undefined);
  });
});
