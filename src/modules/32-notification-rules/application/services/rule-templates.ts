import { NotificationTemplateRegistry, type NotificationTemplate } from '../../../31-notifications-core/public';
import type { AssignmentKind } from '../ports/directories';
import type { RangeShape } from './assignment-description';

/**
 * The Arabic and English templates of every notification Module 32 produces (approved Module 31 decision: every template has both languages; the account's language,
 * otherwise Arabic, is chosen by Module 31 when the notification is created). `{name}` placeholders are filled from parameters that are the SAME text for every recipient:
 * times are `YYYY-MM-DD HH:mm` in Africa/Cairo, a Quran range is `surah:ayah → surah:ayah`.
 */
export const TEMPLATE_KEYS = {
  schoolRequestSubmitted: 'school.request-submitted',
  schoolRequestApproved: 'school.request-approved',
  schoolRequestRejected: 'school.request-rejected',
  groupStudentAssignedParent: 'group.student-assigned.parent',
  groupStudentUnassignedParent: 'group.student-unassigned.parent',
  groupStudentUnassignedArchivedParent: 'group.student-unassigned-archived.parent',
  groupStudentAssignedTeacher: 'group.student-assigned.teacher',
  groupStudentUnassignedTeacher: 'group.student-unassigned.teacher',
  groupTeacherAssigned: 'group.teacher-assigned',
  groupTeacherRemoved: 'group.teacher-removed',
  groupArchivedTeacher: 'group.archived.teacher',
  examExaminerAssigned: 'exam.examiner-assigned',
  examExaminerRemoved: 'exam.examiner-removed',
  examScheduledParent: 'exam.scheduled.parent',
  examRemovedParent: 'exam.removed.parent',
  examUpdatedParent: 'exam.updated.parent',
  examUpdatedExaminer: 'exam.updated.examiner',
  examCancelledParent: 'exam.cancelled.parent',
  examCancelledExaminer: 'exam.cancelled.examiner',
  examResultParent: 'exam.result.parent',
  examReminderParent: 'exam.reminder.parent',
  examReminderExaminer: 'exam.reminder.examiner',
  sessionHalfTimeMemorization: 'session.half-time.memorization',
  sessionHalfTimeRevision: 'session.half-time.revision',
  sessionHalfTimeBoth: 'session.half-time.both',
  sessionEvaluationWarning: 'session.evaluation-warning',
  subscriptionsCreatedCollector: 'subscription.monthly-created.collector',
  subscriptionPaidParent: 'subscription.paid.parent',
  subscriptionUnpaidParent: 'subscription.unpaid-reminder.parent',
  subscriptionMonthEndParent: 'subscription.month-end.parent',
  subscriptionMonthEndCollector: 'subscription.month-end.collector',
  subscriptionMonthEndManager: 'subscription.month-end.manager',
} as const;

export type { AssignmentKind };
export type AssignmentAction = 'defined' | 'modified' | 'cancelled';
/** The plain notification (student and group only): used only when the assignment itself can no longer be read. */
export const assignmentTemplateKey = (kind: AssignmentKind, action: AssignmentAction): string => `assignment.${kind}-${action}`;
/** The notification with the actual range, by the unit the assignment was defined in. */
export const assignmentDetailTemplateKey = (kind: AssignmentKind, action: AssignmentAction, shape: RangeShape): string => `assignment.${kind}-${action}.${shape.toLowerCase()}`;

const t = (key: string, type: string, title: { ar: string; en: string }, body: { ar: string; en: string }): NotificationTemplate => ({ key, type, title, body });

