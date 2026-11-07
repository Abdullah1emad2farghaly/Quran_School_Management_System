import { beforeEach, describe, expect, it } from 'vitest';
import { interpolate } from '../../../src/modules/03-error-localization/public';
import { MemorizationEventTypes } from '../../../src/modules/27-memorization/public';
import { RevisionEventTypes } from '../../../src/modules/28-revision/public';
import { describeRange, RULE_TEMPLATES, type RangeSnapshot } from '../../../src/modules/32-notification-rules/public';
import { assignmentDetailTemplateKey } from '../../../src/modules/32-notification-rules/application/services/rule-templates';
import { createRulesHarness, ids, type RulesHarness } from '../../helpers/notification-rules-harness';

const ASSIGNMENT = '00000000-0000-4000-8000-0000000000aa';
const REVISION_ASSIGNMENT = '00000000-0000-4000-8000-0000000000ab';

let w: RulesHarness;
beforeEach(() => {
  w = createRulesHarness();
  // surah 2 ayah 5 sits on page 2 / quarter 2; surah 2 ayah 10 on page 3 (it continues to page 4) / quarter 3; surah 3 ayah 1 on page 50 / quarter 14.
  w.quran.locations.set('2:5', { firstPage: 2, lastPage: 2, quarter: 2 });
  w.quran.locations.set('2:10', { firstPage: 3, lastPage: 4, quarter: 3 });
  w.quran.locations.set('1:1', { firstPage: 1, lastPage: 1, quarter: 1 });
  w.quran.locations.set('3:1', { firstPage: 50, lastPage: 50, quarter: 14 });
});

const payload = (studentId: string | null, assignmentId = ASSIGNMENT) => ({ assignmentId, groupId: ids.group1, schoolId: ids.school, studentId, definedInSessionId: ids.session });
const range = (over: Partial<RangeSnapshot>): RangeSnapshot => ({ unit: 'AYAHS', amount: 6, first: { surah: 2, ayah: 5 }, last: { surah: 2, ayah: 10 }, ayahCount: 6, ...over });
const bodyOfParentB = () => w.notificationsOf(ids.parentB)[0]?.body ?? '';

describe('describeRange (by the unit the assignment was defined in)', () => {
  it('AYAHS: the surah and ayah range, naming the surah once when it is the same', async () => {
    const d = await describeRange(range({}), w.quran);
    expect(d.shape).toBe('AYAHS');
    expect(d.params.span).toBe('البقرة 2:5 → 2:10');
    expect(d.params.ayahCount).toBe(6);
  });
  it('AYAHS across surahs names both surahs', async () => {
    const d = await describeRange(range({ first: { surah: 1, ayah: 6 }, last: { surah: 2, ayah: 5 }, ayahCount: 6 }), w.quran);
    expect(d.params.span).toBe('الفاتحة 1:6 → البقرة 2:5');
  });
  it('SURAHS: the surah range with BOTH endpoints and the count', async () => {
    const d = await describeRange(range({ unit: 'SURAHS', amount: 2, first: { surah: 1, ayah: 1 }, last: { surah: 2, ayah: 286 }, ayahCount: 293 }), w.quran);
    expect(d.shape).toBe('SURAHS');
    expect(d.params.surahs).toBe('الفاتحة (1) → البقرة (2)');
    expect(d.params.surahCount).toBe(2);
    const one = await describeRange(range({ unit: 'SURAHS', amount: 1, first: { surah: 2, ayah: 1 }, last: { surah: 2, ayah: 286 } }), w.quran);
    expect(one.params.surahs).toBe('البقرة (2)');
    expect(one.params.surahCount).toBe(1);
  });
  it('PAGES: the Mushaf page range from the first ayah’s first page to the last ayah’s last page', async () => {
    const d = await describeRange(range({ unit: 'PAGES', amount: 3 }), w.quran);
    expect(d.shape).toBe('PAGES');
    expect(d.params.pages).toBe('2–4');
    expect(d.params.span).toBe('البقرة 2:5 → 2:10');
  });
  it('QUARTERS: the quarter range', async () => {
    const d = await describeRange(range({ unit: 'QUARTERS', amount: 2 }), w.quran);
    expect(d.shape).toBe('QUARTERS');
    expect(d.params.quarters).toBe('2–3');
  });
  it('LINES: the number of lines and the pages', async () => {
    const d = await describeRange(range({ unit: 'LINES', amount: 12 }), w.quran);
    expect(d.shape).toBe('LINES');
    expect(d.params.lines).toBe(12);
    expect(d.params.pages).toBe('2–4');
  });
  it('a single page / quarter is written as one number', async () => {
    w.quran.locations.set('2:10', { firstPage: 2, lastPage: 2, quarter: 2 });
    expect((await describeRange(range({ unit: 'PAGES' }), w.quran)).params.pages).toBe('2');
    expect((await describeRange(range({ unit: 'QUARTERS' }), w.quran)).params.quarters).toBe('2');
  });
  it('falls back to the exact ayah range (never a guess) when the page / quarter data is missing', async () => {
    const d = await describeRange(range({ unit: 'PAGES', first: { surah: 9, ayah: 9 }, last: { surah: 9, ayah: 20 } }), w.quran);
    expect(d.shape).toBe('AYAHS');
  });
  it('every detailed template can be filled completely from the parameters of its shape (no placeholder left)', async () => {
    const shapes = [range({}), range({ unit: 'SURAHS' }), range({ unit: 'PAGES' }), range({ unit: 'QUARTERS' }), range({ unit: 'LINES', amount: 5 })];
    for (const r of shapes) {
      const d = await describeRange(r, w.quran);
      for (const kind of ['memorization', 'revision'] as const) {
        for (const action of ['defined', 'modified', 'cancelled'] as const) {
          const template = RULE_TEMPLATES.find((t) => t.key === assignmentDetailTemplateKey(kind, action, d.shape));
          expect(template).toBeDefined();
          for (const lang of ['ar', 'en'] as const) {
            const text = interpolate(template!.body[lang], { student: 'Ali', group: 'Fajr', ...d.params });
            expect(/\{[A-Za-z_]+\}/.test(text)).toBe(false);
          }
        }
      }
    }
  });
});

