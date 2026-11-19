import { pageOffset, type PageRequest } from '../../../00-shared-kernel/public';
import type { AuditRecord } from '../../domain/entities/audit-record';
import type { AuditFilter, AuditRepository, AuditVisibility } from '../../application/ports/audit-repository';

const visible = (v: AuditVisibility, r: AuditRecord): boolean =>
  v.all || (r.organizationId !== null && v.organizationIds.includes(r.organizationId)) || (r.schoolId !== null && v.schoolIds.includes(r.schoolId));

const matches = (f: AuditFilter, r: AuditRecord): boolean =>
  (f.module === undefined || r.module === f.module) &&
  (f.action === undefined || f.action.length === 0 || f.action.includes(r.action)) &&
  (f.entityType === undefined || r.entityType === f.entityType) &&
  (f.entityId === undefined || r.entityId === f.entityId) &&
  (f.actorUserId === undefined || r.actorUserId === f.actorUserId) &&
  (f.organizationId === undefined || r.organizationId === f.organizationId) &&
  (f.schoolId === undefined || r.schoolId === f.schoolId) &&
  (f.from === undefined || r.occurredAt.getTime() >= f.from.getTime()) &&
  (f.to === undefined || r.occurredAt.getTime() < f.to.getTime());

/** In-memory audit repository with the same rules as the MariaDB one (unique event id, visibility on every read, no update, no delete). For tests. */
export class InMemoryAuditRepository implements AuditRepository {
  readonly records = new Map<string, AuditRecord>();

  async insert(record: AuditRecord): Promise<boolean> {
    if ([...this.records.values()].some((r) => r.eventId === record.eventId)) return false;
    this.records.set(record.id, { ...record });
    return true;
  }

  async list(visibility: AuditVisibility, filter: AuditFilter, options: { newestFirst: boolean; page: PageRequest }) {
    const all = [...this.records.values()]
      .filter((r) => visible(visibility, r) && matches(filter, r))
      .sort((a, b) => (a.occurredAt.getTime() - b.occurredAt.getTime() || a.id.localeCompare(b.id)) * (options.newestFirst ? -1 : 1));
    const offset = pageOffset(options.page);
    return { items: all.slice(offset, offset + options.page.pageSize).map((r) => ({ ...r })), total: all.length };
  }

  async findVisibleById(visibility: AuditVisibility, id: string): Promise<AuditRecord | null> {
    const r = this.records.get(id);
    return r && visible(visibility, r) ? { ...r } : null;
  }
}
