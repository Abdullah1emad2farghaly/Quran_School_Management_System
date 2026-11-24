import { describe, expect, it } from 'vitest';
import { ExamService, InMemoryExamRepository, type ExamSnapshot, type ExamResultSnapshot } from '../../../src/modules/30-exams/public';
import { InMemorySubscriptionRepository, Subscription, SubscriptionService } from '../../../src/modules/33-subscriptions/public';

const STUDENT = 'student-1';
const OTHER = 'student-2';
const G1 = 'group-1';
const G2 = 'group-2';
const SCHOOL = 'school-1';

function exams() {
  const repo = new InMemoryExamRepository();
  const examAt = (id: string, startAt: string, over: Partial<ExamSnapshot> = {}) => {
    const at = new Date(startAt);
    const snapshot: ExamSnapshot = {
      id, schoolId: SCHOOL, wholeSchool: false, groupIds: [G1], startAt: at, endAt: null, questionCount: 3, maxScore: 10, status: 'ENDED', examiners: [], createdBy: 'u', createdAt: at, updatedAt: at,
      scheduledAt: null, startedAt: at, completedAt: at, endedAt: at, cancelledAt: null, deletedAt: null, ...over,
    };
    repo.exams.set(id, snapshot);
  };
  const target = (examId: string, studentId: string, groupId: string, status: 'PENDING' | 'EXAMINED' | 'ABSENT') =>
    repo.students.push({ examId, studentId, groupId, groupName: 'g', fullName: 'n', status });
  const result = (examId: string, studentId: string, groupId: string, scores: number[]) => {
    const snapshot: ExamResultSnapshot = {
      id: `r-${examId}-${studentId}`, examId, schoolId: SCHOOL, groupId, studentId, scores, total: scores.reduce((a, b) => a + b, 0), examinerTeacherId: 't', examinerUserId: 'u', recordedAt: new Date('2026-11-12T10:00:00Z'),
    };
    repo.results.set(snapshot.id, snapshot);
  };
  examAt('e-oct', '2026-10-05T07:00:00Z');
  examAt('e-nov1', '2026-11-02T07:00:00Z');
  examAt('e-nov2', '2026-11-09T07:00:00Z', { questionCount: 2, maxScore: 7.5 });
  examAt('e-pending', '2026-11-10T07:00:00Z', { status: 'STARTED' });
  examAt('e-deleted', '2026-11-11T07:00:00Z', { deletedAt: new Date('2026-11-12T00:00:00Z') });
  examAt('e-other-group', '2026-11-13T07:00:00Z', { groupIds: [G2] });
  target('e-oct', STUDENT, G1, 'EXAMINED');
  result('e-oct', STUDENT, G1, [9, 8, 10]);
  target('e-nov1', STUDENT, G1, 'ABSENT');
  target('e-nov2', STUDENT, G1, 'EXAMINED');
  result('e-nov2', STUDENT, G1, [7.5, 6.25]);
  target('e-pending', STUDENT, G1, 'PENDING');
  target('e-deleted', STUDENT, G1, 'EXAMINED');
  target('e-other-group', STUDENT, G2, 'ABSENT');
  target('e-nov1', OTHER, G1, 'EXAMINED');
  result('e-nov1', OTHER, G1, [1, 1, 1]);
  return { repo, service: new ExamService({ exams: repo } as never) };
}

