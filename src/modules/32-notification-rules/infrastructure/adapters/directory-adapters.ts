import type { OrganizationLookup } from '../../../13-organization-core/public';
import type { ParentLookup } from '../../../17-parents/public';
import type { SchoolLookup } from '../../../16-schools/public';
import type { TeacherLookup } from '../../../18-teachers/public';
import type { StudentLookup } from '../../../19-students/public';
import type { QuranStructureLookup } from '../../../21-quran-structure/public';
import type { GroupService } from '../../../20-groups/public';
import type { MemorizationService } from '../../../27-memorization/public';
import type { RevisionService } from '../../../28-revision/public';
import type { EvaluationService } from '../../../29-evaluations/public';
import type { ExamService } from '../../../30-exams/public';
import type {
  AssignmentDirectory,
  AssignmentKind,
  AssignmentTexts,
  AyahLocation,
  ExamDirectory,
  ExamInfo,
  GroupDirectory,
  GroupInfo,
  QuranDirectory,
  RangeSnapshot,
  SchoolDirectory,
  SchoolInfo,
  SessionActivityView,
  SessionEvaluationView,
  SessionReads,
  StudentDirectory,
  StudentInfo,
  TeacherDirectory,
} from '../../application/ports/directories';
import { spanOf } from '../../application/services/assignment-description';

/**
 * Adapters from the narrow ports of Module 32 to the PUBLIC contracts of the other modules (read-only lookups and services; no repository, model or table of another module).
 * Every `find` answers `undefined` for something that does not exist, so a rule simply finds nothing to do instead of failing.
 */
const PAGE_SIZE = 100;

/** Runs a read that throws a "not found" domain error and turns that into undefined; any other error (a technical one) still propagates and the event is retried. */
async function orUndefined<T>(read: () => Promise<T>, notFoundCodes: readonly string[]): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && notFoundCodes.includes(code)) return undefined;
    throw error;
  }
}

export class PublicStudentDirectory implements StudentDirectory {
  constructor(private readonly deps: { readonly students: Pick<StudentLookup, 'findById'>; readonly parents: Pick<ParentLookup, 'findById'> }) {}

  async find(studentId: string): Promise<StudentInfo | undefined> {
    const student = await this.deps.students.findById(studentId);
    if (!student) return undefined;
    // A Student is linked to ONE Parent record today; the list shape keeps this correct if several Parents are ever linked (decision 10: every linked Parent account).
    const parent = await this.deps.parents.findById(student.parentId);
    return { id: student.id, fullName: student.fullName, schoolId: student.schoolId, parentUserIds: parent ? [parent.userId] : [] };
  }
}

export class PublicTeacherDirectory implements TeacherDirectory {
  constructor(private readonly teachers: Pick<TeacherLookup, 'findById'>) {}

  async userIdOf(teacherId: string): Promise<string | undefined> {
    return (await this.teachers.findById(teacherId))?.userId;
  }
}

export class PublicGroupDirectory implements GroupDirectory {
  constructor(private readonly groups: Pick<GroupService, 'findScopeById' | 'getGroup' | 'listStudentsOfGroup'>) {}

  async find(groupId: string): Promise<GroupInfo | undefined> {
    const scope = await this.groups.findScopeById(groupId);
    if (!scope) return undefined;
    const group = await orUndefined(() => this.groups.getGroup(groupId), ['GROUP_NOT_FOUND']);
    if (!group) return undefined;
    return { id: scope.id, name: group.name, schoolId: scope.schoolId, teacherId: scope.teacherId };
  }

  async listStudentIds(groupId: string): Promise<string[]> {
    const ids: string[] = [];
    for (let page = 1; ; page += 1) {
      const batch = await this.groups.listStudentsOfGroup(groupId, { page, pageSize: PAGE_SIZE }, 'asc');
      ids.push(...batch.items.map((s) => s.studentId));
      if (batch.items.length === 0 || ids.length >= batch.total) break;
    }
    return ids;
  }
}

export class PublicSchoolDirectory implements SchoolDirectory {
  constructor(private readonly deps: { readonly schools: Pick<SchoolLookup, 'findById'>; readonly organizations: Pick<OrganizationLookup, 'listOrganizationAdminUserIds'> }) {}

  async find(schoolId: string): Promise<SchoolInfo | undefined> {
    const s = await this.deps.schools.findById(schoolId);
    if (!s) return undefined;
    return { id: s.id, name: s.name, organizationId: s.organizationId, applicantUserId: s.applicantUserId, applicantName: s.applicantName, rejectionReason: s.rejectionReason };
  }

  organizationManagerUserIds(organizationId: string): Promise<string[]> {
    return this.deps.organizations.listOrganizationAdminUserIds(organizationId);
  }
}

export class PublicExamDirectory implements ExamDirectory {
  constructor(private readonly exams: Pick<ExamService, 'getExamReminderStatus' | 'listPendingGroups' | 'listPendingStudents'>) {}

  async find(examId: string): Promise<ExamInfo | undefined> {
    const s = await orUndefined(() => this.exams.getExamReminderStatus(examId), ['EXAM_NOT_FOUND']);
    return s ? { examId: s.examId, schoolId: s.schoolId, status: s.status, startAt: s.startAt, examinerTeacherIds: s.examinerTeacherIds } : undefined;
  }

