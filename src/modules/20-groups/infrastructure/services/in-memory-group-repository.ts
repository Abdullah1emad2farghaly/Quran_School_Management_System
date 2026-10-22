import type { PageRequest, TransactionContext } from '../../../00-shared-kernel/public';
import type { GroupListQuery, GroupRepository } from '../../application/ports/group-repository';
import { Group, type GroupSnapshot } from '../../domain/entities/group';
import { GroupAssignment, type GroupAssignmentSnapshot } from '../../domain/entities/group-assignment';
import type { GroupHistoryEntry } from '../../domain/entities/group-history-entry';
import { groupError } from '../../domain/errors/group-errors';

/** In-memory GroupRepository with the same uniqueness, ordering and optimistic-lock behavior as the SQL one. For tests of this and other modules. */
export class InMemoryGroupRepository implements GroupRepository {
  readonly groups = new Map<string, GroupSnapshot>();
  readonly history: GroupHistoryEntry[] = [];
  readonly assignments: GroupAssignmentSnapshot[] = [];

  private nameTaken(schoolId: string, nameKey: string, exceptId?: string): boolean {
    for (const g of this.groups.values()) if (g.schoolId === schoolId && g.nameKey === nameKey && g.status === 'ACTIVE' && g.id !== exceptId) return true;
    return false;
  }

