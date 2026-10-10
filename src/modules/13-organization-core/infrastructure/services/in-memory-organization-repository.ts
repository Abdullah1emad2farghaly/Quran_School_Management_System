import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { OrganizationRepository } from '../../application/ports/organization-repository';
import { Organization, type OrganizationSnapshot } from '../../domain/entities/organization';
import { organizationError } from '../../domain/errors/organization-errors';

/** In-memory repository with the same V1 single-organization and unique-code behavior. For tests. */
export class InMemoryOrganizationRepository implements OrganizationRepository {
  readonly rows = new Map<string, OrganizationSnapshot>();

  async insert(organization: Organization, _tx: TransactionContext): Promise<void> {
    if (this.rows.size > 0) throw organizationError('ORGANIZATION_ALREADY_EXISTS');
    this.rows.set(organization.id, {
      id: organization.id,
      code: organization.code,
      name: organization.name,
      status: organization.status,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    });
  }

  async findMain(_tx?: TransactionContext): Promise<Organization | undefined> {
    const first = [...this.rows.values()][0];
    return first ? Organization.rehydrate(first) : undefined;
  }

  async findById(id: string, _tx?: TransactionContext): Promise<Organization | undefined> {
    const row = this.rows.get(id);
    return row ? Organization.rehydrate(row) : undefined;
  }

  async nextCodeSequence(_tx?: TransactionContext): Promise<number> {
    const numbers = [...this.rows.values()].map((r) => Number(r.code.slice(4)));
    return Math.max(0, ...numbers) + 1;
  }
}