describe('assignment notifications carry the actual range', () => {
  it('AYAHS: surah and ayah range in the parent’s notification (new assignment)', async () => {
    w.assignments.map.set(`memorization|${ASSIGNMENT}`, range({}));
    await w.deliver(MemorizationEventTypes.ASSIGNMENT_DEFINED, payload(ids.studentB));
    expect(bodyOfParentB()).toContain('Bilal Badr');
    expect(bodyOfParentB()).toContain('Fajr');
    expect(bodyOfParentB()).toContain('Ayahs: البقرة 2:5 → 2:10 (6 ayahs)');
    expect(w.allNotifications()).toHaveLength(1);
  });
  it('modifying an assignment also notifies, with the CURRENT range', async () => {
    w.assignments.map.set(`memorization|${ASSIGNMENT}`, range({ first: { surah: 2, ayah: 11 }, last: { surah: 2, ayah: 20 }, ayahCount: 10 }));
    await w.deliver(MemorizationEventTypes.ASSIGNMENT_MODIFIED, payload(ids.studentB));
    expect(w.notificationsOf(ids.parentB)[0]?.type).toBe('MEMORIZATION_ASSIGNMENT_MODIFIED');
    expect(bodyOfParentB()).toContain('2:11 → 2:20');
    expect(bodyOfParentB()).toContain('(10 ayahs)');
  });
  it('SURAHS: both endpoints', async () => {
    w.assignments.map.set(`memorization|${ASSIGNMENT}`, range({ unit: 'SURAHS', amount: 2, first: { surah: 1, ayah: 1 }, last: { surah: 2, ayah: 286 }, ayahCount: 293 }));
    await w.deliver(MemorizationEventTypes.ASSIGNMENT_DEFINED, payload(ids.studentB));
    expect(bodyOfParentB()).toContain('Surahs: الفاتحة (1) → البقرة (2) (2, both endpoints included)');
  });
  it('PAGES: the Mushaf page range', async () => {
    w.assignments.map.set(`memorization|${ASSIGNMENT}`, range({ unit: 'PAGES', amount: 3 }));
    await w.deliver(MemorizationEventTypes.ASSIGNMENT_DEFINED, payload(ids.studentB));
    expect(bodyOfParentB()).toContain('Mushaf pages: 2–4');
  });
  it('QUARTERS: the quarter range', async () => {
    w.assignments.map.set(`memorization|${ASSIGNMENT}`, range({ unit: 'QUARTERS', amount: 2 }));
    await w.deliver(MemorizationEventTypes.ASSIGNMENT_DEFINED, payload(ids.studentB));
    expect(bodyOfParentB()).toContain('Quarters: 2–3');
  });
  it('a revision assignment is read from the revision side and labelled as revision', async () => {
    w.assignments.map.set(`revision|${REVISION_ASSIGNMENT}`, range({ unit: 'PAGES', amount: 3 }));
    w.assignments.map.set(`memorization|${REVISION_ASSIGNMENT}`, range({ first: { surah: 3, ayah: 1 }, last: { surah: 3, ayah: 5 } })); // must NOT be used
    await w.deliver(RevisionEventTypes.ASSIGNMENT_MODIFIED, payload(ids.studentB, REVISION_ASSIGNMENT));
    expect(w.notificationsOf(ids.parentB)[0]?.type).toBe('REVISION_ASSIGNMENT_MODIFIED');
    expect(bodyOfParentB()).toContain('revision');
    expect(bodyOfParentB()).toContain('Mushaf pages: 2–4');
  });
  it('a cancelled assignment says which range was cancelled', async () => {
    w.assignments.map.set(`memorization|${ASSIGNMENT}`, range({}));
    await w.deliver(MemorizationEventTypes.ASSIGNMENT_CANCELLED, payload(ids.studentB));
    expect(bodyOfParentB()).toContain('cancelled');
    expect(bodyOfParentB()).toContain('2:5 → 2:10');
  });
  it('a shared GROUP assignment carries the same range to every parent, each only about their own child', async () => {
    w.assignments.map.set(`memorization|${ASSIGNMENT}`, range({ unit: 'PAGES' }));
    await w.deliver(MemorizationEventTypes.ASSIGNMENT_DEFINED, payload(null));
    expect(w.notificationsOf(ids.parentA)).toHaveLength(2);
    expect(w.notificationsOf(ids.parentA).every((n) => n.body.includes('Mushaf pages: 2–4'))).toBe(true);
    expect(bodyOfParentB()).toContain('Bilal Badr');
    expect(bodyOfParentB()).not.toContain('Ali');
  });
  it('is Arabic by default: the labels and the range are in Arabic', async () => {
    const ar = createRulesHarness({ language: 'default' });
    ar.assignments.map.set(`memorization|${ASSIGNMENT}`, range({}));
    await ar.deliver(MemorizationEventTypes.ASSIGNMENT_DEFINED, payload(ids.studentB));
    const body = ar.notificationsOf(ids.parentB)[0]?.body ?? '';
    expect(body).toContain('الآيات: البقرة 2:5 → 2:10 (6 آية)');
  });
  it('sends the plain notification (student and group) when the assignment can no longer be found', async () => {
    await w.deliver(MemorizationEventTypes.ASSIGNMENT_DEFINED, payload(ids.studentB));
    expect(bodyOfParentB()).toContain('Bilal Badr');
    expect(bodyOfParentB()).not.toContain('Ayahs');
  });
  it('a technical failure reading the assignment propagates, so the outbox retries and nothing is lost or sent half-done', async () => {
    w.assignments.failing = true;
    let failed = false;
    const event = w.makeEvent(MemorizationEventTypes.ASSIGNMENT_DEFINED, payload(ids.studentB));
    try {
      await w.redeliver(event);
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(w.allNotifications()).toHaveLength(0);
    w.assignments.failing = false;
    w.assignments.map.set(`memorization|${ASSIGNMENT}`, range({}));
    await w.redeliver(event);
    await w.redeliver(event);
    expect(w.allNotifications()).toHaveLength(1);
  });
  it('the Teacher who changed the assignment is still not notified', async () => {
    w.assignments.map.set(`memorization|${ASSIGNMENT}`, range({}));
    await w.deliver(MemorizationEventTypes.ASSIGNMENT_MODIFIED, { ...payload(ids.studentA), actorUserId: ids.teacherUser1 });
    expect(w.notificationsOf(ids.teacherUser1)).toHaveLength(0);
  });
});
