import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import { pageOffset } from '../../../../../00-shared-kernel/public';
import type { AuditRecord } from '../../../../domain/entities/audit-record';
import type { AuditFilter, AuditRepository, AuditVisibility } from '../../../../application/ports/audit-repository';

type D = Date | string;
const asDate = (v: D): Date => (v instanceof Date ? v : new Date(v));

interface AuditRow {
  id: string;
  eventId: string;
  actorUserId: string | null;
  action: string;
  module: string;
  entityType: string;
  entityId: string;
  beforeJson: string | null;
  afterJson: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  organizationId: string | null;
  schoolId: string | null;
  occurredAt: D;
  recordedAt: D;
}

const SELECT = `SELECT id, event_id AS eventId, actor_user_id AS actorUserId, action, module, entity_type AS entityType, entity_id AS entityId,
  before_json AS beforeJson, after_json AS afterJson, ip_address AS ipAddress, user_agent AS userAgent, request_id AS requestId,
  organization_id AS organizationId, school_id AS schoolId, occurred_at AS occurredAt, recorded_at AS recordedAt FROM audit_logs`;

function parseJson(text: string | null): Record<string, unknown> | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const toRecord = (r: AuditRow): AuditRecord => ({
  id: r.id,
  eventId: r.eventId,
  actorUserId: r.actorUserId,
  action: r.action,
  module: r.module,
  entityType: r.entityType,
  entityId: r.entityId,
  before: parseJson(r.beforeJson),
  after: parseJson(r.afterJson),
  ipAddress: r.ipAddress,
  userAgent: r.userAgent,
  requestId: r.requestId,
  organizationId: r.organizationId,
  schoolId: r.schoolId,
  occurredAt: asDate(r.occurredAt),
  recordedAt: asDate(r.recordedAt),
});

/** `null` = the viewer can see nothing, so no query is needed at all. */
function visibilityClause(visibility: AuditVisibility): { sql: string; replacements: Record<string, unknown> } | null {
  if (visibility.all) return { sql: '1 = 1', replacements: {} };
  const parts: string[] = [];
  const replacements: Record<string, unknown> = {};
  if (visibility.organizationIds.length > 0) {
    parts.push('organization_id IN (:visibleOrganizationIds)');
    replacements.visibleOrganizationIds = [...visibility.organizationIds];
  }
  if (visibility.schoolIds.length > 0) {
    parts.push('school_id IN (:visibleSchoolIds)');
    replacements.visibleSchoolIds = [...visibility.schoolIds];
  }
  return parts.length === 0 ? null : { sql: `(${parts.join(' OR ')})`, replacements };
}

function filterClause(filter: AuditFilter): { sql: string; replacements: Record<string, unknown> } {
  const parts: string[] = [];
  const replacements: Record<string, unknown> = {};
  const eq = (column: string, name: string, value: unknown): void => {
    if (value === undefined) return;
    parts.push(`${column} = :${name}`);
    replacements[name] = value;
  };
  eq('module', 'fModule', filter.module);
  eq('entity_type', 'fEntityType', filter.entityType);
  eq('entity_id', 'fEntityId', filter.entityId);
  eq('actor_user_id', 'fActor', filter.actorUserId);
  eq('organization_id', 'fOrganization', filter.organizationId);
  eq('school_id', 'fSchool', filter.schoolId);
  if (filter.action && filter.action.length > 0) {
    parts.push('action IN (:fActions)');
    replacements.fActions = [...filter.action];
  }
  if (filter.from) {
    parts.push('occurred_at >= :fFrom');
    replacements.fFrom = filter.from;
  }
  if (filter.to) {
    parts.push('occurred_at < :fTo');
    replacements.fTo = filter.to;
  }
  return { sql: parts.join(' AND '), replacements };
}

/**
 * MariaDB audit repository (Module 35's own table `audit_logs`). It only ever INSERTs and SELECTs: there is no UPDATE or DELETE statement in this module, and the
 * table itself rejects both (migration triggers). Every read is restricted by the caller's visibility. Timestamps are UTC.
 */
export class SequelizeAuditRepository implements AuditRepository {
  constructor(private readonly db: Pick<Sequelize, 'query'>) {}

  async insert(record: AuditRecord): Promise<boolean> {
    try {
      await this.db.query(
        `INSERT INTO audit_logs (id, event_id, actor_user_id, action, module, entity_type, entity_id, before_json, after_json, ip_address, user_agent, request_id,
           organization_id, school_id, occurred_at, recorded_at)
         VALUES (:id, :eventId, :actorUserId, :action, :module, :entityType, :entityId, :beforeJson, :afterJson, :ipAddress, :userAgent, :requestId,
           :organizationId, :schoolId, :occurredAt, :recordedAt)`,
        {
          replacements: {
            ...record,
            beforeJson: record.before ? JSON.stringify(record.before) : null,
            afterJson: record.after ? JSON.stringify(record.after) : null,
          },
        },
      );
      return true;
    } catch (error) {
      if (error instanceof UniqueConstraintError) return false; // this event was already recorded (at-least-once delivery): nothing is written twice
      throw error;
    }
  }

  async list(visibility: AuditVisibility, filter: AuditFilter, options: { newestFirst: boolean; page: { page: number; pageSize: number } }): Promise<{ items: AuditRecord[]; total: number }> {
    const visible = visibilityClause(visibility);
    if (!visible) return { items: [], total: 0 };
    const f = filterClause(filter);
    const where = f.sql === '' ? visible.sql : `${visible.sql} AND ${f.sql}`;
    const replacements = { ...visible.replacements, ...f.replacements };
    const counted = await this.db.query<{ total: number | string }>(`SELECT COUNT(*) AS total FROM audit_logs WHERE ${where}`, { replacements, type: QueryTypes.SELECT });
    const total = Number(counted[0]?.total ?? 0);
    if (total === 0) return { items: [], total: 0 };
    const dir = options.newestFirst ? 'DESC' : 'ASC';
    const rows = await this.db.query<AuditRow>(`${SELECT} WHERE ${where} ORDER BY occurred_at ${dir}, id ${dir} LIMIT :limit OFFSET :offset`, {
      replacements: { ...replacements, limit: options.page.pageSize, offset: pageOffset(options.page) },
      type: QueryTypes.SELECT,
    });
    return { items: rows.map(toRecord), total };
  }

  async findVisibleById(visibility: AuditVisibility, id: string): Promise<AuditRecord | null> {
    const visible = visibilityClause(visibility);
    if (!visible) return null;
    const rows = await this.db.query<AuditRow>(`${SELECT} WHERE id = :auditId AND ${visible.sql}`, { replacements: { ...visible.replacements, auditId: id }, type: QueryTypes.SELECT });
    return rows[0] ? toRecord(rows[0]) : null;
  }
}
