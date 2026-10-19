import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import type { Parent } from '../../domain/entities/parent';

/** One row of the Parent Address history (§28): never deleted; exactly one row is CURRENT per Parent. */
export interface ParentAddressEntry {
  readonly id: string;
  readonly parentId: string;
  readonly governorateId: string;
  /** The Governorate's name AT THE TIME of the change, so an old address keeps reading the same (§28). */
  readonly governorateName: string;
  readonly centerName: string | null;
  readonly villageName: string | null;
  readonly createdBy: string;
  readonly createdAt: Date;
  /** Null for the current address; set when it was replaced. */
  readonly endedAt: Date | null;
}

/** The personal name lives on the account (Module 08), so a Parent list cannot be sorted by it without reading another module's table. */
export type ParentSortKey = 'createdAt';

export interface ParentListQuery {
  readonly schoolId: string;
  readonly sort: ParentSortKey;
  readonly direction: 'asc' | 'desc';
  readonly page: PageRequest;
}

export interface ParentRepository {
  /** Inserts a new Parent. The unique index on `user_id` is the final guard: one Parent record per account. */
  insert(parent: Parent, tx: TransactionContext): Promise<void>;
  /** Optimistic lock on `parent.version`. Throws PARENT_CONCURRENT_MODIFICATION when it is stale. */
  update(parent: Parent, tx: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<Parent | undefined>;
  findByUserId(userId: string, tx?: TransactionContext): Promise<Parent | undefined>;
  /** Locks the row (FOR UPDATE) so two concurrent registrations of the same phone are serialized. */
  lockByUserId(userId: string, tx: TransactionContext): Promise<Parent | undefined>;
  lockById(id: string, tx: TransactionContext): Promise<Parent | undefined>;
  /** Parents with an ACTIVE link to the school. */
  listBySchool(query: ParentListQuery, tx?: TransactionContext): Promise<{ items: Parent[]; total: number }>;

  /** Stores the FIRST address of a new Parent. */
  insertAddress(entry: ParentAddressEntry, tx: TransactionContext): Promise<void>;
  /** Ends the current address (if any) and stores `entry` as the new current one, in the caller's transaction. */
  replaceCurrentAddress(entry: ParentAddressEntry, tx: TransactionContext): Promise<void>;
  findCurrentAddress(parentId: string, tx?: TransactionContext): Promise<ParentAddressEntry | undefined>;
  findCurrentAddresses(parentIds: readonly string[], tx?: TransactionContext): Promise<Map<string, ParentAddressEntry>>;
  listAddressHistory(parentId: string, tx?: TransactionContext): Promise<ParentAddressEntry[]>;
}
