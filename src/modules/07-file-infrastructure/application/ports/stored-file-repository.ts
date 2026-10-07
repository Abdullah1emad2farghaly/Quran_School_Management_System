import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { StoredFile } from '../../domain/value-objects/stored-file';

export interface StoredFileRepository {
  /** Pass the caller's transaction to make the metadata atomic with other changes. */
  insert(file: StoredFile, tx?: TransactionContext): Promise<void>;
  /** Only files that are not deleted. */
  findById(id: string): Promise<StoredFile | undefined>;
  markDeleted(id: string, at: Date): Promise<void>;
}
