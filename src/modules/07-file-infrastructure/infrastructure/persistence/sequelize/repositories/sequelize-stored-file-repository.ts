import { QueryTypes, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { StoredFileRepository } from '../../../../application/ports/stored-file-repository';
import type { StoredFile } from '../../../../domain/value-objects/stored-file';

type Queryable = Pick<Sequelize, 'query'>;

interface StoredFileRow {
  id: string;
  originalName: string;
  storageKey: string;
  extension: string;
  mimeType: string;
  sizeBytes: number | string;
  sha256: string;
  purpose: string;
  ownerUserId: string | null;
  createdAt: Date | string;
}

export class SequelizeStoredFileRepository implements StoredFileRepository {
  constructor(private readonly db: Queryable) {}

  async insert(file: StoredFile, tx?: TransactionContext): Promise<void> {
    const transaction = sequelizeTransactionOf(tx);
    await this.db.query(
      `INSERT INTO stored_files
         (id, original_name, storage_key, extension, mime_type, size_bytes, sha256, purpose,
          owner_user_id, created_at, updated_at)
       VALUES
         (:id, :originalName, :storageKey, :extension, :mimeType, :sizeBytes, :sha256, :purpose,
          :ownerUserId, :createdAt, :createdAt)`,
      { replacements: { ...file }, ...(transaction ? { transaction } : {}) },
    );
  }

  async findById(id: string): Promise<StoredFile | undefined> {
    const rows = await this.db.query<StoredFileRow>(
      `SELECT id, original_name AS originalName, storage_key AS storageKey, extension,
              mime_type AS mimeType, size_bytes AS sizeBytes, sha256, purpose,
              owner_user_id AS ownerUserId, created_at AS createdAt
         FROM stored_files
        WHERE id = :id AND deleted_at IS NULL`,
      { replacements: { id }, type: QueryTypes.SELECT },
    );
    const r = rows[0];
    if (!r) return undefined;
    return {
      id: r.id,
      originalName: r.originalName,
      storageKey: r.storageKey,
      extension: r.extension,
      mimeType: r.mimeType,
      sizeBytes: Number(r.sizeBytes),
      sha256: r.sha256,
      purpose: r.purpose,
      ownerUserId: r.ownerUserId,
      createdAt: r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt),
    };
  }

  async markDeleted(id: string, at: Date): Promise<void> {
    await this.db.query(
      'UPDATE stored_files SET deleted_at = :at, updated_at = :at WHERE id = :id AND deleted_at IS NULL',
      { replacements: { id, at } },
    );
  }
}
