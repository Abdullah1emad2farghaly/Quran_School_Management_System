import { describe, expect, it } from 'vitest';
import { SequelizeUnitOfWork, sequelizeTransactionOf } from '../../../src/modules/02-database/public';

type Tx = { id: number };

/** Fake of Sequelize's managed transaction: commit on resolve, rollback on throw. */
function fakeRunner() {
  const log: string[] = [];
  let counter = 0;
  const runner = {
    async transaction<T>(work: (t: never) => Promise<T>): Promise<T> {
      const tx: Tx = { id: ++counter };
      log.push(`begin:${tx.id}`);
      try {
        const result = await work(tx as never);
        log.push(`commit:${tx.id}`);
        return result;
      } catch (e) {
        log.push(`rollback:${tx.id}`);
        throw e;
      }
    },
  };
  return { runner, log };
}

describe('SequelizeUnitOfWork', () => {
  it('commits and returns the result', async () => {
    const { runner, log } = fakeRunner();
    const result = await new SequelizeUnitOfWork(runner).run(async () => 42);
    expect(result).toBe(42);
    expect(log).toEqual(['begin:1', 'commit:1']);
  });

  it('rolls back and rethrows the original error', async () => {
    const { runner, log } = fakeRunner();
    const boom = new Error('boom');
    let caught: unknown;
    try {
      await new SequelizeUnitOfWork(runner).run(async () => {
        throw boom;
      });
    } catch (e) {
      caught = e;
    }
    expect(caught === boom).toBe(true);
    expect(log).toEqual(['begin:1', 'rollback:1']);
  });

  it('exposes the underlying transaction only through the unwrap helper', async () => {
    const { runner } = fakeRunner();
    await new SequelizeUnitOfWork(runner).run(async (ctx) => {
      expect((sequelizeTransactionOf(ctx) as unknown as Tx).id).toBe(1);
      expect(Object.keys(ctx)).toHaveLength(0);
    });
    expect(sequelizeTransactionOf(undefined)).toBe(undefined);
  });

  it('rejects an unknown context', () => {
    expect(() => sequelizeTransactionOf({} as never)).toThrow();
  });

  it('nested run joins the active transaction (same context, single begin/commit)', async () => {
    const { runner, log } = fakeRunner();
    const uow = new SequelizeUnitOfWork(runner);
    let outerCtx: unknown;
    let innerCtx: unknown;
    await uow.run(async (outer) => {
      outerCtx = outer;
      await uow.run(async (inner) => {
        innerCtx = inner;
      });
    });
    expect(outerCtx === innerCtx).toBe(true);
    expect(log).toEqual(['begin:1', 'commit:1']);
  });

  it('a failure in a nested run rolls back the whole transaction', async () => {
    const { runner, log } = fakeRunner();
    const uow = new SequelizeUnitOfWork(runner);
    try {
      await uow.run(async () => {
        await uow.run(async () => {
          throw new Error('inner');
        });
      });
    } catch {
      /* expected */
    }
    expect(log).toEqual(['begin:1', 'rollback:1']);
  });

  it('does not leak the context after completion (next run opens a new transaction)', async () => {
    const { runner, log } = fakeRunner();
    const uow = new SequelizeUnitOfWork(runner);
    await uow.run(async () => undefined);
    await uow.run(async () => undefined);
    expect(log).toEqual(['begin:1', 'commit:1', 'begin:2', 'commit:2']);
  });
});
