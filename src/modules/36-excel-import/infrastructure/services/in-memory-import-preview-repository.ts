import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { ImportPreviewRecord } from '../../domain/entities/import-types';
import type { ImportPreviewRepository } from '../../application/ports/import-preview-repository';

/** In-memory preview store for the test harnesses (it can be rolled back with the other in-memory stores). */
export class InMemoryImportPreviewRepository implements ImportPreviewRepository {
  private records = new Map<string, ImportPreviewRecord>();

  async insert(record: ImportPreviewRecord): Promise<void> {
    this.records.set(record.id, record);
  }
  async findById(id: string): Promise<ImportPreviewRecord | undefined> {
    return this.records.get(id);
  }
  async lockById(id: string, _tx: TransactionContext): Promise<ImportPreviewRecord | undefined> {
    return this.records.get(id);
  }
  async update(record: ImportPreviewRecord): Promise<void> {
    const current = this.records.get(record.id);
    if (!current || current.version !== record.version - 1) throw new Error('IMPORT_PREVIEW_CONCURRENT_MODIFICATION');
    this.records.set(record.id, record);
  }
  async expireDue(now: Date, limit: number): Promise<string[]> {
    const fileIds: string[] = [];
    for (const r of [...this.records.values()]) {
      if (fileIds.length >= limit) break;
      if (r.status === 'PENDING' && r.expiresAt.getTime() <= now.getTime()) {
        this.records.set(r.id, { ...r, status: 'EXPIRED', canConfirm: false, sourceRows: null, analysis: null, fileId: null, decidedAt: now, version: r.version + 1 });
        if (r.fileId) fileIds.push(r.fileId);
      }
    }
    return fileIds;
  }

  // RollbackStore (tests): the unit of work restores this store when the work throws.
  snapshot(): unknown {
    return new Map(this.records);
  }
  restore(saved: never): void {
    this.records = new Map(saved as Map<string, ImportPreviewRecord>);
  }
}
