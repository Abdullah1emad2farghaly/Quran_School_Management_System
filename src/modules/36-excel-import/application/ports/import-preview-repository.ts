import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { ImportPreviewRecord } from '../../domain/entities/import-types';

/** Persistence of previews (the only table of Module 36). A preview is private to its creator and expires 24 hours after it is created. */
export interface ImportPreviewRepository {
  insert(record: ImportPreviewRecord, tx: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<ImportPreviewRecord | undefined>;
  /** FOR UPDATE: serializes two confirmations (or a confirmation and a cancellation) of the same preview. */
  lockById(id: string, tx: TransactionContext): Promise<ImportPreviewRecord | undefined>;
  /** Optimistic lock on `version`. */
  update(record: ImportPreviewRecord, tx: TransactionContext): Promise<void>;
  /** PENDING previews whose expiry passed: their personal data is removed and they become EXPIRED. Returns the stored file ids to delete. */
  expireDue(now: Date, limit: number, tx: TransactionContext): Promise<string[]>;
}