const ASSIGNMENT_WORDS: Record<AssignmentKind, { ar: string; en: string }> = {
  memorization: { ar: 'الحفظ', en: 'memorization' },
  revision: { ar: 'المراجعة', en: 'revision' },
};
const ASSIGNMENT_ACTIONS: Record<AssignmentAction, { ar: string; en: string; type: string }> = {
  defined: { ar: 'تم تحديد مقرر', en: 'A new assignment was set for', type: 'DEFINED' },
  modified: { ar: 'تم تعديل مقرر', en: 'The assignment was modified for', type: 'MODIFIED' },
  cancelled: { ar: 'تم إلغاء مقرر', en: 'The assignment was cancelled for', type: 'CANCELLED' },
};

const RANGE_LINES: Record<RangeShape, { ar: string; en: string }> = {
  AYAHS: { ar: 'الآيات: {span} ({ayahCount} آية).', en: 'Ayahs: {span} ({ayahCount} ayahs).' },
  SURAHS: { ar: 'السور: {surahs} ({surahCount} — الطرفان مشمولان). الآيات: {span}.', en: 'Surahs: {surahs} ({surahCount}, both endpoints included). Ayahs: {span}.' },
  PAGES: { ar: 'صفحات المصحف: {pages}. الآيات: {span}.', en: 'Mushaf pages: {pages}. Ayahs: {span}.' },
  QUARTERS: { ar: 'الأرباع: {quarters}. الآيات: {span}.', en: 'Quarters: {quarters}. Ayahs: {span}.' },
  LINES: { ar: '{lines} سطرًا، صفحات المصحف: {pages}. الآيات: {span}.', en: '{lines} lines, Mushaf pages: {pages}. Ayahs: {span}.' },
};

function assignmentTemplates(): NotificationTemplate[] {
  const out: NotificationTemplate[] = [];
  for (const kind of ['memorization', 'revision'] as const) {
    for (const action of ['defined', 'modified', 'cancelled'] as const) {
      const w = ASSIGNMENT_WORDS[kind];
      const a = ASSIGNMENT_ACTIONS[action];
      const type = `${kind.toUpperCase()}_ASSIGNMENT_${a.type}`;
      const title = { ar: `تغيير في مقرر ${w.ar}`, en: `Change in the ${w.en} assignment` };
      const sentence = { ar: `${a.ar} ${w.ar} للطالب {student} (المجموعة «{group}»).`, en: `${a.en} ${w.en} for {student} (group “{group}”).` };
      out.push(t(assignmentTemplateKey(kind, action), type, title, sentence));
      for (const shape of Object.keys(RANGE_LINES) as RangeShape[]) {
        const line = RANGE_LINES[shape];
        out.push(t(assignmentDetailTemplateKey(kind, action, shape), type, title, { ar: `${sentence.ar}\n${line.ar}`, en: `${sentence.en}\n${line.en}` }));
      }
    }
  }
  return out;
}

