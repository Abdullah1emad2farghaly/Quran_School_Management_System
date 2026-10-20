import type { TransactionContext } from '../../../00-shared-kernel/public';
import type { TeacherSchoolLink } from '../../domain/entities/teacher-school-link';

export interface TeacherSchoolLinkRepository {
  /** Inserts an ACTIVE link. The unique (teacher, school, active) index is the final guard: TEACHER_ALREADY_LINKED_TO_SCHOOL. */
  insert(link: TeacherSchoolLink, tx: TransactionContext): Promise<void>;
  /** Persists the removal (history is kept). Optimistic lock on the version. */
  update(link: TeacherSchoolLink, tx: TransactionContext): Promise<void>;
  findActive(teacherId: string, schoolId: string, tx?: TransactionContext): Promise<TeacherSchoolLink | undefined>;
  lockActive(teacherId: string, schoolId: string, tx: TransactionContext): Promise<TeacherSchoolLink | undefined>;
  listActiveByTeacher(teacherId: string, tx?: TransactionContext): Promise<TeacherSchoolLink[]>;
  listActiveByTeachers(teacherIds: readonly string[], tx?: TransactionContext): Promise<Map<string, TeacherSchoolLink[]>>;
  /** Every link ever made for the teacher (active and removed), oldest first. */
  listHistoryByTeacher(teacherId: string, tx?: TransactionContext): Promise<TeacherSchoolLink[]>;
}
