import type { AuthorizationPolicyRegistry, AuthorizationResolvers } from '../../../12-authorization-engine/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { TeacherLookup } from '../../../18-teachers/public';
import { EXAM_TARGET_TYPE, type ExamStatus } from '../../domain/value-objects/exam-rules';

/** Permissions of exams (registered ONLY through the shared Authorization Engine). Codes are `<module>.<resource>.<action>`. */
export const ExamPermissions = {
  CREATE: 'exam.exam.create',
  LIST: 'exam.exam.list',
  READ: 'exam.exam.read',
  UPDATE: 'exam.exam.update',
  LIFECYCLE: 'exam.exam.lifecycle',
  MANAGE_EXAMINERS: 'exam.examiner.manage',
  READ_RESULTS: 'exam.result.read',
  /** The exam-scoped examiner permission (the approved "TESTER" permission): held by a Teacher ONLY for the exams they are currently assigned to. */
  RECORD_RESULT: 'exam.result.record',
  READ_STUDENT: 'exam.student.read',
  READ_SCHEDULE: 'exam.schedule.read',
  LIST_ASSIGNED: 'exam.assigned.read',
} as const;

export interface ExamScope {
  readonly id: string;
  readonly schoolId: string;
  readonly status: ExamStatus;
  /** The Teacher ids currently assigned as examiners. */
  readonly examinerTeacherIds: readonly string[];
}

/** An examiner can see and work on the exam from SCHEDULED until it ENDED; a DRAFT is the Manager's working copy and a CANCELLED exam is over. */
export const EXAMINER_VISIBLE_STATUSES: readonly ExamStatus[] = ['SCHEDULED', 'STARTED', 'COMPLETED'];

export interface ExamAuthorizationDeps {
  readonly policies: Pick<AuthorizationPolicyRegistry, 'register'>;
  readonly resolvers: Pick<AuthorizationResolvers, 'registerScopeResolver'>;
  readonly exams: { findScopeById(examId: string): Promise<ExamScope | undefined> };
  readonly schools: Pick<SchoolLookup, 'isSchoolManager'>;
  readonly teachers: Pick<TeacherLookup, 'findByUserId'>;
}

/**
 * Module 30 registers what it owns (approved Module 30 decisions; anything not listed stays denied):
 *   - SCHOOL_MANAGER (their own school): create (the school is the target), list, read, update, lifecycle (schedule / cancel / delete / complete / end), manage examiners, read ALL results.
 *   - TEACHER, as an ASSIGNED EXAMINER only: read the exam, see the pending students, and record results (`exam.result.record`, the exam-scoped examiner permission). A Teacher who is not
 *     assigned, or whose assignment was removed or released at ENDED, is denied. The Teacher ROLE is never created, changed or removed by this module: the permission is an exam-scoped
 *     grant resolved from the examiner assignment. NO result read exists for an examiner (not even their own).
 *   - PARENT: the schedule of the exams of their children's schools (UNSCOPED, filtered by the application) and their OWN children's recorded results (Module 19's student scope).
 *   - ORGANIZATION_MANAGER, geographic managers, MAIN_ADMIN, a Teacher who is not an examiner, and a Student (no login): no direct exam permission (the managers use the future Reports module).
 * The MANAGEMENT/EXAM resolver answers `true` only on positive proof and per ROLE. Call once per process.
 */
export function registerExamAuthorization(deps: ExamAuthorizationDeps): void {
  const manager = ['SCHOOL_MANAGER'] as const;
  deps.policies.register({ code: ExamPermissions.CREATE, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: ExamPermissions.LIST, roles: manager, scope: 'MANAGEMENT' });
  for (const code of [ExamPermissions.UPDATE, ExamPermissions.LIFECYCLE, ExamPermissions.MANAGE_EXAMINERS, ExamPermissions.READ_RESULTS]) deps.policies.register({ code, roles: manager, scope: 'MANAGEMENT' });
  deps.policies.register({ code: ExamPermissions.READ, roles: ['SCHOOL_MANAGER', 'TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: ExamPermissions.RECORD_RESULT, roles: ['TEACHER'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: ExamPermissions.READ_STUDENT, roles: ['SCHOOL_MANAGER', 'PARENT'], scope: 'MANAGEMENT' });
  deps.policies.register({ code: ExamPermissions.READ_SCHEDULE, roles: ['PARENT'], scope: 'UNSCOPED' });
  deps.policies.register({ code: ExamPermissions.LIST_ASSIGNED, roles: ['TEACHER'], scope: 'UNSCOPED' });

  deps.resolvers.registerScopeResolver('MANAGEMENT', EXAM_TARGET_TYPE, {
    covers: async ({ userId, role, kind, target }) => {
      if (kind !== 'MANAGEMENT' || target.type !== EXAM_TARGET_TYPE) return false;
      const exam = await deps.exams.findScopeById(target.id);
      if (!exam) return false;
      switch (role) {
        case 'SCHOOL_MANAGER':
          return deps.schools.isSchoolManager(userId, exam.schoolId);
        case 'TEACHER': {
          const teacher = await deps.teachers.findByUserId(userId);
          return teacher !== undefined && EXAMINER_VISIBLE_STATUSES.includes(exam.status) && exam.examinerTeacherIds.includes(teacher.id) && teacher.schoolIds.includes(exam.schoolId);
        }
        default:
          return false;
      }
    },
  });
}
