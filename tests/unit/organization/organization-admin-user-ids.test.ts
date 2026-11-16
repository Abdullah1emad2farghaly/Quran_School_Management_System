import { describe, expect, it } from 'vitest';
import type { TransactionContext } from '../../../src/modules/00-shared-kernel/public';
import { InMemoryOrganizationAdminRepository } from '../../../src/modules/13-organization-core/public';
import { OrganizationAdminAssignment } from '../../../src/modules/13-organization-core/domain/entities/organization-admin-assignment';

const tx = {} as TransactionContext;
const ORG = '00000000-0000-4000-8000-0000000000a1';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000a2';
const U1 = '00000000-0000-4000-8000-0000000000c1';
const U2 = '00000000-0000-4000-8000-0000000000c2';
const U3 = '00000000-0000-4000-8000-0000000000c3';
let t = Date.parse('2026-11-01T00:00:00Z');
const clockAt = () => ({ now: () => new Date((t += 1000)) });

describe('Organization admin user ids (read used by the Notification Rules module)', () => {
  it('lists the ACTIVE administrators of ONE organization, oldest link first, and nobody else', async () => {
    const repo = new InMemoryOrganizationAdminRepository();
    await repo.insert(OrganizationAdminAssignment.assign({ organizationId: ORG, userId: U1, assignedBy: null, clock: clockAt() }), tx);
    await repo.insert(OrganizationAdminAssignment.assign({ organizationId: ORG, userId: U2, assignedBy: U1, clock: clockAt() }), tx);
    await repo.insert(OrganizationAdminAssignment.assign({ organizationId: OTHER_ORG, userId: U3, assignedBy: null, clock: clockAt() }), tx);
    expect(await repo.listActiveUserIdsByOrganization(ORG)).toEqual([U1, U2]);
    expect(await repo.listActiveUserIdsByOrganization(OTHER_ORG)).toEqual([U3]);
    expect(await repo.listActiveUserIdsByOrganization('00000000-0000-4000-8000-0000000000ff')).toEqual([]);
  });
});
