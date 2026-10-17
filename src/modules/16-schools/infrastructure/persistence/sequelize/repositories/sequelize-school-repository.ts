import { QueryTypes, UniqueConstraintError, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { SchoolGpsHistoryEntry, SchoolListQuery, SchoolRepository, SchoolStatusHistoryEntry } from '../../../../application/ports/school-repository';
import { School } from '../../../../domain/entities/school';
import { schoolError } from '../../../../domain/errors/school-errors';
import type { SchoolStatus } from '../../../../domain/value-objects/school-status';

type Queryable = Pick<Sequelize, 'query'>;

interface Row {
  id: string;
  code: string;
  name: string;
  status: SchoolStatus;
  organizationId: string;
  countryId: string;
  governorateId: string;
  centerName: string | null;
  villageName: string | null;
  latitude: number | string;
  longitude: number | string;
  gpsAccuracyM: number | string;
  createdBy: string;
  applicantUserId: string | null;
  applicantName: string | null;
  decidedBy: string | null;
  decidedAt: Date | string | null;
  rejectionReason: string | null;
  version: number | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

const SELECT = `
  SELECT id, code, name, status, organization_id AS organizationId, country_id AS countryId,
         governorate_id AS governorateId, center_name AS centerName, village_name AS villageName,
         latitude, longitude, gps_accuracy_m AS gpsAccuracyM, created_by AS createdBy, applicant_user_id AS applicantUserId, applicant_name AS applicantName,
         decided_by AS decidedBy, decided_at AS decidedAt, rejection_reason AS rejectionReason,
         version, created_at AS createdAt, updated_at AS updatedAt
    FROM schools`;

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

export class SequelizeSchoolRepository implements SchoolRepository {
  constructor(private readonly db: Queryable) {}

  async insert(school: School, tx: TransactionContext): Promise<void> {
    const s = school.snapshot;
    try {
      await this.db.query(
        `INSERT INTO schools
           (id, code, name, status, organization_id, country_id, governorate_id, center_name, village_name,
            latitude, longitude, gps_accuracy_m, created_by, applicant_user_id, applicant_name, decided_by, decided_at, rejection_reason, holds_name,
            version, created_at, updated_at)
         VALUES
           (:id, :code, :name, :status, :organizationId, :countryId, :governorateId, :centerName, :villageName,
            :latitude, :longitude, :accuracy, :createdBy, :applicantUserId, :applicantName, NULL, NULL, NULL, 1, 1, :createdAt, :createdAt)`,
        {
          replacements: {
            id: s.id,
            code: s.code,
            name: s.name,
            status: s.status,
            organizationId: s.organizationId,
            countryId: s.countryId,
            governorateId: s.governorateId,
            centerName: s.centerName,
            villageName: s.villageName,
            latitude: s.gps.latitude,
            longitude: s.gps.longitude,
            accuracy: s.gps.accuracyMeters,
            createdBy: s.createdBy,
            applicantUserId: s.applicantUserId,
            applicantName: s.applicantName,
            createdAt: s.createdAt,
          },
          transaction: sequelizeTransactionOf(tx) ?? null,
        },
      );
    } catch (error) {
      // uq_schools_org_name is the final guard for per-organization name uniqueness (the code comes from a locked sequence).
      const detail = error instanceof UniqueConstraintError ? String((error.parent as { sqlMessage?: string } | undefined)?.sqlMessage ?? error.message) : '';
      if (error instanceof UniqueConstraintError && /uq_schools_org_name/.test(detail)) {
        throw schoolError('SCHOOL_NAME_ALREADY_EXISTS');
      }
      throw error;
    }
  }

  async update(school: School, tx: TransactionContext): Promise<void> {
    const s = school.snapshot;
    const [, affected] = await this.db.query(
      `UPDATE schools
          SET status = :status, holds_name = :holdsName, latitude = :latitude, longitude = :longitude,
              gps_accuracy_m = :accuracy, decided_by = :decidedBy, decided_at = :decidedAt,
              rejection_reason = :rejectionReason, updated_at = :updatedAt, version = version + 1
        WHERE id = :id AND version = :version`,
      {
        replacements: {
          id: s.id,
          version: s.version,
          status: s.status,
          holdsName: school.holdsName ? 1 : null,
          latitude: s.gps.latitude,
          longitude: s.gps.longitude,
          accuracy: s.gps.accuracyMeters,
          decidedBy: s.decidedBy,
          decidedAt: s.decidedAt,
          rejectionReason: s.rejectionReason,
          updatedAt: s.updatedAt,
        },
        type: QueryTypes.UPDATE,
        transaction: sequelizeTransactionOf(tx) ?? null,
      },
    );
    if (Number(affected) !== 1) throw schoolError('SCHOOL_CONCURRENT_MODIFICATION');
  }

  findById(id: string, tx?: TransactionContext): Promise<School | undefined> {
    return this.findOne(`${SELECT} WHERE id = :value`, id, tx);
  }

  findByIdForUpdate(id: string, tx: TransactionContext): Promise<School | undefined> {
    return this.findOne(`${SELECT} WHERE id = :value FOR UPDATE`, id, tx);
  }

  findByCode(code: string, tx?: TransactionContext): Promise<School | undefined> {
    return this.findOne(`${SELECT} WHERE code = :value`, code, tx);
  }

  async list(query: SchoolListQuery, tx?: TransactionContext): Promise<{ items: School[]; total: number }> {
    const where: string[] = [];
    const replacements: Record<string, unknown> = {};
    // Deny by default: with no organization and no managed user there is nothing to show (never "everything").
    const visible: string[] = [];
    if (query.managerUserId !== undefined) {
      visible.push('id IN (SELECT school_id FROM school_managers WHERE user_id = :managerUserId AND active = 1)');
      replacements.managerUserId = query.managerUserId;
    }
    if (query.organizationIds && query.organizationIds.length > 0) {
      visible.push('organization_id IN (:organizationIds)');
      replacements.organizationIds = [...query.organizationIds];
    }
    if (visible.length === 0) return { items: [], total: 0 };
    where.push(`(${visible.join(' OR ')})`);
    if (query.statuses && query.statuses.length > 0) {
      where.push('status IN (:statuses)');
      replacements.statuses = [...query.statuses];
    }
    const clause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    // The sort column comes from this whitelist, never from the client.
    const column = { createdAt: 'created_at', code: 'code', name: 'name', status: 'status' }[query.sort];
    const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
    const transaction = sequelizeTransactionOf(tx) ?? null;
    const counted = await this.db.query<{ total: number | string }>(`SELECT COUNT(*) AS total FROM schools${clause}`, {
      replacements,
      type: QueryTypes.SELECT,
      transaction,
    });
    const total = Number(counted[0]?.total ?? 0);
    const rows = await this.db.query<Row>(`${SELECT}${clause} ORDER BY ${column} ${direction}, id ASC LIMIT :limit OFFSET :offset`, {
      replacements: { ...replacements, limit: query.page.pageSize, offset: (query.page.page - 1) * query.page.pageSize },
      type: QueryTypes.SELECT,
      transaction,
    });
    return { items: rows.map((r) => this.toSchool(r)), total };
  }

  async appendStatusHistory(e: SchoolStatusHistoryEntry, tx: TransactionContext): Promise<void> {
    await this.db.query(
      `INSERT INTO school_status_history (id, school_id, from_status, to_status, changed_by, reason, changed_at, created_at)
       VALUES (:id, :schoolId, :fromStatus, :toStatus, :changedBy, :reason, :changedAt, :changedAt)`,
      { replacements: { ...e }, transaction: sequelizeTransactionOf(tx) ?? null },
    );
  }

  async appendGpsHistory(e: SchoolGpsHistoryEntry, tx: TransactionContext): Promise<void> {
    await this.db.query(
      `INSERT INTO school_gps_history
         (id, school_id, previous_latitude, previous_longitude, previous_accuracy_m,
          new_latitude, new_longitude, new_accuracy_m, changed_by, changed_at, created_at)
       VALUES (:id, :schoolId, :pLat, :pLon, :pAcc, :nLat, :nLon, :nAcc, :changedBy, :changedAt, :changedAt)`,
      {
        replacements: {
          id: e.id,
          schoolId: e.schoolId,
          pLat: e.previous.latitude,
          pLon: e.previous.longitude,
          pAcc: e.previous.accuracyMeters,
          nLat: e.current.latitude,
          nLon: e.current.longitude,
          nAcc: e.current.accuracyMeters,
          changedBy: e.changedBy,
          changedAt: e.changedAt,
        },
        transaction: sequelizeTransactionOf(tx) ?? null,
      },
    );
  }

  async listStatusHistory(schoolId: string, tx?: TransactionContext): Promise<SchoolStatusHistoryEntry[]> {
    const rows = await this.db.query<{
      id: string;
      schoolId: string;
      fromStatus: SchoolStatus | null;
      toStatus: SchoolStatus;
      changedBy: string;
      reason: string | null;
      changedAt: Date | string;
    }>(
      `SELECT id, school_id AS schoolId, from_status AS fromStatus, to_status AS toStatus, changed_by AS changedBy,
              reason, changed_at AS changedAt
         FROM school_status_history WHERE school_id = :schoolId ORDER BY changed_at, (from_status IS NOT NULL), created_at, id`,
      { replacements: { schoolId }, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null },
    );
    return rows.map((r) => ({ ...r, changedAt: asDate(r.changedAt) }));
  }

  async listGpsHistory(schoolId: string, tx?: TransactionContext): Promise<SchoolGpsHistoryEntry[]> {
    const rows = await this.db.query<{
      id: string;
      schoolId: string;
      pLat: number | string;
      pLon: number | string;
      pAcc: number | string;
      nLat: number | string;
      nLon: number | string;
      nAcc: number | string;
      changedBy: string;
      changedAt: Date | string;
    }>(
      `SELECT id, school_id AS schoolId, previous_latitude AS pLat, previous_longitude AS pLon, previous_accuracy_m AS pAcc,
              new_latitude AS nLat, new_longitude AS nLon, new_accuracy_m AS nAcc, changed_by AS changedBy, changed_at AS changedAt
         FROM school_gps_history WHERE school_id = :schoolId ORDER BY changed_at, created_at, id`,
      { replacements: { schoolId }, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null },
    );
    return rows.map((r) => ({
      id: r.id,
      schoolId: r.schoolId,
      previous: { latitude: Number(r.pLat), longitude: Number(r.pLon), accuracyMeters: Number(r.pAcc) },
      current: { latitude: Number(r.nLat), longitude: Number(r.nLon), accuracyMeters: Number(r.nAcc) },
      changedBy: r.changedBy,
      changedAt: asDate(r.changedAt),
    }));
  }

  private async findOne(sql: string, value: string, tx?: TransactionContext): Promise<School | undefined> {
    const rows = await this.db.query<Row>(sql, { replacements: { value }, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null });
    const r = rows[0];
    return r ? this.toSchool(r) : undefined;
  }

  private toSchool(r: Row): School {
    return School.rehydrate({
      id: r.id,
      code: r.code,
      name: r.name,
      status: r.status,
      organizationId: r.organizationId,
      countryId: r.countryId,
      governorateId: r.governorateId,
      centerName: r.centerName,
      villageName: r.villageName,
      gps: { latitude: Number(r.latitude), longitude: Number(r.longitude), accuracyMeters: Number(r.gpsAccuracyM) },
      createdBy: r.createdBy,
      applicantUserId: r.applicantUserId,
      applicantName: r.applicantName,
      decidedBy: r.decidedBy,
      decidedAt: r.decidedAt === null ? null : asDate(r.decidedAt),
      rejectionReason: r.rejectionReason,
      version: Number(r.version),
      createdAt: asDate(r.createdAt),
      updatedAt: asDate(r.updatedAt),
    });
  }
}
