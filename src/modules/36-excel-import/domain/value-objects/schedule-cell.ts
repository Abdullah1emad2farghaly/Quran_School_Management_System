import { DAYS_OF_WEEK, formatMinutes, parseMinutes, type DayOfWeek } from '../../../23-group-schedules/public';
import { foldWord, toLatinDigits } from './cell-text';

interface LocalizedPairLike {
  readonly ar: string;
  readonly en: string;
}

/** The Group Schedule cell (Master Specification §44/§75; the format is the one APPROVED for Module 36 on 2026-11-10). */
export interface ParsedScheduleSlot {
  readonly day: DayOfWeek;
  /** `HH:MM`, zero-padded (the representation Module 23 stores). */
  readonly startTime: string;
  readonly endTime: string;
  readonly startMinute: number;
  readonly endMinute: number;
}

export type ScheduleProblemCode =
  | 'EXCEL_IMPORT_SCHEDULE_FORMAT' // an entry is not `DAY HH:MM-HH:MM`
  | 'EXCEL_IMPORT_SCHEDULE_DAY' // an unknown weekday name
  | 'EXCEL_IMPORT_SCHEDULE_TIME' // not a real 24-hour time
  | 'EXCEL_IMPORT_SCHEDULE_RANGE' // the end is not after the start
  | 'EXCEL_IMPORT_SCHEDULE_DUPLICATE_DAY'; // two slots on one weekday (a group has at most one slot per weekday)

export interface ScheduleProblem {
  readonly code: ScheduleProblemCode;
  /** The offending entry as written (trimmed), so the message can quote it. */
  readonly entry: string;
}

export const DAY_LABELS: Readonly<Record<DayOfWeek, LocalizedPairLike>> = {
  SATURDAY: { ar: 'السبت', en: 'Saturday' },
  SUNDAY: { ar: 'الأحد', en: 'Sunday' },
  MONDAY: { ar: 'الاثنين', en: 'Monday' },
  TUESDAY: { ar: 'الثلاثاء', en: 'Tuesday' },
  WEDNESDAY: { ar: 'الأربعاء', en: 'Wednesday' },
  THURSDAY: { ar: 'الخميس', en: 'Thursday' },
  FRIDAY: { ar: 'الجمعة', en: 'Friday' },
};

const DAY_WORDS: Readonly<Record<DayOfWeek, readonly string[]>> = {
  SATURDAY: ['SAT', 'SATURDAY', 'السبت'],
  SUNDAY: ['SUN', 'SUNDAY', 'الأحد', 'الاحد'],
  MONDAY: ['MON', 'MONDAY', 'الاثنين', 'الإثنين', 'الأثنين', 'الاتنين'],
  TUESDAY: ['TUE', 'TUES', 'TUESDAY', 'الثلاثاء'],
  WEDNESDAY: ['WED', 'WEDS', 'WEDNESDAY', 'الأربعاء', 'الاربعاء'],
  THURSDAY: ['THU', 'THUR', 'THURS', 'THURSDAY', 'الخميس'],
  FRIDAY: ['FRI', 'FRIDAY', 'الجمعة'],
};

const DAY_INDEX: ReadonlyMap<string, DayOfWeek> = (() => {
  const map = new Map<string, DayOfWeek>();
  for (const day of DAYS_OF_WEEK) for (const w of DAY_WORDS[day]) map.set(foldWord(w), day);
  return map;
})();

/** Slots are separated by `;`, the Arabic semicolon `؛` or a line break. A comma is NOT a separator (it never separates two slots). */
const SEPARATORS = /[;\u061B\r\n]+/u;
const ENTRY = /^(\S+)\s+(\d{1,2}):(\d{2})\s*[-\u2010-\u2015\u2212]\s*(\d{1,2}):(\d{2})$/u;

const toHHMM = (hour: string, minute: string): string => `${hour.padStart(2, '0')}:${minute}`;

/**
 * Parses a Group Schedule cell. An empty cell is no schedule (`slots: []`, no problem). The result is the same whatever language the weekday
 * names are written in; nothing is guessed: every entry that is not exactly `DAY HH:MM-HH:MM` is a problem, and so are two slots on one weekday.
 */
export function parseScheduleCell(text: string): { slots: ParsedScheduleSlot[]; problems: ScheduleProblem[] } {
  const slots: ParsedScheduleSlot[] = [];
  const problems: ScheduleProblem[] = [];
  const entries = text
    .split(SEPARATORS)
    .map((e) => e.replace(/\s+/gu, ' ').trim())
    .filter((e) => e !== '');
  const seen = new Set<DayOfWeek>();
  for (const raw of entries) {
    const entry = toLatinDigits(raw);
    const match = ENTRY.exec(entry);
    if (!match) {
      problems.push({ code: 'EXCEL_IMPORT_SCHEDULE_FORMAT', entry: raw });
      continue;
    }
    const day = DAY_INDEX.get(foldWord(match[1]!));
    if (!day) {
      problems.push({ code: 'EXCEL_IMPORT_SCHEDULE_DAY', entry: raw });
      continue;
    }
    const startTime = toHHMM(match[2]!, match[3]!);
    const endTime = toHHMM(match[4]!, match[5]!);
    let startMinute: number;
    let endMinute: number;
    try {
      startMinute = parseMinutes(startTime);
      endMinute = parseMinutes(endTime);
    } catch {
      problems.push({ code: 'EXCEL_IMPORT_SCHEDULE_TIME', entry: raw });
      continue;
    }
    if (endMinute <= startMinute) {
      problems.push({ code: 'EXCEL_IMPORT_SCHEDULE_RANGE', entry: raw });
      continue;
    }
    if (seen.has(day)) {
      problems.push({ code: 'EXCEL_IMPORT_SCHEDULE_DUPLICATE_DAY', entry: raw });
      continue;
    }
    seen.add(day);
    slots.push({ day, startTime: formatMinutes(startMinute), endTime: formatMinutes(endMinute), startMinute, endMinute });
  }
  return { slots, problems };
}

/** The schedule in the importer's own language for the preview, e.g. `السبت 16:00-17:00؛ الاثنين 16:00-17:00` / `Saturday 16:00-17:00; Monday 16:00-17:00`. */
export function describeSlots(slots: readonly { day: DayOfWeek; startTime: string; endTime: string }[], language: 'ar' | 'en'): string {
  const ordered = [...slots].sort((a, b) => DAYS_OF_WEEK.indexOf(a.day) - DAYS_OF_WEEK.indexOf(b.day));
  return ordered.map((s) => `${DAY_LABELS[s.day][language]} ${s.startTime}-${s.endTime}`).join(language === 'ar' ? '؛ ' : '; ');
}
