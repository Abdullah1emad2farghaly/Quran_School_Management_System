import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { FileStorage } from '../../application/ports/file-storage';
import type { StoredFileRepository } from '../../application/ports/stored-file-repository';
import type { StoredFile } from '../../domain/value-objects/stored-file';

/** In-memory adapters for tests of modules that store or read files. */
export class InMemoryFileStorage implements FileStorage {
  readonly blobs = new Map<string, Buffer>();
  async put(key: string, data: Buffer): Promise<void> {
    this.blobs.set(key, Buffer.from(data));
  }
  async get(key: string): Promise<Buffer | undefined> {
    const data = this.blobs.get(key);
    return data ? Buffer.from(data) : undefined;
  }
  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }
  async exists(key: string): Promise<boolean> {
    return this.blobs.has(key);
  }
}

export class InMemoryStoredFileRepository implements StoredFileRepository {
  readonly files = new Map<string, { file: StoredFile; deletedAt: Date | null }>();
  async insert(file: StoredFile, _tx?: TransactionContext): Promise<void> {
    this.files.set(file.id, { file, deletedAt: null });
  }
  async findById(id: string): Promise<StoredFile | undefined> {
    const entry = this.files.get(id);
    return entry && entry.deletedAt === null ? entry.file : undefined;
  }
  async markDeleted(id: string, at: Date): Promise<void> {
    const entry = this.files.get(id);
    if (entry) entry.deletedAt = at;
  }
}
