import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { UserRepository } from '../../../../application/ports/user-repository';
import { User } from '../../../../domain/entities/user';
import { identityError } from '../../../../domain/errors/identity-errors';
import type { UserStatus } from '../../../../domain/value-objects/user-status';

type Queryable = Pick<Sequelize, 'query'>;

interface UserRow {
  id: string;
  phone: string;
  passwordHash: string;
  status: UserStatus;
  statusChangedAt: Date | string;
  version: number | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

const SELECT_USER = `
  SELECT id, phone, password_hash AS passwordHash, status, status_changed_at AS statusChangedAt,
         version, created_at AS createdAt, updated_at AS updatedAt
    FROM users`;

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

export class SequelizeUserRepository implements UserRepository {
  constructor(private readonly db: Queryable) {}

  async insert(user: User, tx: TransactionContext): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO users
           (id, phone, password_hash, status, status_changed_at, version, created_at, updated_at)
         VALUES
           (:id, :phone, :passwordHash, :status, :statusChangedAt, 1, :createdAt, :updatedAt)`,
        {
          replacements: {
            id: user.id,
            phone: user.phone,
            passwordHash: user.passwordHash,
            status: user.status,
            statusChangedAt: user.statusChangedAt,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          },
          transaction: sequelizeTransactionOf(tx) ?? null,
        },
      );
    } catch (error) {
      // The unique index on phone is the final guard against concurrent creation of the same phone.
      if (error instanceof UniqueConstraintError) throw identityError('USER_PHONE_ALREADY_EXISTS');
      throw error;
    }
  }

  async update(user: User, tx: TransactionContext): Promise<void> {
    const [, affectedRows] = await this.db.query(
      `UPDATE users
          SET password_hash = :passwordHash, status = :status, status_changed_at = :statusChangedAt,
              updated_at = :updatedAt, version = version + 1
        WHERE id = :id AND version = :version`,
      {
        replacements: {
          id: user.id,
          version: user.version,
          passwordHash: user.passwordHash,
          status: user.status,
          statusChangedAt: user.statusChangedAt,
          updatedAt: user.updatedAt,
        },
        type: QueryTypes.UPDATE,
        transaction: sequelizeTransactionOf(tx) ?? null,
      },
    );
    if (Number(affectedRows) !== 1) throw identityError('USER_CONCURRENT_MODIFICATION');
  }

  findById(id: string, tx?: TransactionContext): Promise<User | undefined> {
    return this.findOne(`${SELECT_USER} WHERE id = :id`, { id }, tx);
  }

  findByPhone(phone: string, tx?: TransactionContext): Promise<User | undefined> {
    return this.findOne(`${SELECT_USER} WHERE phone = :phone`, { phone }, tx);
  }

  private async findOne(sql: string, replacements: Record<string, string>, tx?: TransactionContext): Promise<User | undefined> {
    const rows = await this.db.query<UserRow>(sql, {
      replacements,
      type: QueryTypes.SELECT,
      transaction: sequelizeTransactionOf(tx) ?? null,
    });
    const r = rows[0];
    if (!r) return undefined;
    return User.rehydrate({
      id: r.id,
      phone: r.phone,
      passwordHash: r.passwordHash,
      status: r.status,
      statusChangedAt: asDate(r.statusChangedAt),
      version: Number(r.version),
      createdAt: asDate(r.createdAt),
      updatedAt: asDate(r.updatedAt),
    });
  }
}
