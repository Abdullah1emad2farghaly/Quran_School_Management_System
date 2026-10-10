import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { BootstrapGuard } from '../../application/ports/bootstrap-guard';

/** For tests. There is no real transaction to lock; concurrency is verified against the real database (tests/db). */
export class InMemoryBootstrapGuard implements BootstrapGuard {
  readonly recorded: { userId: string; at: Date }[] = [];
  lockCalls = 0;

  async lockExclusive(_tx: TransactionContext): Promise<void> {
    this.lockCalls += 1;
  }

  async recordBootstrap(input: { userId: string; at: Date }, _tx: TransactionContext): Promise<void> {
    this.recorded.push(input);
  }
}
