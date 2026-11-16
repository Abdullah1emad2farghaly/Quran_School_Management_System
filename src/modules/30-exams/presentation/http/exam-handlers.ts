import type { PageRequest, PageResult } from '../../../00-shared-kernel/public';
import type { ExamService } from '../../application/services/exam-service';
import { isExamStatus, type ExamStatus } from '../../domain/value-objects/exam-rules';
import { serializeExam, serializeOutcome, serializePendingGroup, serializePendingStudent, serializeReceipt, serializeResults, serializeSchedule } from './exam-serializer';

export type ExamHandlerService = Pick<
  ExamService,
  | 'createExam' | 'updateExam' | 'scheduleExam' | 'cancelExam' | 'deleteExam' | 'changeEndTime' | 'completeExam' | 'endExam' | 'assignExaminer' | 'removeExaminer' | 'submitResult' | 'getExam' | 'listSchoolExams'
  | 'listAssignedExams' | 'listParentSchedule' | 'getResults' | 'listStudentOutcomes' | 'listPendingGroups' | 'listPendingStudents'
>;

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null ? (value as Json) : {});
/** An ISO-8601 text becomes a Date; anything else becomes an invalid Date, which the domain rejects with the specific code. */
const date = (value: unknown): Date => (typeof value === 'string' ? new Date(value) : new Date(Number.NaN));
const optionalDate = (value: unknown): Date | null | undefined => (value === undefined ? undefined : value === null ? null : date(value));
const strings = (value: unknown): string[] | undefined => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined);

function configOf(b: Json) {
  return {
    ...(b.startAt !== undefined ? { startAt: date(b.startAt) } : {}),
    ...(b.endAt !== undefined ? { endAt: optionalDate(b.endAt) as Date | null } : {}),
    ...(b.questionCount !== undefined ? { questionCount: b.questionCount as number } : {}),
    ...(b.maxScore !== undefined ? { maxScore: b.maxScore as number } : {}),
    ...(b.wholeSchool !== undefined ? { wholeSchool: b.wholeSchool === true } : {}),
    ...(b.groupIds !== undefined ? { groupIds: strings(b.groupIds) ?? [] } : {}),
  };
}

/**
 * Framework-free handlers behind the exam routes: they map an already validated request to the application service and the response data. The caller always comes from the
 * verified token, never from the body; the school and the exam are authorized by the route guard before they run.
 */
export function createExamHandlers(getService: () => ExamHandlerService) {
  const page = async <T, U>(result: Promise<PageResult<T>>, map: (item: T) => U): Promise<PageResult<U>> => {
    const r = await result;
    return { ...r, items: r.items.map(map) };
  };
  return {
    create: async (userId: string, body: unknown) => {
      const b = obj(body);
      const c = configOf(b);
      return serializeExam(await getService().createExam(userId, {
        schoolId: b.schoolId as string, startAt: c.startAt ?? new Date(Number.NaN), endAt: (c.endAt ?? null) as Date | null, questionCount: b.questionCount as number, maxScore: b.maxScore as number,
        wholeSchool: b.wholeSchool === true, groupIds: strings(b.groupIds) ?? [], examinerTeacherIds: strings(b.examinerTeacherIds) ?? [],
      }));
    },
    update: async (examId: string, userId: string, body: unknown) => serializeExam(await getService().updateExam(examId, userId, configOf(obj(body)))),
    schedule: async (examId: string, userId: string) => serializeExam(await getService().scheduleExam(examId, userId)),
    cancel: async (examId: string, userId: string) => serializeExam(await getService().cancelExam(examId, userId)),
    remove: async (examId: string, userId: string) => getService().deleteExam(examId, userId),
    changeEndTime: async (examId: string, userId: string, body: unknown) => serializeExam(await getService().changeEndTime(examId, userId, date(obj(body).endAt))),
    complete: async (examId: string, userId: string) => serializeExam(await getService().completeExam(examId, userId)),
    end: async (examId: string, userId: string) => serializeExam(await getService().endExam(examId, userId)),
    assignExaminer: async (examId: string, userId: string, body: unknown) => serializeExam(await getService().assignExaminer(examId, userId, obj(body).teacherId as string)),
    removeExaminer: async (examId: string, userId: string, teacherId: string) => serializeExam(await getService().removeExaminer(examId, userId, teacherId)),
    submitResult: async (examId: string, userId: string, body: unknown) => serializeReceipt(await getService().submitResult(examId, userId, { studentId: obj(body).studentId as string, scores: obj(body).scores, gps: obj(body).gps })),
    get: async (examId: string) => serializeExam(await getService().getExam(examId)),
    listSchool: (schoolId: string, statuses: ExamStatus[] | undefined, p: PageRequest) => page(getService().listSchoolExams(schoolId, { ...(statuses ? { statuses } : {}), page: p }), serializeExam),
    listAssigned: (userId: string, p: PageRequest) => page(getService().listAssignedExams(userId, p), serializeExam),
    listSchedule: (userId: string, p: PageRequest) => page(getService().listParentSchedule(userId, p), serializeSchedule),
    results: async (examId: string) => serializeResults(await getService().getResults(examId)),
    listStudent: (studentId: string, p: PageRequest) => page(getService().listStudentOutcomes(studentId, p), serializeOutcome),
    pendingGroups: async (examId: string) => (await getService().listPendingGroups(examId)).map(serializePendingGroup),
    pendingStudents: (examId: string, groupId: string, p: PageRequest) => page(getService().listPendingStudents(examId, groupId, p), serializePendingStudent),
    parseStatuses: (raw: unknown): ExamStatus[] | undefined => {
      const list = (typeof raw === 'string' ? raw.split(',') : Array.isArray(raw) ? raw.map(String) : []).map((s) => s.trim().toUpperCase()).filter(isExamStatus);
      return list.length > 0 ? list : undefined;
    },
  };
}