describe('Module 30 read contract for the Student report: listStudentOutcomesForReport', () => {
  it('returns the RECORDED outcomes of ONE student, oldest first, with the recorded scores and total; pending and deleted exams are never included', async () => {
    const { service } = exams();
    const rows = await service.listStudentOutcomesForReport({ studentId: STUDENT });
    expect(rows.map((r) => [r.examId, r.outcome])).toEqual([['e-oct', 'EXAMINED'], ['e-nov1', 'ABSENT'], ['e-nov2', 'EXAMINED'], ['e-other-group', 'ABSENT']]);
    expect(rows[0]).toMatchObject({ groupId: G1, questionCount: 3, maxScorePerQuestion: 10, scores: [9, 8, 10], total: 27, maxTotal: 30 });
    expect(rows[2]).toMatchObject({ scores: [7.5, 6.25], total: 13.75, maxTotal: 15 });
  });

  it('an ABSENT outcome has no scores and no total, only the exam\'s own maximum', async () => {
    const { service } = exams();
    const absent = (await service.listStudentOutcomesForReport({ studentId: STUDENT })).find((r) => r.examId === 'e-nov1')!;
    expect(absent.scores).toEqual([]);
    expect(absent.total).toBeNull();
    expect(absent.maxTotal).toBe(30);
  });

  it('never returns another student\'s data', async () => {
    const { service } = exams();
    const rows = await service.listStudentOutcomesForReport({ studentId: OTHER });
    expect(rows.map((r) => r.examId)).toEqual(['e-nov1']);
    expect(rows[0]!.scores).toEqual([1, 1, 1]);
  });

  it('the period bounds the exam START: `from` inclusive, `toExclusive` exclusive', async () => {
    const { service } = exams();
    const ids = async (query: { from?: Date; toExclusive?: Date }) => (await service.listStudentOutcomesForReport({ studentId: STUDENT, ...query })).map((r) => r.examId);
    expect(await ids({ from: new Date('2026-11-02T07:00:00Z') })).toEqual(['e-nov1', 'e-nov2', 'e-other-group']);
    expect(await ids({ toExclusive: new Date('2026-11-02T07:00:00Z') })).toEqual(['e-oct']);
    expect(await ids({ from: new Date('2026-11-01T00:00:00Z'), toExclusive: new Date('2026-11-10T00:00:00Z') })).toEqual(['e-nov1', 'e-nov2']);
  });

  it('can be limited to groups (a Teacher\'s current groups); an empty list matches nothing', async () => {
    const { service } = exams();
    expect((await service.listStudentOutcomesForReport({ studentId: STUDENT, groupIds: [G2] })).map((r) => r.examId)).toEqual(['e-other-group']);
    expect((await service.listStudentOutcomesForReport({ studentId: STUDENT, groupIds: [G1] })).map((r) => r.examId)).toEqual(['e-oct', 'e-nov1', 'e-nov2']);
    expect(await service.listStudentOutcomesForReport({ studentId: STUDENT, groupIds: [] })).toEqual([]);
  });

  it('is read-only: the stored results and target list are unchanged', async () => {
    const { repo, service } = exams();
    const before = JSON.stringify({ s: repo.students, r: [...repo.results.values()] });
    await service.listStudentOutcomesForReport({ studentId: STUDENT });
    expect(JSON.stringify({ s: repo.students, r: [...repo.results.values()] })).toBe(before);
  });
});

describe('Module 33 read contract for the Student report: listStudentSubscriptionsForReport', () => {
  const build = () => {
    const repo = new InMemorySubscriptionRepository();
    const add = (studentId: string, month: string, status: 'UNPAID' | 'PAID' | 'WAIVED') => {
      const snapshot = Subscription.rehydrate({
        id: `${studentId}-${month}`, studentId, schoolId: SCHOOL, organizationId: 'org', month, status, batchId: null, createdBy: 'u',
        paidAt: status === 'PAID' ? new Date('2026-11-05T10:00:00Z') : null, paidBy: status === 'PAID' ? 'c' : null,
        waivedAt: status === 'WAIVED' ? new Date('2026-11-05T10:00:00Z') : null, waivedBy: status === 'WAIVED' ? 'm' : null, version: 1, createdAt: new Date('2026-09-01T00:00:00Z'), updatedAt: new Date('2026-09-01T00:00:00Z'),
      } as never).snapshot;
      repo.rows.set(snapshot.id, snapshot);
    };
    add(STUDENT, '2026-11', 'UNPAID');
    add(STUDENT, '2026-09', 'PAID');
    add(STUDENT, '2026-10', 'WAIVED');
    add(OTHER, '2026-10', 'PAID');
    return new SubscriptionService({ subscriptions: repo } as never);
  };

  it('returns ONE student\'s subscriptions, oldest month first, with the status recorded now', async () => {
    const rows = await build().listStudentSubscriptionsForReport({ studentId: STUDENT });
    expect(rows).toEqual([{ month: '2026-09', status: 'PAID' }, { month: '2026-10', status: 'WAIVED' }, { month: '2026-11', status: 'UNPAID' }]);
    expect(await build().listStudentSubscriptionsForReport({ studentId: 'nobody' })).toEqual([]);
  });

  it('the month bounds are inclusive', async () => {
    const service = build();
    const months = async (query: { fromMonth?: string; toMonth?: string }) => (await service.listStudentSubscriptionsForReport({ studentId: STUDENT, ...query })).map((r) => r.month);
    expect(await months({ fromMonth: '2026-10' })).toEqual(['2026-10', '2026-11']);
    expect(await months({ toMonth: '2026-10' })).toEqual(['2026-09', '2026-10']);
    expect(await months({ fromMonth: '2026-10', toMonth: '2026-10' })).toEqual(['2026-10']);
  });
});