  async insert(group: Group, _tx: TransactionContext): Promise<void> {
    const s = group.snapshot;
    if (s.status === 'ACTIVE' && this.nameTaken(s.schoolId, s.nameKey)) throw groupError('GROUP_NAME_CONFLICT');
    this.groups.set(s.id, { ...s, version: 1 });
  }
  async update(group: Group, _tx: TransactionContext): Promise<void> {
    const row = this.groups.get(group.id);
    if (!row || row.version !== group.version) throw groupError('GROUP_CONCURRENT_MODIFICATION');
    const s = group.snapshot;
    if (s.status === 'ACTIVE' && this.nameTaken(s.schoolId, s.nameKey, s.id)) throw groupError('GROUP_NAME_CONFLICT');
    // Same columns as the SQL update: the school and the organization never change.
    this.groups.set(s.id, { ...row, name: s.name, nameKey: s.nameKey, teacherId: s.teacherId, learningMode: s.learningMode, progression: s.progression, startingSurah: s.startingSurah, status: s.status, updatedAt: s.updatedAt, version: row.version + 1 });
  }
  async insertHistory(entries: readonly GroupHistoryEntry[], _tx: TransactionContext): Promise<void> {
    this.history.push(...entries.map((e) => ({ ...e })));
  }
  async findById(id: string, _tx?: TransactionContext): Promise<Group | undefined> {
    const row = this.groups.get(id);
    return row ? Group.rehydrate(row) : undefined;
  }
  lockById(id: string, tx: TransactionContext): Promise<Group | undefined> {
    return this.findById(id, tx);
  }
  async findActiveByNameKey(schoolId: string, nameKey: string, _tx?: TransactionContext): Promise<Group | undefined> {
    for (const g of this.groups.values()) if (g.schoolId === schoolId && g.nameKey === nameKey && g.status === 'ACTIVE') return Group.rehydrate(g);
    return undefined;
  }
  async listBySchool(schoolId: string, query: GroupListQuery, _tx?: TransactionContext): Promise<{ items: Group[]; total: number }> {
    const sign = query.direction === 'asc' ? 1 : -1;
    const key = (g: GroupSnapshot): string | number => (query.sort === 'name' ? g.name : g.createdAt.getTime());
    const all = [...this.groups.values()]
      .filter((g) => g.schoolId === schoolId && (!query.status || query.status.length === 0 || query.status.includes(g.status)))
      .sort((a, b) => (key(a) < key(b) ? -sign : key(a) > key(b) ? sign : a.id < b.id ? -1 : 1));
    return this.slice(all, query.page);
  }
  async listActiveByTeacher(teacherId: string, page: PageRequest, direction: 'asc' | 'desc', _tx?: TransactionContext): Promise<{ items: Group[]; total: number }> {
    const all = [...this.groups.values()].filter((g) => g.teacherId === teacherId && g.status === 'ACTIVE').sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1) * (direction === 'asc' ? 1 : -1));
    return this.slice(all, page);
  }
  async countActiveByTeacherInSchool(teacherId: string, schoolId: string, _tx: TransactionContext): Promise<number> {
    return [...this.groups.values()].filter((g) => g.teacherId === teacherId && g.schoolId === schoolId && g.status === 'ACTIVE').length;
  }
  async listHistory(groupId: string, _tx?: TransactionContext): Promise<GroupHistoryEntry[]> {
    return this.history.filter((h) => h.groupId === groupId).map((h) => ({ ...h }));
  }

  async insertAssignment(assignment: GroupAssignment, _tx: TransactionContext): Promise<void> {
    const s = assignment.snapshot;
    if (s.unassignedAt === null && this.assignments.some((a) => a.studentId === s.studentId && a.unassignedAt === null)) throw groupError('GROUP_STUDENT_ALREADY_ASSIGNED');
    this.assignments.push({ ...s });
  }
  async updateAssignment(assignment: GroupAssignment, _tx: TransactionContext): Promise<void> {
    const i = this.assignments.findIndex((a) => a.id === assignment.id && a.unassignedAt === null);
    if (i < 0) throw groupError('GROUP_CONCURRENT_MODIFICATION');
    this.assignments[i] = { ...assignment.snapshot };
  }
  async findCurrentAssignmentOfStudent(studentId: string, _tx?: TransactionContext): Promise<GroupAssignment | undefined> {
    const row = this.assignments.find((a) => a.studentId === studentId && a.unassignedAt === null);
    return row ? GroupAssignment.rehydrate(row) : undefined;
  }
  lockCurrentAssignmentOfStudent(studentId: string, tx: TransactionContext): Promise<GroupAssignment | undefined> {
    return this.findCurrentAssignmentOfStudent(studentId, tx);
  }
  async listCurrentAssignments(groupId: string, _tx?: TransactionContext): Promise<GroupAssignment[]> {
    return this.assignments.filter((a) => a.groupId === groupId && a.unassignedAt === null).map((a) => GroupAssignment.rehydrate(a));
  }
  async listCurrentAssignmentsPage(groupId: string, page: PageRequest, direction: 'asc' | 'desc', _tx?: TransactionContext): Promise<{ items: GroupAssignment[]; total: number }> {
    const all = this.assignments.filter((a) => a.groupId === groupId && a.unassignedAt === null).sort((a, b) => (a.assignedAt.getTime() - b.assignedAt.getTime() || (a.id < b.id ? -1 : 1)) * (direction === 'asc' ? 1 : -1));
    const start = (page.page - 1) * page.pageSize;
    return { items: all.slice(start, start + page.pageSize).map((a) => GroupAssignment.rehydrate(a)), total: all.length };
  }
  async listAssignmentsOfStudent(studentId: string, _tx?: TransactionContext): Promise<GroupAssignment[]> {
    return this.assignments.filter((a) => a.studentId === studentId).map((a) => GroupAssignment.rehydrate(a));
  }
  async isStudentInActiveGroupOfTeacher(studentId: string, teacherId: string, _tx?: TransactionContext): Promise<boolean> {
    const current = this.assignments.find((a) => a.studentId === studentId && a.unassignedAt === null);
    const group = current ? this.groups.get(current.groupId) : undefined;
    return group !== undefined && group.status === 'ACTIVE' && group.teacherId === teacherId;
  }

  private slice(all: GroupSnapshot[], page: PageRequest): { items: Group[]; total: number } {
    const start = (page.page - 1) * page.pageSize;
    return { items: all.slice(start, start + page.pageSize).map((g) => Group.rehydrate(g)), total: all.length };
  }

  snapshot(): { groups: Array<[string, GroupSnapshot]>; history: GroupHistoryEntry[]; assignments: GroupAssignmentSnapshot[] } {
    return { groups: [...this.groups], history: [...this.history], assignments: this.assignments.map((a) => ({ ...a })) };
  }
  restore(saved: { groups: Array<[string, GroupSnapshot]>; history: GroupHistoryEntry[]; assignments: GroupAssignmentSnapshot[] }): void {
    this.groups.clear();
    saved.groups.forEach(([k, v]) => this.groups.set(k, v));
    this.history.splice(0, this.history.length, ...saved.history);
    this.assignments.splice(0, this.assignments.length, ...saved.assignments);
  }
}
