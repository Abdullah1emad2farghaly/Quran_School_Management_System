import { describe, expect, it } from 'vitest';
import { NotificationTemplateRegistry } from '../../../src/modules/31-notifications-core/public';
import { RULE_TEMPLATES, registerRuleTemplates } from '../../../src/modules/32-notification-rules/public';
import { dedupKeys } from '../../../src/modules/32-notification-rules/domain/value-objects/dedup-keys';
import { cleanText, formatAyahRange, formatCairoDateTime, formatScore, parseInstant, sumScores } from '../../../src/modules/32-notification-rules/domain/value-objects/message-format';
import { EVALUATION_WARNING_LEAD_MS, EXAM_REMINDER_LEAD_MS, evaluationWarningDueAt, examReminderDueAt, halfSessionDueAt, reminderRetryDelayMs, sessionPhaseOf } from '../../../src/modules/32-notification-rules/domain/value-objects/reminder-rules';
import { buildEvaluationTemplate, ensureEvaluationTemplate, evaluationTemplateKey } from '../../../src/modules/32-notification-rules/application/services/rule-templates';

describe('formatting', () => {
  it('writes instants in Africa/Cairo as YYYY-MM-DD HH:mm (UTC+2 in winter, UTC+3 in summer)', () => {
    expect(formatCairoDateTime(new Date('2026-11-10T15:30:00Z'))).toBe('2026-11-10 17:30');
    expect(formatCairoDateTime('2026-07-10T15:30:00Z')).toBe('2026-07-10 18:30');
    expect(formatCairoDateTime(null)).toBe('—');
    expect(formatCairoDateTime('not a date')).toBe('—');
  });
  it('formats and sums scores exactly (hundredths, no floating-point noise)', () => {
    expect(formatScore(9)).toBe('9');
    expect(formatScore(8.5)).toBe('8.5');
    expect(formatScore(7.25)).toBe('7.25');
    expect(sumScores([0.1, 0.2, 0.3])).toBe(0.6);
    expect(formatScore(sumScores([8.55, 9.1]))).toBe('17.65');
  });
  it('formats a Quran range language-neutrally and cleans free text', () => {
    expect(formatAyahRange({ surah: 2, ayah: 5 }, { surah: 2, ayah: 10 })).toBe('2:5 → 2:10');
    expect(cleanText('   ', 10)).toBe('—');
    expect(cleanText(null, 10)).toBe('—');
    expect(cleanText('abcdefghijkl', 5)).toBe('abcd…');
    expect(parseInstant('2026-11-10T15:30:00Z')?.toISOString()).toBe('2026-11-10T15:30:00.000Z');
    expect(parseInstant(42)).toBeUndefined();
  });
});

describe('reminder timing', () => {
  const start = new Date('2026-11-10T10:00:00Z');
  const end = new Date('2026-11-10T11:00:00Z');
  it('an exam reminder is due exactly 24 hours before the start', () => {
    expect(examReminderDueAt(start).getTime()).toBe(start.getTime() - EXAM_REMINDER_LEAD_MS);
  });
  it('the half-session reminder is due half the scheduled duration after the start', () => {
    expect(halfSessionDueAt(start, end).toISOString()).toBe('2026-11-10T10:30:00.000Z');
  });
  it('the evaluation warning is due exactly 15 minutes before the scheduled end', () => {
    expect(evaluationWarningDueAt(end).getTime()).toBe(end.getTime() - EVALUATION_WARNING_LEAD_MS);
    expect(evaluationWarningDueAt(end).toISOString()).toBe('2026-11-10T10:45:00.000Z');
  });
  it('the retry delay doubles', () => {
    expect([1, 2, 3, 4].map(reminderRetryDelayMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
  });
  it('only IN_PROGRESS is in progress', () => {
    expect(sessionPhaseOf('IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(sessionPhaseOf('SCHEDULED')).toBe('NOT_STARTED');
    expect(sessionPhaseOf('OPEN')).toBe('NOT_STARTED');
    expect(sessionPhaseOf('COMPLETED')).toBe('OVER');
    expect(sessionPhaseOf('CANCELLED')).toBe('OVER');
    expect(sessionPhaseOf('SOMETHING_ELSE')).toBe('OVER');
  });
});

describe('templates', () => {
  it('every fixed template has an Arabic AND an English title and body, and registers without error', () => {
    const registry = new NotificationTemplateRegistry();
    registerRuleTemplates(registry);
    for (const t of RULE_TEMPLATES) {
      expect(t.title.ar.trim().length).toBeGreaterThan(0);
      expect(t.title.en.trim().length).toBeGreaterThan(0);
      expect(t.body.ar.trim().length).toBeGreaterThan(0);
      expect(t.body.en.trim().length).toBeGreaterThan(0);
      expect(registry.has(t.key)).toBe(true);
    }
    expect(new Set(RULE_TEMPLATES.map((t) => t.key)).size).toBe(RULE_TEMPLATES.length);
  });
  it('registering twice is harmless', () => {
    const registry = new NotificationTemplateRegistry();
    registerRuleTemplates(registry);
    registerRuleTemplates(registry);
    expect(registry.has('school.request-approved')).toBe(true);
  });
  it('an evaluation template lists only the evaluated categories and has a note line ONLY when there is a note', () => {
    const withNote = buildEvaluationTemplate({ action: 'recorded', categories: ['MEMORIZATION', 'TAJWEED'], hasNote: true });
    const withoutNote = buildEvaluationTemplate({ action: 'recorded', categories: ['MEMORIZATION', 'TAJWEED'], hasNote: false });
    expect(withNote.body.en).toContain('{score_MEMORIZATION}');
    expect(withNote.body.en).toContain('{score_TAJWEED}');
    expect(withNote.body.en).not.toContain('score_REVISION');
    expect(withNote.body.en).toContain('{note}');
    expect(withNote.body.ar).toContain('{note}');
    expect(withoutNote.body.en).not.toContain('{note}');
    expect(withoutNote.body.ar).not.toContain('{note}');
    expect(withoutNote.body.en).toContain('{total}');
    expect(evaluationTemplateKey({ action: 'updated', categories: ['REVISION'], hasNote: false })).toBe('evaluation.updated.revision');
  });
  it('an evaluation template is registered once, on first use', () => {
    const registry = new NotificationTemplateRegistry();
    const spec = { action: 'recorded', categories: ['PERFORMANCE'], hasNote: false } as const;
    const key = ensureEvaluationTemplate(registry, spec);
    expect(registry.has(key)).toBe(true);
    expect(ensureEvaluationTemplate(registry, spec)).toBe(key);
  });
});

describe('once-only keys', () => {
  it('are built from ids only and stay far below the 191 character limit', () => {
    const uuid = '00000000-0000-4000-8000-000000000031';
    const keys = [
      dedupKeys.schoolRequest(uuid),
      dedupKeys.groupChange(uuid, 'parent'),
      dedupKeys.assignmentChange(uuid, uuid),
      dedupKeys.examEventExaminer(uuid, uuid),
      dedupKeys.examReminderExaminer(uuid, Date.now(), uuid),
      dedupKeys.sessionEvaluationWarning(uuid),
    ];
    for (const k of keys) expect(k.length).toBeLessThan(191);
  });
  it('an exam reminder key is bound to the start time', () => {
    expect(dedupKeys.examReminderStudent('e', 1000, 's')).not.toBe(dedupKeys.examReminderStudent('e', 2000, 's'));
  });
});
