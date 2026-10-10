import { QueryTypes, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { BootstrapGuard } from '../../../../application/ports/bootstrap-guard';
import { authorizationConfigError } from '../../../../domain/errors/authorization-errors';

type Queryable = Pick<Sequelize, 'query'>;

/**
 * Row lock on the single `authorization_bootstrap_lock` row (created by the migration). `SELECT ... FOR UPDATE` makes a
 * second concurrent bootstrap wait until the first transaction ends; by then it sees the new Main Admin and refuses.
 */
export class SequelizeBootstrapGuard implements BootstrapGuard {
  constructor(private readonly db: Queryable) {}

  async lockExclusive(tx: TransactionContext): Promise<void> {
    const rows = await this.db.query('SELECT id FROM authorization_bootstrap_lock WHERE id = 1 FOR UPDATE', {
      type: QueryTypes.SELECT,
      transaction: sequelizeTransactionOf(tx) ?? null,
    });
    // Missing row = the migration has not been run: fail closed instead of bootstrapping without the lock.
    if (rows.length !== 1) throw authorizationConfigError('authorization_bootstrap_lock row is missing; run npm run db:migrate');
  }

  async recordBootstrap(input: { userId: string; at: Date }, tx: TransactionContext): Promise<void> {
    await this.db.query(
      `UPDATE authorization_bootstrap_lock
          SET last_bootstrap_user_id = :userId, last_bootstrapped_at = :at, updated_at = :at
        WHERE id = 1`,
      { replacements: { userId: input.userId, at: input.at }, type: QueryTypes.UPDATE, transaction: sequelizeTransactionOf(tx) ?? null },
    );
  }
}
