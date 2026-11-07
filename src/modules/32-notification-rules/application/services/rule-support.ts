import type { Clock, DomainEvent, UnitOfWork } from '../../../00-shared-kernel/public';
import type { NotificationService, NotificationTemplateRegistry } from '../../../31-notifications-core/public';
import { NO_VALUE } from '../../domain/value-objects/message-format';
import type { AssignmentDirectory, ExamDirectory, GroupDirectory, QuranDirectory, SchoolDirectory, SessionReads, StudentDirectory, StudentInfo, TeacherDirectory } from '../ports/directories';
import type { RuleStateRepository } from '../ports/rule-state-repository';

/** Everything the rules need. Each directory is a narrow read port over another module's PUBLIC contract. */
export interface RuleDeps {
  readonly notifications: Pick<NotificationService, 'notify'>;
  readonly templates: NotificationTemplateRegistry;
  readonly students: StudentDirectory;
  readonly teachers: TeacherDirectory;
  readonly groups: GroupDirectory;
  readonly schools: SchoolDirectory;
  readonly exams: ExamDirectory;
  readonly sessions: SessionReads;
  readonly assignments: AssignmentDirectory;
  readonly quran: QuranDirectory;
  readonly state: RuleStateRepository;
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
}

type Params = Readonly<Record<string, string | number>>;
type Data = Readonly<Record<string, unknown>>;

/** The payload of an event as the shape its producing module publishes (the outbox stores plain JSON). A missing payload is an empty object, so a handler just finds nothing to do. */
export function payloadOf<T>(event: DomainEvent): Partial<T> {
  return event.payload !== null && typeof event.payload === 'object' ? (event.payload as Partial<T>) : {};
}

/** A non-blank string from a payload field, else undefined. */
export const idOf = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/**
 * Tells the Parent accounts of ONE student (never anyone else). `notify` records the once-only key per recipient BEFORE creating the notification, so a retried event or a
 * repeated reminder creates nothing twice. Returns the number of accounts notified.
 */
export async function notifyParentsOf(deps: RuleDeps, student: StudentInfo, templateKey: string, params: Params, data: Data, dedupKey: string): Promise<number> {
  if (student.parentUserIds.length === 0) return 0;
  const result = await deps.notifications.notify({ recipientUserIds: student.parentUserIds, templateKey, params, data, dedupKey });
  return result.created.length;
}

/** Tells one account. */
export async function notifyUser(deps: RuleDeps, userId: string, templateKey: string, params: Params, data: Data, dedupKey: string): Promise<number> {
  const result = await deps.notifications.notify({ recipientUserIds: [userId], templateKey, params, data, dedupKey });
  return result.created.length;
}

/** Tells the account of a Teacher record (nothing happens when the Teacher no longer exists). */
export async function notifyTeacher(deps: RuleDeps, teacherId: string | null | undefined, templateKey: string, params: Params, data: Data, dedupKey: string): Promise<number> {
  if (!teacherId) return 0;
  const userId = await deps.teachers.userIdOf(teacherId);
  return userId ? notifyUser(deps, userId, templateKey, params, data, dedupKey) : 0;
}

export { NO_VALUE };
