import { describe, expect, it } from 'vitest';
import { GroupService, InMemoryGroupRepository } from '../../../src/modules/20-groups/public';

const G1 = 'group-1';
const G2 = 'group-2';
const at = (iso: string) => new Date(iso);

function service() {
  const repo = new InMemoryGroupRepository();
  const add = (groupId: string, studentId: string, assignedAt: string, unassignedAt: string | null) =>
    repo.assignments.push({
      id: `${groupId}-${studentId}-${assignedAt}`, groupId, studentId, schoolId: 'school', organizationId: 'org', assignedAt: at(assignedAt), assignedBy: 'u',
      unassignedAt: unassignedAt ? at(unassignedAt) : null, unassignedBy: null, endReason: unassignedAt ? 'MOVED' : null,
    });
  add(G1, 'b', '2026-09-05T08:00:00Z', '2026-10-10T08:00:00Z'); // moved out in October
  add(G1, 'a', '2026-09-05T08:00:00Z', null); // still there
  add(G1, 'c', '2026-11-12T08:00:00Z', null); // joined in November
  add(G2, 'd', '2026-09-05T08:00:00Z', null); // another group
  return { repo, service: new GroupService({ groups: repo } as never) };
}

describe('Module 20 read contract for the Group report: listAssignmentsOfGroupForReport', () => {
  it('returns the group\'s authoritative assignment periods (ended ones included), oldest first, and never another group\'s', async () => {
    const rows = await service().service.listAssignmentsOfGroupForReport({ groupId: G1 });
    expect(rows.map((r) => r.studentId)).toEqual(['a', 'b', 'c']);
    expect(rows[1]).toEqual({ studentId: 'b', assignedAt: at('2026-09-05T08:00:00Z'), unassignedAt: at('2026-10-10T08:00:00Z') });
    expect((await service().service.listAssignmentsOfGroupForReport({ groupId: G2 })).map((r) => r.studentId)).toEqual(['d']);
    expect(await service().service.listAssignmentsOfGroupForReport({ groupId: 'nobody' })).toEqual([]);
  });

  it('keeps the historical membership: a student who left the group is still returned for the period they were in it', async () => {
    const { service: s } = service();
    const october = await s.listAssignmentsOfGroupForReport({ groupId: G1, from: at('2026-09-30T21:00:00Z'), toExclusive: at('2026-10-31T22:00:00Z') });
    expect(october.map((r) => r.studentId)).toEqual(['a', 'b']);
    const november = await s.listAssignmentsOfGroupForReport({ groupId: G1, from: at('2026-10-31T22:00:00Z'), toExclusive: at('2026-11-30T22:00:00Z') });
    expect(november.map((r) => r.studentId)).toEqual(['a', 'c']);
  });

  it('range edges: a period that ended exactly at `from` or began exactly at `toExclusive` does not overlap', async () => {
    const { service: s } = service();
    expect((await s.listAssignmentsOfGroupForReport({ groupId: G1, from: at('2026-10-10T08:00:00Z') })).map((r) => r.studentId)).toEqual(['a', 'c']);
    expect((await s.listAssignmentsOfGroupForReport({ groupId: G1, toExclusive: at('2026-09-05T08:00:00Z') })).map((r) => r.studentId)).toEqual([]);
    expect((await s.listAssignmentsOfGroupForReport({ groupId: G1, toExclusive: at('2026-11-12T08:00:00Z') })).map((r) => r.studentId)).toEqual(['a', 'b']);
  });

  it('is read-only: the stored assignments are unchanged', async () => {
    const { repo, service: s } = service();
    const before = JSON.stringify(repo.assignments);
    await s.listAssignmentsOfGroupForReport({ groupId: G1 });
    expect(JSON.stringify(repo.assignments)).toBe(before);
  });
});
