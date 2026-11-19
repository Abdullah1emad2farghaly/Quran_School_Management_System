import { InMemoryPaymentRepository, PaymentService, registerPaymentAuthorization } from '../../src/modules/34-payments-collection/public';
import { createSubscriptionsHarness } from './subscriptions-harness';

/**
 * In-memory wiring of everything the Subscriptions harness has (real sessions, real Authorization Engine, real Parent/Teacher/Student/Subscription/Collector services) plus Module 34.
 * The payment store is rolled back together with everything else when a unit of work throws, so the atomicity of "payment + subscription status" is really tested.
 */
export async function createPaymentsHarness() {
  const paymentRepo = new InMemoryPaymentRepository();
  const s = await createSubscriptionsHarness({ extraStores: [paymentRepo] });
  const payments = new PaymentService({ payments: paymentRepo, subscriptions: s.paymentTransitions, unitOfWork: s.unitOfWork, outbox: s.h.outbox, clock: s.clock });
  registerPaymentAuthorization({ policies: s.policies, resolvers: s.resolvers, payments, collectors: s.collectors, schools: s.service });
  const paymentEvents = (type?: string) => s.h.store.messages.filter((m) => m.aggregateType === 'Payment').filter((m) => !type || m.eventType === type);

  /** A school with a manager, `count` ACTIVE students, and the CURRENT month's subscriptions created. Returns the subscription of each student. */
  const newSchoolWithSubscriptions = async (count = 1) => {
    const school = await s.newSchool();
    const manager = await s.newSchoolManager(school.id);
    const students = [];
    for (let i = 0; i < count; i += 1) students.push(await s.newStudent(school.id, manager.id));
    await s.subscriptions.createMonthlySubscriptions(school.id, manager.id);
    const subs = await Promise.all(students.map(async (st) => (await s.subscriptionRepo.findByStudentMonth(st.id, '2026-11'))!.snapshot));
    return { school, manager, students, subs };
  };
  return { ...s, paymentRepo, payments, paymentEvents, newSchoolWithSubscriptions };
}
