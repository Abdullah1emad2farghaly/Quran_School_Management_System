import { QueryTypes, type Sequelize } from 'sequelize';
import { newUuid, type TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { ClaimDueParams, ExamAudienceRole, ReminderRecord, RuleStateRepository } from '../../../../application/ports/rule-state-repository';
import { REMINDER_KIND_VALUES, REMINDER_STATES, type ReminderKind, type ReminderState } from '../../../../domain/value-objects/reminder-rules';

type Queryable = Pick<Sequelize, 'query'>;
const INSERT_CHUNK = 200;

interface ReminderRow {
  id: string;
  kind: string;
  subjectId: string;
  dueAt: Date | string;
  state: string;
  attempts: number | string;
}

const asDate = (v: Date | string): Date => (v instanceof Date ? v : new Date(v));
const asKind = (v: string): ReminderKind => {
  const found = REMINDER_KIND_VALUES.find((k) => k === v);
  if (!found) throw new Error(`Unknown reminder kind "${v}"`);
  return found;
};
const asState = (v: string): ReminderState => {
  const found = REMINDER_STATES.find((s) => s === v);
  if (!found) throw new Error(`Unknown reminder state "${v}"`);
  return found;
};
const toRecord = (r: ReminderRow): ReminderRecord => ({ id: r.id, kind: asKind(r.kind), subjectId: r.subjectId, dueAt: asDate(r.dueAt), state: asState(r.state), attempts: Number(r.attempts) });

/**
 * MariaDB persistence of Module 32 (`notification_reminders`, `notification_exam_audience`; its own tables only, no foreign keys to other modules).
 * The claim is the same lock pattern as the outbox and the push queue: due rows are locked for this pass, then read back by claim id.
 */
export class SequelizeRuleStateRepository implements RuleStateRepository {
  constructor(private readonly db: Queryable) {}

  private t(tx?: TransactionContext) {
    return sequelizeTransactionOf(tx) ?? null;
  }

  async upsertReminder(kind: ReminderKind, subjectId: string, dueAt: Date, now: Date, tx?: TransactionContext): Promise<void> {
    // MariaDB evaluates the assignments left to right, so `due_at` (which they compare against) is assigned LAST. The same due time again changes nothing; another due time re-arms the row.
    await this.db.query(
      `INSERT INTO notification_reminders (id, kind, subject_id, due_at, state, attempts, created_at, updated_at)
       VALUES (:id, :kind, :subjectId, :dueAt, 'PENDING', 0, :now, :now)
       ON DUPLICATE KEY UPDATE
         state = IF(due_at <> VALUES(due_at), 'PENDING', state),
         attempts = IF(due_at <> VALUES(due_at), 0, attempts),
         locked_until = IF(due_at <> VALUES(due_at), NULL, locked_until),
         claim_id = IF(due_at <> VALUES(due_at), NULL, claim_id),
         last_error = IF(due_at <> VALUES(due_at), NULL, last_error),
         processed_at = IF(due_at <> VALUES(due_at), NULL, processed_at),
         updated_at = IF(due_at <> VALUES(due_at), VALUES(updated_at), updated_at),
         due_at = VALUES(due_at)`,
      { replacements: { id: newUuid(), kind, subjectId, dueAt, now }, transaction: this.t(tx) },
    );
  }

  async suppressPending(subjectId: string, kinds: readonly ReminderKind[], now: Date, tx?: TransactionContext): Promise<number> {
    if (kinds.length === 0) return 0;
    const [, affected] = await this.db.query(
      `UPDATE notification_reminders SET state = 'SUPPRESSED', locked_until = NULL, claim_id = NULL, processed_at = :now, updated_at = :now
        WHERE subject_id = :subjectId AND kind IN (:kinds) AND state = 'PENDING'`,
      { replacements: { subjectId, kinds: [...kinds], now }, type: QueryTypes.UPDATE, transaction: this.t(tx) },
    );
    return Number(affected);
  }

  async findReminder(kind: ReminderKind, subjectId: string, tx?: TransactionContext): Promise<ReminderRecord | undefined> {
    const rows = await this.db.query<ReminderRow>(
      'SELECT id, kind, subject_id AS subjectId, due_at AS dueAt, state, attempts FROM notification_reminders WHERE kind = :kind AND subject_id = :subjectId',
      { replacements: { kind, subjectId }, type: QueryTypes.SELECT, transaction: this.t(tx) },
    );
    const row = rows[0];
    return row ? toRecord(row) : undefined;
  }

  async claimDue(p: ClaimDueParams): Promise<ReminderRecord[]> {
    await this.db.query(
      `UPDATE notification_reminders SET locked_until = :lockUntil, claim_id = :claimId
        WHERE state = 'PENDING' AND due_at <= :now AND (locked_until IS NULL OR locked_until < :now)
        ORDER BY due_at ASC, id ASC LIMIT :limit`,
      { replacements: { claimId: p.claimId, lockUntil: p.lockUntil, now: p.now, limit: p.limit } },
    );
    const rows = await this.db.query<ReminderRow>(
      `SELECT id, kind, subject_id AS subjectId, due_at AS dueAt, state, attempts FROM notification_reminders
        WHERE claim_id = :claimId AND state = 'PENDING' ORDER BY due_at ASC, id ASC`,
      { replacements: { claimId: p.claimId }, type: QueryTypes.SELECT },
    );
    return rows.map(toRecord);
  }

  async complete(id: string, state: 'SENT' | 'SUPPRESSED', now: Date): Promise<void> {
    await this.db.query('UPDATE notification_reminders SET state = :state, locked_until = NULL, claim_id = NULL, processed_at = :now, updated_at = :now WHERE id = :id', { replacements: { id, state, now } });
  }

  async postpone(id: string, dueAt: Date, now: Date): Promise<void> {
    await this.db.query("UPDATE notification_reminders SET due_at = :dueAt, state = 'PENDING', locked_until = NULL, claim_id = NULL, updated_at = :now WHERE id = :id", { replacements: { id, dueAt, now } });
  }

  async recordFailure(id: string, attempts: number, nextDueAt: Date | null, error: string, now: Date): Promise<void> {
    if (nextDueAt === null) {
      await this.db.query("UPDATE notification_reminders SET state = 'FAILED', attempts = :attempts, last_error = :error, locked_until = NULL, claim_id = NULL, processed_at = :now, updated_at = :now WHERE id = :id", { replacements: { id, attempts, error, now } });
      return;
    }
    await this.db.query("UPDATE notification_reminders SET state = 'PENDING', attempts = :attempts, due_at = :nextDueAt, last_error = :error, locked_until = NULL, claim_id = NULL, updated_at = :now WHERE id = :id", { replacements: { id, attempts, nextDueAt, error, now } });
  }

  async replaceExamAudience(examId: string, role: ExamAudienceRole, ids: readonly string[], now: Date, tx?: TransactionContext): Promise<void> {
    // Diff instead of delete-all-then-insert: every statement is idempotent, so a failure half way leaves a consistent subset that the next attempt completes.
    const wanted = new Set(ids);
    const existing = await this.listExamAudience(examId, role, tx);
    for (const id of existing) if (!wanted.has(id)) await this.removeExamAudience(examId, role, id, tx);
    const have = new Set(existing);
    const missing = [...wanted].filter((id) => !have.has(id));
    for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
      const chunk = missing.slice(i, i + INSERT_CHUNK);
      const replacements: Record<string, unknown> = { examId, role, now };
      const values = chunk.map((id, n) => {
        replacements[`s${n}`] = id;
        return `(:examId, :role, :s${n}, :now)`;
      });
      await this.db.query(`INSERT IGNORE INTO notification_exam_audience (exam_id, role, subject_id, created_at) VALUES ${values.join(', ')}`, { replacements, transaction: this.t(tx) });
    }
  }

  async addExamAudience(examId: string, role: ExamAudienceRole, id: string, now: Date, tx?: TransactionContext): Promise<void> {
    await this.db.query('INSERT IGNORE INTO notification_exam_audience (exam_id, role, subject_id, created_at) VALUES (:examId, :role, :id, :now)', { replacements: { examId, role, id, now }, transaction: this.t(tx) });
  }

  async removeExamAudience(examId: string, role: ExamAudienceRole, id: string, tx?: TransactionContext): Promise<void> {
    await this.db.query('DELETE FROM notification_exam_audience WHERE exam_id = :examId AND role = :role AND subject_id = :id', { replacements: { examId, role, id }, transaction: this.t(tx) });
  }

  async listExamAudience(examId: string, role: ExamAudienceRole, tx?: TransactionContext): Promise<string[]> {
    const rows = await this.db.query<{ subjectId: string }>('SELECT subject_id AS subjectId FROM notification_exam_audience WHERE exam_id = :examId AND role = :role ORDER BY created_at, subject_id', {
      replacements: { examId, role },
      type: QueryTypes.SELECT,
      transaction: this.t(tx),
    });
    return rows.map((r) => r.subjectId);
  }

  async clearExamAudience(examId: string, tx?: TransactionContext): Promise<void> {
    await this.db.query('DELETE FROM notification_exam_audience WHERE exam_id = :examId', { replacements: { examId }, transaction: this.t(tx) });
  }
}
