import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import type { School } from '../../domain/entities/school';
import type { GpsFix } from '../../domain/value-objects/gps';
import type { SchoolStatus } from '../../domain/value-objects/school-status';

/** One row of the append-only status history (creation, approval, rejection, deactivation, reactivation). */
export interface SchoolStatusHistoryEntry {
  readonly id: string;
  readonly schoolId: string;
  readonly fromStatus: SchoolStatus | null;
  readonly toStatus: SchoolStatus;
  readonly changedBy: string;
  /** The rejection reason for a rejection; otherwise null. */
  readonly reason: string | null;
  readonly changedAt: Date;
}

/** One row of the append-only GPS correction history (the creation GPS is on the school itself). */
export interface SchoolGpsHistoryEntry {
  readonly id: string;
  readonly schoolId: string;
  readonly previous: GpsFix;
  readonly current: GpsFix;
  readonly changedBy: string;
  readonly changedAt: Date;
}

export type SchoolSortKey = 'createdAt' | 'code' | 'name' | 'status';

export interface SchoolListQuery {
  /** Schools this user ACTIVELY MANAGES (school manager link)... */
  readonly managerUserId?: string;
  /** ...plus every school of these organizations (the ones the user manages). Deny by default: with neither, NOTHING is returned. */
  readonly organizationIds?: readonly string[];
  readonly statuses?: readonly SchoolStatus[];
  readonly sort: SchoolSortKey;
  readonly direction: 'asc' | 'desc';
  readonly page: PageRequest;
}

export interface SchoolRepository {
  /** Throws SCHOOL_NAME_ALREADY_EXISTS when another non-rejected school of the organization has the same name. */
  insert(school: School, tx: TransactionContext): Promise<void>;
  /** Optimistic: throws SCHOOL_CONCURRENT_MODIFICATION when the stored version changed. */
  update(school: School, tx: TransactionContext): Promise<void>;
  findById(id: string, tx?: TransactionContext): Promise<School | undefined>;
  /** Same as `findById` but locks the row (`FOR UPDATE`) for the rest of the transaction. */
  findByIdForUpdate(id: string, tx: TransactionContext): Promise<School | undefined>;
  findByCode(code: string, tx?: TransactionContext): Promise<School | undefined>;
  list(query: SchoolListQuery, tx?: TransactionContext): Promise<{ items: School[]; total: number }>;
  appendStatusHistory(entry: SchoolStatusHistoryEntry, tx: TransactionContext): Promise<void>;
  appendGpsHistory(entry: SchoolGpsHistoryEntry, tx: TransactionContext): Promise<void>;
  listStatusHistory(schoolId: string, tx?: TransactionContext): Promise<SchoolStatusHistoryEntry[]>;
  listGpsHistory(schoolId: string, tx?: TransactionContext): Promise<SchoolGpsHistoryEntry[]>;
}
