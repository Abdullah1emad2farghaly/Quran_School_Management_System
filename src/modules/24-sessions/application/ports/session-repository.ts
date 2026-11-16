import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import type { ClassSession } from '../../domain/entities/class-session';
import type { SessionStatus } from '../../domain/value-objects/session-status';

export interface SessionListFilter {
  readonly status?: readonly SessionStatus[];
  readonly direction: 'asc' | 'desc';
}

/** Persistence of class sessions (the table of Module 24 only). Sessions are never deleted. */
export interface ClassSessionRepository {
  /** Inserts the session unless this slot already has one for this date (the unique (slot, date) index). Returns whether it was inserted. */
  insertIfAbsent(session: ClassSession, tx: TransactionContext): Promise<boolean>;
  /** Persists the changing columns (status, transition times, cancellation) of a session loaded with `lockById` or `lockOpenBySlot`. Never changes identity, slot, group, teacher or times. */
  save(session: ClassSession, tx: TransactionContext): Promise<void>;
  /** FOR UPDATE. */
  lockById(id: string, tx: TransactionContext): Promise<ClassSession | undefined>;
  findById(id: string, tx?: TransactionContext): Promise<ClassSession | undefined>;
  /** FOR UPDATE: the OPEN sessions of one slot. */
  lockOpenBySlot(slotId: string, tx: TransactionContext): Promise<ClassSession[]>;
  /** Ids of the sessions with an automatic transition due at `now` (OPEN at/after its start, IN_PROGRESS at/after its end), oldest first. Plain read. */
  listDueIds(now: Date, limit: number, tx?: TransactionContext): Promise<string[]>;
  /** The distinct slot ids of the OPEN sessions (to find the ones whose slot has been retired). Plain read. */
  listOpenSlotIds(tx?: TransactionContext): Promise<string[]>;
  listByGroup(groupId: string, filter: SessionListFilter, page: PageRequest, tx?: TransactionContext): Promise<{ items: ClassSession[]; total: number }>;
  listByTeacher(teacherId: string, filter: SessionListFilter, page: PageRequest, tx?: TransactionContext): Promise<{ items: ClassSession[]; total: number }>;
}
