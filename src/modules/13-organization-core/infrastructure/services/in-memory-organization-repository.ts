import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { OrganizationAdminRepository } from '../../application/ports/organization-admin-repository';
import type { OrganizationRepository } from '../../application/ports/organization-repository';
import { OrganizationAdminAssignment, type OrganizationAdminAssignmentSnapshot } from '../../domain/entities/organization-admin-assignment';
import { Organization, type OrganizationSnapshot } from '../../domain/entities/organization';
import { organizationError } from '../../domain/errors/organization-errors';

/** In-memory repository: many organizations, unique name (case-insensitive, NFC) and unique code. For tests. */
export class InMemoryOrganizationRepository implements OrganizationRepository {
  readonly rows = new Map<string, OrganizationSnapshot>();

  async insert(organization: Organization, _tx: TransactionContext): Promise<void> {
    const key = (n: string) => n.normalize('NFC').toLowerCase();
    for (const row of this.rows.values()) {
      if (key(row.name) === key(organization.name)) throw organizationError('ORGANIZATION_NAME_ALREADY_EXISTS');
      if (row.code === organization.code) throw organizationError('ORGANIZATION_ALREADY_EXISTS');
    }
    this.rows.set(organization.id, {
      id: organization.id,
      code: organization.code,
      name: organization.name,
      status: organization.status,
      countryId: organization.countryId,
      governorateId: organization.governorateId,
      centerName: organization.centerName,
      villageName: organization.villageName,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    });
  }

  async findMain(_tx?: TransactionContext): Promise<Organization | undefined> {
    const first = [...this.rows.values()][0];
    return first ? Organization.rehydrate(first) : undefined;
  }

  async findMainForUpdate(tx: TransactionContext): Promise<Organization | undefined> {
    return this.findMain(tx);
  }

  async assignCountryIfUnset(organizationId: string, countryId: string, updatedAt: Date, _tx: TransactionContext): Promise<boolean> {
    const row = this.rows.get(organizationId);
    if (!row || row.countryId !== null) return false;
    this.rows.set(organizationId, { ...row, countryId, updatedAt });
    return true;
  }

  async findById(id: string, _tx?: TransactionContext): Promise<Organization | undefined> {
    const row = this.rows.get(id);
    return row ? Organization.rehydrate(row) : undefined;
  }

  /** Monotonic like the locked SQL sequence: never repeats, even for concurrent callers (a rolled-back creation leaves a gap here). */
  private lastCode = 0;

  async nextCodeSequence(_tx?: TransactionContext): Promise<number> {
    const highest = Math.max(0, ...[...this.rows.values()].map((r) => Number(r.code.slice(4))));
    this.lastCode = Math.max(this.lastCode, highest) + 1;
    return this.lastCode;
  }
}

/** In-memory admin links (for tests). Same behavior as the SQL repository: one active link per organization and user. */
export class InMemoryOrganizationAdminRepository implements OrganizationAdminRepository {
  readonly rows = new Map<string, OrganizationAdminAssignmentSnapshot>();

  async insert(assignment: OrganizationAdminAssignment, _tx: TransactionContext): Promise<void> {
    const dup = [...this.rows.values()].some((r) => r.organizationId === assignment.organizationId && r.userId === assignment.userId && r.revokedAt === null);
    if (dup) throw organizationError('ORGANIZATION_ALREADY_EXISTS');
    this.rows.set(assignment.snapshot.id, assignment.snapshot);
  }

  async findActive(userId: string, organizationId: string, _tx?: TransactionContext): Promise<OrganizationAdminAssignment | undefined> {
    const row = [...this.rows.values()].find((r) => r.userId === userId && r.organizationId === organizationId && r.revokedAt === null);
    return row ? OrganizationAdminAssignment.rehydrate(row) : undefined;
  }

  async listActiveOrganizationIdsByUser(userId: string, _tx?: TransactionContext): Promise<string[]> {
    return [...this.rows.values()].filter((r) => r.userId === userId && r.revokedAt === null).map((r) => r.organizationId);
  }
}
