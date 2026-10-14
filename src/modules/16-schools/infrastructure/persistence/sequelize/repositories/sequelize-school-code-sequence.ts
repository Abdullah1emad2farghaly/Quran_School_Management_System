import { QueryTypes, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { SchoolCodeSequence } from '../../../../application/ports/school-code-sequence';
import { formatSchoolCode } from '../../../../domain/value-objects/school-code';

type Queryable = Pick<Sequelize, 'query'>;

/**
 * Gap-free codes: the single `school_code_sequence` row is locked (`SELECT ... FOR UPDATE`) and incremented inside the
 * caller's transaction. Concurrent creations queue on that row lock; if the creating transaction rolls back, the
 * increment rolls back with it, so no code is skipped and none is duplicated. (A database AUTO_INCREMENT would
 * burn numbers on rollback, which is why it is not used.)
 */
export class SequelizeSchoolCodeSequence implements SchoolCodeSequence {
  constructor(private readonly db: Queryable) {}

  async allocate(tx: TransactionContext): Promise<string> {
    const transaction = sequelizeTransactionOf(tx) ?? null;
    const rows = await this.db.query<{ lastValue: number | string }>(
      "SELECT last_value AS lastValue FROM school_code_sequence WHERE name = 'school' FOR UPDATE",
      { type: QueryTypes.SELECT, transaction },
    );
    if (rows.length === 0) throw new Error('school_code_sequence is not initialised; run npm run db:migrate');
    const next = Number(rows[0]!.lastValue) + 1;
    await this.db.query("UPDATE school_code_sequence SET last_value = :next, updated_at = UTC_TIMESTAMP(3) WHERE name = 'school'", {
      replacements: { next },
      type: QueryTypes.UPDATE,
      transaction,
    });
    return formatSchoolCode(next);
  }
}