  async listLiveTargetStudentIds(examId: string): Promise<string[] | undefined> {
    const info = await this.find(examId);
    if (!info || (info.status !== 'DRAFT' && info.status !== 'SCHEDULED')) return undefined;
    const ids: string[] = [];
    for (const group of await this.exams.listPendingGroups(examId)) {
      for (let page = 1; ; page += 1) {
        const batch = await this.exams.listPendingStudents(examId, group.groupId, { page, pageSize: PAGE_SIZE });
        ids.push(...batch.items.map((s) => s.studentId));
        if (batch.items.length === 0 || (page - 1) * PAGE_SIZE + batch.items.length >= batch.total) break;
      }
    }
    return [...new Set(ids)];
  }
}

/** The stored range of an assignment (Modules 27 / 28 snapshot) in the shape the rules need. */
interface StoredRange {
  readonly request: { readonly unit: string; readonly amount: number };
  readonly first: { readonly surah: number; readonly ayah: number };
  readonly last: { readonly surah: number; readonly ayah: number };
  readonly ayahCount: number;
}
const snapshotOf = (r: StoredRange): RangeSnapshot => ({ unit: r.request.unit, amount: r.request.amount, first: r.first, last: r.last, ayahCount: r.ayahCount });

/** One assignment by id, read through the PUBLIC `findAssignmentById` of Module 27 (memorization) or 28 (revision). */
export class PublicAssignmentDirectory implements AssignmentDirectory {
  constructor(private readonly deps: { readonly memorization: Pick<MemorizationService, 'findAssignmentById'>; readonly revision: Pick<RevisionService, 'findAssignmentById'> }) {}

  async find(kind: AssignmentKind, assignmentId: string): Promise<RangeSnapshot | undefined> {
    const assignment = kind === 'memorization' ? await this.deps.memorization.findAssignmentById(assignmentId) : await this.deps.revision.findAssignmentById(assignmentId);
    return assignment ? snapshotOf(assignment.range) : undefined;
  }
}

/** Module 21's public, read-only lookup: Arabic surah names (read once) and the page / quarter of an ayah. */
export class PublicQuranDirectory implements QuranDirectory {
  private names: Map<number, string> | undefined;
  constructor(private readonly quran: Pick<QuranStructureLookup, 'listSurahs' | 'getAyah'>) {}

  async surahName(surah: number): Promise<string> {
    if (!this.names) this.names = new Map((await this.quran.listSurahs()).map((s) => [s.number, s.nameAr]));
    return this.names.get(surah) ?? String(surah);
  }

  async ayahLocation(surah: number, ayah: number): Promise<AyahLocation | undefined> {
    const a = await this.quran.getAyah(surah, ayah);
    return a ? { firstPage: a.firstPage, lastPage: a.lastPage, quarter: a.quarter } : undefined;
  }
}

interface ScheduledAssignmentView {
  readonly studentId: string | null;
  readonly status: string;
  readonly range: StoredRange;
}

const textOf = async (assignments: readonly ScheduledAssignmentView[], studentId: string, quran: QuranDirectory): Promise<string | undefined> => {
  const mine = assignments.find((a) => a.status === 'ACTIVE' && a.studentId === studentId) ?? assignments.find((a) => a.status === 'ACTIVE' && a.studentId === null);
  return mine ? spanOf(snapshotOf(mine.range), quran) : undefined;
};

export class PublicSessionReads implements SessionReads {
  constructor(
    private readonly deps: {
      readonly evaluations: Pick<EvaluationService, 'getSessionEvaluationStatus'>;
      readonly memorization: Pick<MemorizationService, 'getScheduledMemorization'>;
      readonly revision: Pick<RevisionService, 'getScheduledRevision'>;
      readonly quran: QuranDirectory;
    },
  ) {}

  async evaluationStatus(sessionId: string): Promise<SessionEvaluationView | undefined> {
    const s = await orUndefined(() => this.deps.evaluations.getSessionEvaluationStatus(sessionId), ['CLASS_SESSION_NOT_FOUND', 'SESSION_NOT_FOUND']);
    return s ? { status: s.status, teacherId: s.teacherId, groupId: s.groupId, scheduledStart: s.scheduledStart, scheduledEnd: s.scheduledEnd, incompleteStudentIds: s.incompleteStudentIds } : undefined;
  }

  async activities(sessionId: string): Promise<SessionActivityView | undefined> {
    const notFound = ['CLASS_SESSION_NOT_FOUND', 'SESSION_NOT_FOUND'];
    const m = await orUndefined(() => this.deps.memorization.getScheduledMemorization(sessionId), notFound);
    if (!m) return undefined;
    const r = await orUndefined(() => this.deps.revision.getScheduledRevision(sessionId), notFound);
    return {
      status: m.status,
      teacherId: m.teacherId,
      scheduledStart: m.scheduledStart,
      scheduledEnd: m.scheduledEnd,
      memorizationPending: m.scheduled && m.unrecordedAssignmentIds.length > 0,
      revisionPending: !!r && r.scheduled && r.unrecordedAssignmentIds.length > 0,
    };
  }

  async assignmentTexts(sessionId: string, studentId: string): Promise<AssignmentTexts> {
    const m = await this.deps.memorization.getScheduledMemorization(sessionId);
    const r = await this.deps.revision.getScheduledRevision(sessionId);
    const memorization = await textOf(m.assignments, studentId, this.deps.quran);
    const revision = await textOf(r.assignments, studentId, this.deps.quran);
    return { ...(memorization ? { memorization } : {}), ...(revision ? { revision } : {}) };
  }
}
