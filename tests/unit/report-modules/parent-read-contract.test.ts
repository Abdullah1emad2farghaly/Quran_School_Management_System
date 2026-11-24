import { describe, expect, it } from 'vitest';
import { InMemoryStudentRepository, StudentService, type StudentSnapshot } from '../../../src/modules/19-students/public';

const P1 = 'parent-1';
const P2 = 'parent-2';
const S1 = 'school-1';
const S2 = 'school-2';

function service(rows: Array<Partial<StudentSnapshot> & { id: string }>) {
  const repo = new InMemoryStudentRepository();
  const at = new Date('2026-09-01T00:00:00Z');
  for (const r of rows) {
    const snapshot: StudentSnapshot = {
      schoolId: S1, organizationId: 'org', parentId: P1, fullName: 'اسم ثلاثي كامل', nationalId: `3000101${r.id.padStart(7, '0')}`, joinDate: '2026-09-01', status: 'ACTIVE', createdBy: 'u', createdAt: at, updatedAt: at, version: 1, ...r,
    } as StudentSnapshot;
    repo.rows.set(snapshot.id, snapshot);
  }
  return { repo, service: new StudentService({ students: repo } as never) };
}

describe('Module 19 read contract for the Parent report: listChildrenOfParentForReport', () => {
  const rows = [
    { id: '1', fullName: 'زياد محمد علي', status: 'ARCHIVED' as const },
    { id: '2', fullName: 'أحمد محمد علي', status: 'ACTIVE' as const },
    { id: '3', fullName: 'بلال محمد علي', status: 'INACTIVE' as const, schoolId: S2 },
    { id: '4', fullName: 'سعيد خالد علي', parentId: P2 },
  ];

  it('returns ALL of the Parent\'s children whatever their lifecycle status, ordered by name, and never the status', async () => {
    const children = await service(rows).service.listChildrenOfParentForReport({ parentId: P1 });
    expect(children.map((c) => c.id)).toEqual(['2', '3', '1']);
    expect(children[0]).toEqual({ id: '2', schoolId: S1, fullName: 'أحمد محمد علي', joinDate: '2026-09-01' });
    expect(children.every((c) => !('status' in c))).toBe(true);
  });

  it('never returns another Parent\'s children', async () => {
    expect((await service(rows).service.listChildrenOfParentForReport({ parentId: P2 })).map((c) => c.id)).toEqual(['4']);
    expect(await service(rows).service.listChildrenOfParentForReport({ parentId: 'nobody' })).toEqual([]);
  });

  it('can be limited to the given schools only; an empty list of schools matches nothing', async () => {
    const s = service(rows).service;
    expect((await s.listChildrenOfParentForReport({ parentId: P1, schoolIds: [S1] })).map((c) => c.id)).toEqual(['2', '1']);
    expect((await s.listChildrenOfParentForReport({ parentId: P1, schoolIds: [S2] })).map((c) => c.id)).toEqual(['3']);
    expect((await s.listChildrenOfParentForReport({ parentId: P1, schoolIds: [S1, S2] })).map((c) => c.id)).toEqual(['2', '3', '1']);
    expect(await s.listChildrenOfParentForReport({ parentId: P1, schoolIds: [] })).toEqual([]);
    expect(await s.listChildrenOfParentForReport({ parentId: P1, schoolIds: ['school-other'] })).toEqual([]);
  });

  it('returns every child even when the Parent has more than one page of them', async () => {
    const many = Array.from({ length: 230 }, (_, i) => ({ id: String(i + 10), fullName: `طالب ${String(i + 1000)} علي` }));
    expect(await service(many).service.listChildrenOfParentForReport({ parentId: P1 })).toHaveLength(230);
    expect(await service(many).service.listChildrenOfParentForReport({ parentId: P1, schoolIds: [S1] })).toHaveLength(230);
  });

  it('is read-only: the stored students are unchanged', async () => {
    const { repo, service: s } = service(rows);
    const before = JSON.stringify([...repo.rows]);
    await s.listChildrenOfParentForReport({ parentId: P1 });
    expect(JSON.stringify([...repo.rows])).toBe(before);
  });
});
