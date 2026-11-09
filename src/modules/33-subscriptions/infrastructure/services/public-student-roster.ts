import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { StudentService } from '../../../19-students/public';
import type { RosterStudent, StudentRoster } from '../../application/ports/student-roster';

const PAGE_SIZE = 100;

/**
 * Adapter from Module 33's narrow `StudentRoster` port to the PUBLIC `StudentService` of Module 19 (no other module's table or model is read).
 * "Regular / active students" is the Student status ACTIVE (approved Module 33 decision).
 */
export class PublicStudentRoster implements StudentRoster {
  constructor(private readonly students: Pick<StudentService, 'findById' | 'listStudentsOfSchool'>) {}

  async find(studentId: string, tx?: TransactionContext): Promise<RosterStudent | undefined> {
    const s = await this.students.findById(studentId, tx);
    return s ? { id: s.id, fullName: s.fullName, schoolId: s.schoolId, organizationId: s.organizationId, status: s.status } : undefined;
  }

  async listActiveStudentIds(schoolId: string, tx?: TransactionContext): Promise<string[]> {
    const ids: string[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.students.listStudentsOfSchool(schoolId, { status: ['ACTIVE'], sort: 'createdAt', direction: 'asc', page: { page, pageSize: PAGE_SIZE } }, tx);
      ids.push(...result.items.map((s) => s.id));
      if (result.items.length < PAGE_SIZE || ids.length >= result.total) return [...new Set(ids)];
    }
  }
}
