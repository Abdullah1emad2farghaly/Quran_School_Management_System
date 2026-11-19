import { buildPageResult, type PageResult } from '../../../00-shared-kernel/public';
import type { ListQuery } from '../../../04-validation-api/public';
import { auditError } from '../../domain/errors/audit-errors';
import { toAuditRecordDto, type AuditRecordDto, type AuditViewer } from '../dto/audit-dto';
import type { AuditFilter, AuditRepository, AuditVisibility } from '../ports/audit-repository';
import type { AuditScopeDirectory } from '../ports/audit-scope-directory';

export interface AuditQueryServiceDeps {
  readonly repository: AuditRepository;
  readonly scopes: Pick<AuditScopeDirectory, 'organizationIdsOf' | 'schoolIdsOf'>;
}

const NOTHING: AuditVisibility = { all: false, organizationIds: [], schoolIds: [] };

/**
 * Reads of the audit trail (approved Module 35 decision): the Main Admin reads everything; an Organization Manager reads the records of the organizations they
 * administer; a School Manager reads the records of the schools they manage. Any other role, and any record without a scope (identity, roles...), is Main Admin only.
 * The route guard (Authorization Engine) decides who may call at all; THIS decides what a permitted caller can see, from the server's own links and the session's
 * active role, never from anything the client sends. Every query is restricted by the visibility, so a filter can narrow results but never widen them.
 */
export class AuditQueryService {
  constructor(private readonly deps: AuditQueryServiceDeps) {}

  async list(viewer: AuditViewer, query: ListQuery, filter: AuditFilter): Promise<PageResult<AuditRecordDto>> {
    const visibility = await this.visibilityOf(viewer);
    const { items, total } = await this.deps.repository.list(visibility, filter, {
      newestFirst: (query.sort[0]?.direction ?? 'desc') === 'desc',
      page: query.page,
    });
    return buildPageResult(items.map(toAuditRecordDto), total, query.page);
  }

  /** A record that does not exist and one outside the caller's scope answer the same 404. */
  async get(viewer: AuditViewer, id: string): Promise<AuditRecordDto> {
    const record = await this.deps.repository.findVisibleById(await this.visibilityOf(viewer), id);
    if (!record) throw auditError('AUDIT_RECORD_NOT_FOUND');
    return toAuditRecordDto(record);
  }

  private async visibilityOf(viewer: AuditViewer): Promise<AuditVisibility> {
    switch (viewer.activeRole) {
      case 'MAIN_ADMIN':
        return { all: true };
      case 'ORGANIZATION_MANAGER':
        return { all: false, organizationIds: await this.deps.scopes.organizationIdsOf(viewer.userId), schoolIds: [] };
      case 'SCHOOL_MANAGER':
        return { all: false, organizationIds: [], schoolIds: await this.deps.scopes.schoolIdsOf(viewer.userId) };
      default:
        return NOTHING;
    }
  }
}
