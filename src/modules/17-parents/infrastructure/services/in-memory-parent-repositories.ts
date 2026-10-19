import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { ParentAddressEntry, ParentListQuery, ParentRepository } from '../../application/ports/parent-repository';
import type { ParentSchoolLinkRepository } from '../../application/ports/parent-school-link-repository';
import { Parent, type ParentSnapshot } from '../../domain/entities/parent';
import { ParentSchoolLink, type ParentSchoolLinkSnapshot } from '../../domain/entities/parent-school-link';
import { parentError } from '../../domain/errors/parent-errors';

/** In-memory ParentRepository with the same uniqueness, ordering and optimistic-lock behavior as the SQL one. For tests of this and other modules. */
export class InMemoryParentRepository implements ParentRepository {
  readonly rows = new Map<string, ParentSnapshot>();
  readonly addresses: ParentAddressEntry[] = [];
  /** Set by the composition (tests) so `listBySchool` can see the links; the SQL version joins `parent_schools`. */
  activeParentIdsOfSchool: (schoolId: string) => string[] = () => [];

  async insert(parent: Parent, _tx: TransactionContext): Promise<void> {
    for (const row of this.rows.values()) if (row.userId === parent.userId) throw parentError('PARENT_CONCURRENT_MODIFICATION');
    this.rows.set(parent.id, { ...parent.snapshot, version: 1 });
  }
  async update(parent: Parent, _tx: TransactionContext): Promise<void> {
    const row = this.rows.get(parent.id);
    if (!row || row.version !== parent.version) throw parentError('PARENT_CONCURRENT_MODIFICATION');
    this.rows.set(parent.id, { ...parent.snapshot, version: parent.version + 1 });
  }
  async findById(id: string, _tx?: TransactionContext): Promise<Parent | undefined> {
    const row = this.rows.get(id);
    return row ? Parent.rehydrate(row) : undefined;
  }
  async findByUserId(userId: string, _tx?: TransactionContext): Promise<Parent | undefined> {
    for (const row of this.rows.values()) if (row.userId === userId) return Parent.rehydrate(row);
    return undefined;
  }
  lockByUserId(userId: string, tx: TransactionContext): Promise<Parent | undefined> {
    return this.findByUserId(userId, tx);
  }
  lockById(id: string, tx: TransactionContext): Promise<Parent | undefined> {
    return this.findById(id, tx);
  }
  async listBySchool(query: ParentListQuery, _tx?: TransactionContext): Promise<{ items: Parent[]; total: number }> {
    const ids = new Set(this.activeParentIdsOfSchool(query.schoolId));
    const key = query.sort === 'name' ? (r: ParentSnapshot) => r.fullName : (r: ParentSnapshot) => r.createdAt.getTime();
    const sign = query.direction === 'asc' ? 1 : -1;
    const all = [...this.rows.values()]
      .filter((r) => ids.has(r.id))
      .sort((a, b) => {
        const ka = key(a);
        const kb = key(b);
        return ka < kb ? -sign : ka > kb ? sign : a.id < b.id ? -1 : 1;
      });
    const start = (query.page.page - 1) * query.page.pageSize;
    return { items: all.slice(start, start + query.page.pageSize).map((r) => Parent.rehydrate(r)), total: all.length };
  }

