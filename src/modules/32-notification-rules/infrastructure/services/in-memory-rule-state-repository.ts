import { newUuid, type TransactionContext } from '../../../00-shared-kernel/public';
import type { ClaimDueParams, ExamAudienceRole, ReminderRecord, RuleStateRepository } from '../../application/ports/rule-state-repository';
import type { ReminderKind, ReminderState } from '../../domain/value-objects/reminder-rules';

interface Row {
  id: string;
  kind: ReminderKind;
  subjectId: string;
  dueAt: Date;
  state: ReminderState;
  attempts: number;
  lockedUntil: Date | null;
  claimId: string | null;
  lastError: string | null;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const snapshot = (r: Row): ReminderRecord => ({ id: r.id, kind: r.kind, subjectId: r.subjectId, dueAt: r.dueAt, state: r.state, attempts: r.attempts });

/**
 * In-memory RuleStateRepository with the same rules as the MariaDB one (one reminder per kind and subject, a moved due time re-arms it, the same due time changes nothing,
 * due-based claims with a lock). For tests. It is not transactional.
 */
export class InMemoryRuleStateRepository implements RuleStateRepository {
  readonly reminders = new Map<string, Row>();
  readonly audience = new Map<string, Set<string>>();

  private rowKey = (kind: ReminderKind, subjectId: string): string => `${kind}|${subjectId}`;
  private audienceKey = (examId: string, role: ExamAudienceRole): string => `${examId}|${role}`;
  private rows = (kind: ReminderKind, subjectId: string): Row | undefined => this.reminders.get(this.rowKey(kind, subjectId));

  async upsertReminder(kind: ReminderKind, subjectId: string, dueAt: Date, now: Date, _tx?: TransactionContext): Promise<void> {
    const existing = this.rows(kind, subjectId);
    if (!existing) {
      this.reminders.set(this.rowKey(kind, subjectId), { id: newUuid(), kind, subjectId, dueAt, state: 'PENDING', attempts: 0, lockedUntil: null, claimId: null, lastError: null, processedAt: null, createdAt: now, updatedAt: now });
      return;
    }
    if (existing.dueAt.getTime() === dueAt.getTime()) return;
    Object.assign(existing, { dueAt, state: 'PENDING', attempts: 0, lockedUntil: null, claimId: null, lastError: null, processedAt: null, updatedAt: now });
  }

  async suppressPending(subjectId: string, kinds: readonly ReminderKind[], now: Date, _tx?: TransactionContext): Promise<number> {
    let n = 0;
    for (const row of this.reminders.values()) {
      if (row.subjectId !== subjectId || !kinds.includes(row.kind) || row.state !== 'PENDING') continue;
      Object.assign(row, { state: 'SUPPRESSED', lockedUntil: null, claimId: null, processedAt: now, updatedAt: now });
      n += 1;
    }
    return n;
  }

  async findReminder(kind: ReminderKind, subjectId: string, _tx?: TransactionContext): Promise<ReminderRecord | undefined> {
    const row = this.rows(kind, subjectId);
    return row ? snapshot(row) : undefined;
  }

  async claimDue(p: ClaimDueParams): Promise<ReminderRecord[]> {
    const due = [...this.reminders.values()]
      .filter((r) => r.state === 'PENDING' && r.dueAt.getTime() <= p.now.getTime() && (r.lockedUntil === null || r.lockedUntil.getTime() < p.now.getTime()))
      .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.id.localeCompare(b.id))
      .slice(0, p.limit);
    for (const r of due) {
      r.lockedUntil = p.lockUntil;
      r.claimId = p.claimId;
    }
    return due.map(snapshot);
  }

  private byId(id: string): Row | undefined {
    return [...this.reminders.values()].find((r) => r.id === id);
  }

  async complete(id: string, state: 'SENT' | 'SUPPRESSED', now: Date): Promise<void> {
    const r = this.byId(id);
    if (r) Object.assign(r, { state, lockedUntil: null, claimId: null, processedAt: now, updatedAt: now });
  }

  async postpone(id: string, dueAt: Date, now: Date): Promise<void> {
    const r = this.byId(id);
    if (r) Object.assign(r, { dueAt, state: 'PENDING', lockedUntil: null, claimId: null, updatedAt: now });
  }

  async recordFailure(id: string, attempts: number, nextDueAt: Date | null, error: string, now: Date): Promise<void> {
    const r = this.byId(id);
    if (!r) return;
    Object.assign(r, { attempts, lastError: error, lockedUntil: null, claimId: null, updatedAt: now });
    if (nextDueAt === null) Object.assign(r, { state: 'FAILED', processedAt: now });
    else Object.assign(r, { dueAt: nextDueAt, state: 'PENDING' });
  }

  private set(examId: string, role: ExamAudienceRole): Set<string> {
    const key = this.audienceKey(examId, role);
    let s = this.audience.get(key);
    if (!s) {
      s = new Set<string>();
      this.audience.set(key, s);
    }
    return s;
  }

  async replaceExamAudience(examId: string, role: ExamAudienceRole, ids: readonly string[], _now: Date, _tx?: TransactionContext): Promise<void> {
    this.audience.set(this.audienceKey(examId, role), new Set(ids));
  }
  async addExamAudience(examId: string, role: ExamAudienceRole, id: string, _now: Date, _tx?: TransactionContext): Promise<void> {
    this.set(examId, role).add(id);
  }
  async removeExamAudience(examId: string, role: ExamAudienceRole, id: string, _tx?: TransactionContext): Promise<void> {
    this.set(examId, role).delete(id);
  }
  async listExamAudience(examId: string, role: ExamAudienceRole, _tx?: TransactionContext): Promise<string[]> {
    return [...this.set(examId, role)];
  }
  async clearExamAudience(examId: string, _tx?: TransactionContext): Promise<void> {
    this.audience.delete(this.audienceKey(examId, 'STUDENT'));
    this.audience.delete(this.audienceKey(examId, 'EXAMINER'));
  }
}
