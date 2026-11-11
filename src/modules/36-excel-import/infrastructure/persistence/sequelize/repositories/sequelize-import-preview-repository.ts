import { QueryTypes, type Sequelize } from 'sequelize';
import type { TransactionContext } from '../../../../../00-shared-kernel/public';
import { sequelizeTransactionOf } from '../../../../../02-database/public';
import type { ImportPreviewRecord, PreviewStatus } from '../../../../domain/entities/import-types';
import type { ImportPreviewRepository } from '../../../../application/ports/import-preview-repository';
import type { ImportLanguage } from '../../../../domain/value-objects/import-columns';

type Queryable = Pick<Sequelize, 'query'>;

interface Row {
  id: string;
  schoolId: string;
  organizationId: string;
  createdBy: string;
  fileId: string | null;
  originalName: string;
  language: ImportLanguage;
  status: PreviewStatus;
  canConfirm: number | boolean;
  blocking: number | string;
  summary: string;
  sourceRows: string | null;
  analysis: string | null;
  result: string | null;
  createdAt: Date | string;
  expiresAt: Date | string;
  decidedAt: Date | string | null;
  decidedBy: string | null;
  version: number | string;
}

const SELECT = `SELECT id, school_id AS schoolId, organization_id AS organizationId, created_by AS createdBy, file_id AS fileId, original_name AS originalName,
  language, status, can_confirm AS canConfirm, blocking, summary, source_rows AS sourceRows, analysis, result, created_at AS createdAt, expires_at AS expiresAt,
  decided_at AS decidedAt, decided_by AS decidedBy, version FROM excel_import_previews`;

// Dates are stored as UTC DATETIME(3); the driver may hand them back as Date or as 'YYYY-MM-DD HH:MM:SS.mmm' text.
const toDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(`${value.replace(' ', 'T')}${/[zZ]|[+-]\d\d:?\d\d$/u.test(value) ? '' : 'Z'}`));
const json = (value: unknown): string | null => (value === null || value === undefined ? null : JSON.stringify(value));

function toRecord(r: Row): ImportPreviewRecord {
  return {
    id: r.id,
    schoolId: r.schoolId,
    organizationId: r.organizationId,
    createdBy: r.createdBy,
    fileId: r.fileId,
    originalName: r.originalName,
    language: r.language,
    status: r.status,
    canConfirm: Boolean(Number(r.canConfirm)),
    blocking: Number(r.blocking),
    summary: JSON.parse(r.summary) as ImportPreviewRecord['summary'],
    sourceRows: r.sourceRows ? (JSON.parse(r.sourceRows) as ImportPreviewRecord['sourceRows']) : null,
    analysis: r.analysis ? (JSON.parse(r.analysis) as ImportPreviewRecord['analysis']) : null,
    result: r.result ? (JSON.parse(r.result) as ImportPreviewRecord['result']) : null,
    createdAt: toDate(r.createdAt),
    expiresAt: toDate(r.expiresAt),
    decidedAt: r.decidedAt ? toDate(r.decidedAt) : null,
    decidedBy: r.decidedBy,
    version: Number(r.version),
  };
}

export class SequelizeImportPreviewRepository implements ImportPreviewRepository {
  constructor(private readonly db: Queryable) {}

  async insert(record: ImportPreviewRecord, tx: TransactionContext): Promise<void> {
    await this.db.query(
      `INSERT INTO excel_import_previews (id, school_id, organization_id, created_by, file_id, original_name, language, status, can_confirm, blocking, summary,
         source_rows, analysis, result, expires_at, decided_at, decided_by, version, created_at, updated_at)
       VALUES (:id, :schoolId, :organizationId, :createdBy, :fileId, :originalName, :language, :status, :canConfirm, :blocking, :summary,
         :sourceRows, :analysis, :result, :expiresAt, :decidedAt, :decidedBy, 1, :createdAt, :createdAt)`,
      {
        replacements: {
          id: record.id, schoolId: record.schoolId, organizationId: record.organizationId, createdBy: record.createdBy, fileId: record.fileId, originalName: record.originalName,
          language: record.language, status: record.status, canConfirm: record.canConfirm ? 1 : 0, blocking: record.blocking, summary: JSON.stringify(record.summary),
          sourceRows: json(record.sourceRows), analysis: json(record.analysis), result: json(record.result), expiresAt: record.expiresAt, decidedAt: record.decidedAt, decidedBy: record.decidedBy, createdAt: record.createdAt,
        },
        transaction: sequelizeTransactionOf(tx) ?? null,
      },
    );
  }

  async findById(id: string, tx?: TransactionContext): Promise<ImportPreviewRecord | undefined> {
    const rows = await this.db.query<Row>(`${SELECT} WHERE id = :id`, { replacements: { id }, type: QueryTypes.SELECT, transaction: tx ? (sequelizeTransactionOf(tx) ?? null) : null });
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async lockById(id: string, tx: TransactionContext): Promise<ImportPreviewRecord | undefined> {
    const rows = await this.db.query<Row>(`${SELECT} WHERE id = :id FOR UPDATE`, { replacements: { id }, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null });
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async update(record: ImportPreviewRecord, tx: TransactionContext): Promise<void> {
    const [, affected] = await this.db.query(
      `UPDATE excel_import_previews SET status = :status, can_confirm = :canConfirm, blocking = :blocking, source_rows = :sourceRows, analysis = :analysis, result = :result,
         file_id = :fileId, decided_at = :decidedAt, decided_by = :decidedBy, updated_at = :updatedAt, version = version + 1
       WHERE id = :id AND version = :previousVersion`,
      {
        replacements: {
          id: record.id, previousVersion: record.version - 1, status: record.status, canConfirm: record.canConfirm ? 1 : 0, blocking: record.blocking, sourceRows: json(record.sourceRows),
          analysis: json(record.analysis), result: json(record.result), fileId: record.fileId, decidedAt: record.decidedAt, decidedBy: record.decidedBy, updatedAt: record.decidedAt ?? new Date(),
        },
        type: QueryTypes.UPDATE,
        transaction: sequelizeTransactionOf(tx) ?? null,
      },
    );
    if (Number(affected) !== 1) throw new Error('IMPORT_PREVIEW_CONCURRENT_MODIFICATION');
  }

  async expireDue(now: Date, limit: number, tx: TransactionContext): Promise<string[]> {
    const due = await this.db.query<{ id: string; fileId: string | null }>(
      `SELECT id, file_id AS fileId FROM excel_import_previews WHERE status = 'PENDING' AND expires_at <= :now ORDER BY expires_at LIMIT ${Math.max(1, Math.floor(limit))} FOR UPDATE`,
      { replacements: { now }, type: QueryTypes.SELECT, transaction: sequelizeTransactionOf(tx) ?? null },
    );
    for (const p of due) {
      await this.db.query(
        `UPDATE excel_import_previews SET status = 'EXPIRED', can_confirm = 0, source_rows = NULL, analysis = NULL, file_id = NULL, decided_at = :now, updated_at = :now, version = version + 1 WHERE id = :id AND status = 'PENDING'`,
        { replacements: { id: p.id, now }, type: QueryTypes.UPDATE, transaction: sequelizeTransactionOf(tx) ?? null },
      );
    }
    return due.map((p) => p.fileId).filter((id): id is string => id !== null);
  }
}