  async insertAddress(entry: ParentAddressEntry, _tx: TransactionContext): Promise<void> {
    this.addresses.push(entry);
  }
  async replaceCurrentAddress(entry: ParentAddressEntry, tx: TransactionContext): Promise<void> {
    const i = this.addresses.findIndex((a) => a.parentId === entry.parentId && a.endedAt === null);
    if (i >= 0) this.addresses[i] = { ...this.addresses[i]!, endedAt: entry.createdAt };
    await this.insertAddress(entry, tx);
  }
  async findCurrentAddress(parentId: string, _tx?: TransactionContext): Promise<ParentAddressEntry | undefined> {
    return this.addresses.find((a) => a.parentId === parentId && a.endedAt === null);
  }
  async findCurrentAddresses(parentIds: readonly string[], _tx?: TransactionContext): Promise<Map<string, ParentAddressEntry>> {
    const result = new Map<string, ParentAddressEntry>();
    for (const a of this.addresses) if (a.endedAt === null && parentIds.includes(a.parentId)) result.set(a.parentId, a);
    return result;
  }
  async listAddressHistory(parentId: string, _tx?: TransactionContext): Promise<ParentAddressEntry[]> {
    return this.addresses.filter((a) => a.parentId === parentId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  snapshot(): { rows: Array<[string, ParentSnapshot]>; addresses: ParentAddressEntry[] } {
    return { rows: [...this.rows], addresses: [...this.addresses] };
  }
  restore(saved: { rows: Array<[string, ParentSnapshot]>; addresses: ParentAddressEntry[] }): void {
    this.rows.clear();
    saved.rows.forEach(([k, v]) => this.rows.set(k, v));
    this.addresses.splice(0, this.addresses.length, ...saved.addresses);
  }
}

export class InMemoryParentSchoolLinkRepository implements ParentSchoolLinkRepository {
  readonly rows = new Map<string, ParentSchoolLinkSnapshot>();

  async insert(link: ParentSchoolLink, _tx: TransactionContext): Promise<void> {
    const s = link.snapshot;
    for (const r of this.rows.values()) if (r.parentId === s.parentId && r.schoolId === s.schoolId && r.unlinkedAt === null) throw parentError('PARENT_ALREADY_LINKED_TO_SCHOOL');
    this.rows.set(s.id, { ...s, version: 1 });
  }
  async update(link: ParentSchoolLink, _tx: TransactionContext): Promise<void> {
    const s = link.snapshot;
    const row = this.rows.get(s.id);
    if (!row || row.version !== s.version) throw parentError('PARENT_CONCURRENT_MODIFICATION');
    this.rows.set(s.id, { ...s, version: s.version + 1 });
  }
  async findActive(parentId: string, schoolId: string, _tx?: TransactionContext): Promise<ParentSchoolLink | undefined> {
    for (const r of this.rows.values()) if (r.parentId === parentId && r.schoolId === schoolId && r.unlinkedAt === null) return ParentSchoolLink.rehydrate(r);
    return undefined;
  }
  lockActive(parentId: string, schoolId: string, tx: TransactionContext): Promise<ParentSchoolLink | undefined> {
    return this.findActive(parentId, schoolId, tx);
  }
  async listActiveByParent(parentId: string, _tx?: TransactionContext): Promise<ParentSchoolLink[]> {
    return [...this.rows.values()].filter((r) => r.parentId === parentId && r.unlinkedAt === null).sort(byLinked).map((r) => ParentSchoolLink.rehydrate(r));
  }
  async listActiveByParents(parentIds: readonly string[], _tx?: TransactionContext): Promise<Map<string, ParentSchoolLink[]>> {
    const result = new Map<string, ParentSchoolLink[]>();
    for (const r of [...this.rows.values()].filter((x) => x.unlinkedAt === null && parentIds.includes(x.parentId)).sort(byLinked)) {
      const list = result.get(r.parentId) ?? [];
      list.push(ParentSchoolLink.rehydrate(r));
      result.set(r.parentId, list);
    }
    return result;
  }
  async listHistoryByParent(parentId: string, _tx?: TransactionContext): Promise<ParentSchoolLink[]> {
    return [...this.rows.values()].filter((r) => r.parentId === parentId).sort(byLinked).map((r) => ParentSchoolLink.rehydrate(r));
  }
  activeParentIdsOfSchool(schoolId: string): string[] {
    return [...this.rows.values()].filter((r) => r.schoolId === schoolId && r.unlinkedAt === null).map((r) => r.parentId);
  }

  snapshot(): Array<[string, ParentSchoolLinkSnapshot]> {
    return [...this.rows];
  }
  restore(saved: Array<[string, ParentSchoolLinkSnapshot]>): void {
    this.rows.clear();
    saved.forEach(([k, v]) => this.rows.set(k, v));
  }
}

const byLinked = (a: ParentSchoolLinkSnapshot, b: ParentSchoolLinkSnapshot): number => a.linkedAt.getTime() - b.linkedAt.getTime() || (a.id < b.id ? -1 : 1);