/** The fixed templates. Registered once at startup (`registerRuleTemplates`). */
export const RULE_TEMPLATES: readonly NotificationTemplate[] = [
  t(TEMPLATE_KEYS.schoolRequestSubmitted, 'SCHOOL_REQUEST_SUBMITTED', { ar: 'طلب إنشاء مدرسة جديد', en: 'New school request' }, {
    ar: 'قدّم {applicant} طلبًا لإنشاء المدرسة «{school}». يرجى مراجعة الطلب.',
    en: '{applicant} requested to create the school “{school}”. Please review the request.',
  }),
  t(TEMPLATE_KEYS.schoolRequestApproved, 'SCHOOL_REQUEST_APPROVED', { ar: 'تمت الموافقة على طلبك', en: 'Your school request was approved' }, {
    ar: 'تمت الموافقة على طلب إنشاء المدرسة «{school}».',
    en: 'Your request to create the school “{school}” was approved.',
  }),
  t(TEMPLATE_KEYS.schoolRequestRejected, 'SCHOOL_REQUEST_REJECTED', { ar: 'تم رفض طلبك', en: 'Your school request was rejected' }, {
    ar: 'تم رفض طلب إنشاء المدرسة «{school}». السبب: {reason}',
    en: 'Your request to create the school “{school}” was rejected. Reason: {reason}',
  }),

  t(TEMPLATE_KEYS.groupStudentAssignedParent, 'GROUP_STUDENT_ASSIGNED', { ar: 'تسجيل في مجموعة', en: 'Added to a group' }, {
    ar: 'تم تسجيل {student} في المجموعة «{group}».',
    en: '{student} was added to the group “{group}”.',
  }),
  t(TEMPLATE_KEYS.groupStudentUnassignedParent, 'GROUP_STUDENT_UNASSIGNED', { ar: 'إزالة من مجموعة', en: 'Removed from a group' }, {
    ar: 'تمت إزالة {student} من المجموعة «{group}».',
    en: '{student} was removed from the group “{group}”.',
  }),
  t(TEMPLATE_KEYS.groupStudentUnassignedArchivedParent, 'GROUP_STUDENT_UNASSIGNED', { ar: 'إزالة من مجموعة', en: 'Removed from a group' }, {
    ar: 'تمت إزالة {student} من المجموعة «{group}» بسبب أرشفة المجموعة.',
    en: '{student} was removed from the group “{group}” because the group was archived.',
  }),
  t(TEMPLATE_KEYS.groupStudentAssignedTeacher, 'GROUP_STUDENT_ASSIGNED', { ar: 'طالب جديد في مجموعتك', en: 'A student joined your group' }, {
    ar: 'تمت إضافة الطالب {student} إلى مجموعتك «{group}».',
    en: 'The student {student} was added to your group “{group}”.',
  }),
  t(TEMPLATE_KEYS.groupStudentUnassignedTeacher, 'GROUP_STUDENT_UNASSIGNED', { ar: 'طالب غادر مجموعتك', en: 'A student left your group' }, {
    ar: 'تمت إزالة الطالب {student} من مجموعتك «{group}».',
    en: 'The student {student} was removed from your group “{group}”.',
  }),
  t(TEMPLATE_KEYS.groupTeacherAssigned, 'GROUP_TEACHER_ASSIGNED', { ar: 'تعيين معلم مسؤول', en: 'You are now responsible for a group' }, {
    ar: 'تم تعيينك معلمًا مسؤولًا عن المجموعة «{group}».',
    en: 'You were assigned as the responsible Teacher of the group “{group}”.',
  }),
  t(TEMPLATE_KEYS.groupTeacherRemoved, 'GROUP_TEACHER_REMOVED', { ar: 'لم تعد معلمًا مسؤولًا عن مجموعة', en: 'You are no longer responsible for a group' }, {
    ar: 'لم تعد المعلم المسؤول عن المجموعة «{group}».',
    en: 'You are no longer the responsible Teacher of the group “{group}”.',
  }),
  t(TEMPLATE_KEYS.groupArchivedTeacher, 'GROUP_ARCHIVED', { ar: 'أرشفة مجموعة', en: 'Group archived' }, {
    ar: 'تمت أرشفة مجموعتك «{group}».',
    en: 'Your group “{group}” was archived.',
  }),

  ...assignmentTemplates(),

  t(TEMPLATE_KEYS.examExaminerAssigned, 'EXAM_EXAMINER_ASSIGNED', { ar: 'تعيين ممتحن', en: 'You were assigned as an examiner' }, {
    ar: 'تم تعيينك ممتحنًا في اختبار. البداية: {start}، النهاية: {end} (بتوقيت القاهرة).',
    en: 'You were assigned as an examiner of an exam. Start: {start}, end: {end} (Cairo time).',
  }),
  t(TEMPLATE_KEYS.examExaminerRemoved, 'EXAM_EXAMINER_REMOVED', { ar: 'إزالة ممتحن', en: 'You were removed as an examiner' }, {
    ar: 'تمت إزالتك من ممتحني الاختبار المقرر في {start} (بتوقيت القاهرة).',
    en: 'You were removed as an examiner of the exam scheduled for {start} (Cairo time).',
  }),
  t(TEMPLATE_KEYS.examScheduledParent, 'EXAM_SCHEDULED', { ar: 'اختبار جديد', en: 'A new exam' }, {
    ar: 'تم تحديد اختبار للطالب {student}. البداية: {start}، النهاية: {end} (بتوقيت القاهرة).',
    en: 'An exam was scheduled for {student}. Start: {start}, end: {end} (Cairo time).',
  }),
  t(TEMPLATE_KEYS.examRemovedParent, 'EXAM_TARGET_REMOVED', { ar: 'تغيير في المستهدفين بالاختبار', en: 'Exam targets changed' }, {
    ar: 'لم يعد الطالب {student} ضمن المستهدفين بالاختبار المقرر في {start} (بتوقيت القاهرة).',
    en: '{student} is no longer targeted by the exam scheduled for {start} (Cairo time).',
  }),
  t(TEMPLATE_KEYS.examUpdatedParent, 'EXAM_UPDATED', { ar: 'تعديل اختبار', en: 'Exam modified' }, {
    ar: 'تم تعديل اختبار الطالب {student}. الموعد الحالي — البداية: {start}، النهاية: {end} (بتوقيت القاهرة).',
    en: 'The exam of {student} was modified. Current schedule — start: {start}, end: {end} (Cairo time).',
  }),
  t(TEMPLATE_KEYS.examUpdatedExaminer, 'EXAM_UPDATED', { ar: 'تعديل اختبار', en: 'Exam modified' }, {
    ar: 'تم تعديل اختبار أنت ممتحنه. الموعد الحالي — البداية: {start}، النهاية: {end} (بتوقيت القاهرة).',
    en: 'An exam you examine was modified. Current schedule — start: {start}, end: {end} (Cairo time).',
  }),
  t(TEMPLATE_KEYS.examCancelledParent, 'EXAM_CANCELLED', { ar: 'إلغاء اختبار', en: 'Exam cancelled' }, {
    ar: 'تم إلغاء الاختبار المقرر للطالب {student} في {start} (بتوقيت القاهرة).',
    en: 'The exam scheduled for {student} on {start} (Cairo time) was cancelled.',
  }),
  t(TEMPLATE_KEYS.examCancelledExaminer, 'EXAM_CANCELLED', { ar: 'إلغاء اختبار', en: 'Exam cancelled' }, {
    ar: 'تم إلغاء الاختبار المقرر في {start} (بتوقيت القاهرة).',
    en: 'The exam scheduled for {start} (Cairo time) was cancelled.',
  }),
  t(TEMPLATE_KEYS.examResultParent, 'EXAM_RESULT_RECORDED', { ar: 'نتيجة اختبار', en: 'Exam result' }, {
    ar: 'حصل الطالب {student} على {total} من {max}. درجات الأسئلة: {scores}.',
    en: '{student} scored {total} out of {max}. Question scores: {scores}.',
  }),
  t(TEMPLATE_KEYS.examReminderParent, 'EXAM_REMINDER', { ar: 'تذكير باختبار', en: 'Exam reminder' }, {
    ar: 'تذكير: يبدأ اختبار الطالب {student} خلال 24 ساعة، في {start} (بتوقيت القاهرة).',
    en: 'Reminder: the exam of {student} starts within 24 hours, at {start} (Cairo time).',
  }),
  t(TEMPLATE_KEYS.examReminderExaminer, 'EXAM_REMINDER', { ar: 'تذكير باختبار', en: 'Exam reminder' }, {
    ar: 'تذكير: يبدأ اختبار أنت ممتحنه خلال 24 ساعة، في {start} (بتوقيت القاهرة).',
    en: 'Reminder: an exam you examine starts within 24 hours, at {start} (Cairo time).',
  }),

  t(TEMPLATE_KEYS.sessionHalfTimeMemorization, 'SESSION_HALF_TIME_REMINDER', { ar: 'تذكير: تسجيل الحفظ', en: 'Reminder: record memorization' }, {
    ar: 'انقضى نصف وقت الحصة ولم يُسجَّل الحفظ المقرر بعد.',
    en: 'Half of the session has passed and the scheduled memorization has not been recorded yet.',
  }),
  t(TEMPLATE_KEYS.sessionHalfTimeRevision, 'SESSION_HALF_TIME_REMINDER', { ar: 'تذكير: تسجيل المراجعة', en: 'Reminder: record revision' }, {
    ar: 'انقضى نصف وقت الحصة ولم تُسجَّل المراجعة المقررة بعد.',
    en: 'Half of the session has passed and the scheduled revision has not been recorded yet.',
  }),
  t(TEMPLATE_KEYS.sessionHalfTimeBoth, 'SESSION_HALF_TIME_REMINDER', { ar: 'تذكير: تسجيل الحفظ والمراجعة', en: 'Reminder: record memorization and revision' }, {
    ar: 'انقضى نصف وقت الحصة ولم يُسجَّل الحفظ والمراجعة المقرران بعد.',
    en: 'Half of the session has passed and the scheduled memorization and revision have not been recorded yet.',
  }),
  t(TEMPLATE_KEYS.sessionEvaluationWarning, 'SESSION_EVALUATION_WARNING', { ar: 'تنبيه: تقييمات ناقصة', en: 'Warning: evaluations missing' }, {
    ar: 'تبقّى 15 دقيقة على نهاية الحصة، وهناك طلاب حاضرون لم يتم تقييمهم بعد ({count}).',
    en: 'The session ends in 15 minutes and some present students have not been evaluated yet ({count}).',
  }),
  t(TEMPLATE_KEYS.subscriptionsCreatedCollector, 'SUBSCRIPTIONS_CREATED', { ar: 'تم إنشاء اشتراكات الشهر', en: 'Monthly subscriptions created' }, {
    ar: 'تم إنشاء اشتراكات شهر {month} لمدرسة «{school}» ({count} اشتراكًا غير مدفوع).',
    en: 'The subscriptions of {month} were created for the school “{school}” ({count} unpaid subscriptions).',
  }),
  t(TEMPLATE_KEYS.subscriptionPaidParent, 'SUBSCRIPTION_PAID', { ar: 'تم تسجيل دفع الاشتراك', en: 'Subscription payment recorded' }, {
    ar: 'تم تسجيل دفع اشتراك شهر {month} للطالب {student}.',
    en: 'The payment of the {month} subscription of {student} was recorded.',
  }),
  t(TEMPLATE_KEYS.subscriptionUnpaidParent, 'SUBSCRIPTION_UNPAID_REMINDER', { ar: 'تذكير باشتراك غير مدفوع', en: 'Unpaid subscription reminder' }, {
    ar: 'اشتراك شهر {month} للطالب {student} لا يزال غير مدفوع.',
    en: 'The {month} subscription of {student} is still unpaid.',
  }),
  t(TEMPLATE_KEYS.subscriptionMonthEndParent, 'SUBSCRIPTION_MONTH_END_REMINDER', { ar: 'تذكير بنهاية الشهر: اشتراك غير مدفوع', en: 'End-of-month reminder: unpaid subscription' }, {
    ar: 'اقترب انتهاء شهر {month} واشتراك الطالب {student} لا يزال غير مدفوع.',
    en: '{month} is ending and the subscription of {student} is still unpaid.',
  }),
  t(TEMPLATE_KEYS.subscriptionMonthEndCollector, 'SUBSCRIPTION_MONTH_END_REMINDER', { ar: 'طلاب لم يدفعوا اشتراك الشهر', en: 'Students with unpaid subscriptions' }, {
    ar: 'اقترب انتهاء شهر {month}. لا يزال {count} طالبًا لم يدفعوا اشتراك مدرسة «{school}»: {students}',
    en: '{month} is ending. {count} students of the school “{school}” still have an unpaid subscription: {students}',
  }),
  t(TEMPLATE_KEYS.subscriptionMonthEndManager, 'SUBSCRIPTION_MONTH_END_REMINDER', { ar: 'طلاب لم يدفعوا اشتراك الشهر', en: 'Students with unpaid subscriptions' }, {
    ar: 'اقترب انتهاء شهر {month}. لا يزال {count} طالبًا لم يدفعوا اشتراك مدرسة «{school}»: {students}',
    en: '{month} is ending. {count} students of the school “{school}” still have an unpaid subscription: {students}',
  }),
];

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// Evaluation templates (Module 29 notification to the Parent). The scores shown depend on which categories were evaluated, so a template exists for every combination of
// categories (and with / without a Teacher note); it is generated on first use. The note line exists ONLY when a note exists (approved decision 7: otherwise it is omitted).

