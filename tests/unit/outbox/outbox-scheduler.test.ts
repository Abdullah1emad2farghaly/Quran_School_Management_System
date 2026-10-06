import { describe, expect, it } from 'vitest';
import { createLogger, type EmittedLevel } from '../../../src/modules/05-logging-request-context/public';
import { OutboxScheduler } from '../../../src/modules/06-domain-events-outbox/public';

const result = (claimed: number) => ({ claimed, processed: claimed, retried: 0, dead: 0 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function memoryLogger() {
  const lines: Array<{ level: EmittedLevel; line: string }> = [];
  const logger = createLogger({ level: 'debug', sink: { write: (level, line) => lines.push({ level, line }) } });
  return { logger, lines };
}

describe('OutboxScheduler', () => {
  it('keeps processing until a batch comes back empty', async () => {
    const claims = [3, 3, 0];
    let calls = 0;
    const s = new OutboxScheduler({ processBatch: async () => result(claims[calls++] ?? 0) }, memoryLogger().logger);
    await s.runOnce();
    expect(calls).toBe(3);
  });
  it('never runs ticks concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    const s = new OutboxScheduler(
      { processBatch: async () => { calls++; active++; maxActive = Math.max(maxActive, active); await sleep(10); active--; return result(0); } },
      memoryLogger().logger,
    );
    await Promise.all([s.runOnce(), s.runOnce(), s.runOnce()]);
    expect(maxActive).toBe(1);
    expect(calls).toBe(1);
  });
  it('logs a persistent failure once instead of flooding the log', async () => {
    const { logger, lines } = memoryLogger();
    const s = new OutboxScheduler({ processBatch: async () => { throw new Error('db down'); } }, logger);
    await s.runOnce();
    await s.runOnce();
    await s.runOnce();
    expect(lines.filter((l) => l.level === 'error')).toHaveLength(1);
  });
  it('keeps running after a failure', async () => {
    let calls = 0;
    const s = new OutboxScheduler({ processBatch: async () => { calls++; if (calls === 1) throw new Error('boom'); return result(0); } }, memoryLogger().logger);
    await s.runOnce();
    await s.runOnce();
    expect(calls).toBe(2);
  });
  it('polls on an interval and stop() waits for the batch in flight', async () => {
    let calls = 0;
    let finished = 0;
    const s = new OutboxScheduler({ processBatch: async () => { calls++; await sleep(5); finished++; return result(0); } }, memoryLogger().logger, { intervalMs: 5 });
    s.start();
    await sleep(60);
    await s.stop();
    const callsAtStop = calls;
    expect(calls >= 2).toBe(true);
    expect(finished).toBe(callsAtStop);
    await sleep(30);
    expect(calls).toBe(callsAtStop);
  });
});
