import { describe, expect, it } from 'vitest';
import { AppError, SystemClock } from '../../../src/modules/00-shared-kernel/public';
import { AuthSession } from '../../../src/modules/10-sessions-jwt/domain/entities/auth-session';
import {
  SequelizeSessionRepository,
  isDeadlockError,
} from '../../../src/modules/10-sessions-jwt/infrastructure/persistence/sequelize/repositories/sequelize-session-repository';

/** What mysql2 / Sequelize report for an InnoDB deadlock: a DatabaseError whose `parent` carries errno 1213. */
function deadlock(): Error {
  const error = new Error('Deadlock found when trying to get lock; try restarting transaction') as Error & {
    parent: { errno: number; code: string };
  };
  error.parent = { errno: 1213, code: 'ER_LOCK_DEADLOCK' };
  return error;
}

function failingDb(error: Error) {
  return { query: () => Promise.reject(error) } as never;
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return 'OK';
}

describe('isDeadlockError', () => {
  it('recognises InnoDB deadlocks on the error, its parent or its original', () => {
    expect(isDeadlockError(deadlock())).toBe(true);
    expect(isDeadlockError({ errno: 1213 })).toBe(true);
    expect(isDeadlockError({ original: { code: 'ER_LOCK_DEADLOCK' } })).toBe(true);
  });

  it('ignores every other error', () => {
    expect(isDeadlockError(new Error('boom'))).toBe(false);
    expect(isDeadlockError({ parent: { errno: 1062 } })).toBe(false);
    expect(isDeadlockError(undefined)).toBe(false);
    expect(isDeadlockError(null)).toBe(false);
  });
});

describe('SequelizeSessionRepository deadlock handling', () => {
  it('reports a deadlock as the retryable SESSION_CONCURRENT_MODIFICATION', async () => {
    const repository = new SequelizeSessionRepository(failingDb(deadlock()));
    const session = AuthSession.start({ userId: 'u1', clock: new SystemClock() });

    expect(await codeOf(repository.insertSession(session, undefined as never))).toBe('SESSION_CONCURRENT_MODIFICATION');
    expect(await codeOf(repository.lockActiveSessionByUser('u1', undefined as never))).toBe('SESSION_CONCURRENT_MODIFICATION');
    expect(await codeOf(repository.updateSession(session, undefined as never))).toBe('SESSION_CONCURRENT_MODIFICATION');
  });

  it('lets any other database error through unchanged', async () => {
    const boom = new Error('connection lost');
    const repository = new SequelizeSessionRepository(failingDb(boom));
    await expect(repository.lockActiveSessionByUser('u1', undefined as never)).rejects.toBe(boom);
  });
});