export const EVALUATION_CATEGORIES_ORDER = ['MEMORIZATION', 'REVISION', 'PERFORMANCE', 'TAJWEED'] as const;
export type EvaluationCategoryName = (typeof EVALUATION_CATEGORIES_ORDER)[number];

const CATEGORY_LABELS: Record<EvaluationCategoryName, { ar: string; en: string }> = {
  MEMORIZATION: { ar: 'الحفظ', en: 'Memorization' },
  REVISION: { ar: 'المراجعة', en: 'Revision' },
  PERFORMANCE: { ar: 'الأداء', en: 'Performance' },
  TAJWEED: { ar: 'التجويد', en: 'Tajweed' },
};

export const evaluationParamName = (category: EvaluationCategoryName): string => `score_${category}`;

export interface EvaluationTemplateSpec {
  readonly action: 'recorded' | 'updated';
  /** The evaluated categories, in the fixed order. */
  readonly categories: readonly EvaluationCategoryName[];
  readonly hasNote: boolean;
}

export function evaluationTemplateKey(spec: EvaluationTemplateSpec): string {
  const mask = spec.categories.map((c) => c.toLowerCase()).join('-');
  return `evaluation.${spec.action}.${mask}${spec.hasNote ? '.note' : ''}`;
}

export function buildEvaluationTemplate(spec: EvaluationTemplateSpec): NotificationTemplate {
  const lines = (lang: 'ar' | 'en'): string[] => spec.categories.map((c) => `${CATEGORY_LABELS[c][lang]}: {${evaluationParamName(c)}}`);
  const total = { ar: 'المجموع: {total}', en: 'Total: {total}' };
  const note = { ar: 'ملاحظة المعلم: {note}', en: 'Teacher note: {note}' };
  const body = (lang: 'ar' | 'en'): string => [...lines(lang), total[lang], ...(spec.hasNote ? [note[lang]] : [])].join('\n');
  const recorded = spec.action === 'recorded';
  return {
    key: evaluationTemplateKey(spec),
    type: recorded ? 'EVALUATION_RECORDED' : 'EVALUATION_UPDATED',
    title: recorded ? { ar: 'تقييم جديد للطالب {student}', en: 'New evaluation for {student}' } : { ar: 'تحديث درجات الطالب {student}', en: 'Updated scores for {student}' },
    body: { ar: body('ar'), en: body('en') },
  };
}

/** Registers the template of this combination when it is not registered yet, and returns its key. */
export function ensureEvaluationTemplate(registry: NotificationTemplateRegistry, spec: EvaluationTemplateSpec): string {
  const key = evaluationTemplateKey(spec);
  if (!registry.has(key)) registry.register(buildEvaluationTemplate(spec));
  return key;
}

export function registerRuleTemplates(registry: NotificationTemplateRegistry): void {
  for (const template of RULE_TEMPLATES) if (!registry.has(template.key)) registry.register(template);
}
