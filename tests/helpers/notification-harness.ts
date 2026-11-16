import type { TransactionContext, UnitOfWork } from '../../src/modules/00-shared-kernel/public';
import {
  InMemoryNotificationRepository,
  NotificationService,
  NotificationTemplateRegistry,
  PushDeliveryProcessor,
  PushSubscriptionService,
  noAccountLanguage,
  type AccountLanguageResolver,
  type PushSendOutcome,
  type PushSender,
  type PushTarget,
} from '../../src/modules/31-notifications-core/public';

const tx = {} as TransactionContext;
export const VAPID_PUBLIC_KEY = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
export const P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
export const AUTH = 'tBHItJI5svbpez7KI4CCXg';

/** A push sender whose outcome per endpoint the test controls; it records what was sent. */
export class FakePushSender implements PushSender {
  readonly sent: Array<{ target: PushTarget; payload: string }> = [];
  outcome: (target: PushTarget) => PushSendOutcome | Promise<PushSendOutcome> = () => ({ kind: 'sent' });
  throwError = false;
  async send(target: PushTarget, payload: string): Promise<PushSendOutcome> {
    this.sent.push({ target, payload });
    if (this.throwError) throw new Error(`boom for ${target.endpoint}`);
    return this.outcome(target);
  }
}

export const EXAM_TEMPLATE = {
  key: 'test.exam-result',
  type: 'EXAM_RESULT_RECORDED',
  title: { ar: 'نتيجة اختبار {student}', en: 'Exam result for {student}' },
  body: { ar: 'حصل {student} على {score} من {max}.', en: '{student} scored {score} out of {max}.' },
} as const;

export function createNotificationHarness(options: { pushEnabled?: boolean; language?: AccountLanguageResolver } = {}) {
  let current = new Date('2026-11-05T09:00:00Z');
  const clock = { now: () => current };
  const advance = (ms: number) => {
    current = new Date(current.getTime() + ms);
  };
  const repository = new InMemoryNotificationRepository();
  const unitOfWork: UnitOfWork = { run: (work) => work(tx) };
  const templates = new NotificationTemplateRegistry();
  templates.register(EXAM_TEMPLATE);
  const pushEnabled = options.pushEnabled ?? true;
  const language: { resolver: AccountLanguageResolver } = { resolver: options.language ?? noAccountLanguage };
  const service = new NotificationService({ repository, unitOfWork, clock, templates, language: { languageOf: (id) => language.resolver.languageOf(id) }, pushEnabled });
  const push = new PushSubscriptionService({ repository, unitOfWork, clock, pushEnabled, vapidPublicKey: pushEnabled ? VAPID_PUBLIC_KEY : '' });
  const sender = new FakePushSender();
  const processor = new PushDeliveryProcessor({ repository, sender, unitOfWork, clock });

  let n = 0;
  const examInput = (recipientUserIds: string[], dedupKey = `evt-${(n += 1)}`) => ({
    recipientUserIds,
    templateKey: EXAM_TEMPLATE.key,
    params: { student: 'Ali', score: 18, max: 20 },
    data: { examId: 'exam-1' },
    dedupKey,
  });
  const endpoint = (name: string) => `https://push.example.com/send/${name}`;
  const subscribe = (userId: string, sessionId: string, name: string) => push.subscribe(userId, sessionId, { endpoint: endpoint(name), p256dh: P256DH, auth: AUTH });
  return { clock, advance, repository, unitOfWork, templates, language, service, push, sender, processor, tx, examInput, endpoint, subscribe };
}
