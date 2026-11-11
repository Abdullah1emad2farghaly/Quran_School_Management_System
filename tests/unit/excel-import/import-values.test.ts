import { describe, expect, it } from 'vitest';
import { IMPORT_COLUMNS, parseLearningMode, parseProgression, parseScheduleCell, parseStartingSurah, recognizeHeader, recognizeHeaders, describeSlots, cellText, toLatinDigits } from '../../../src/modules/36-excel-import/public';

describe('the Excel columns (Master Specification §75)', () => {
  it('are the 12 approved columns in order, the first 11 required and the Group Schedule optional', () => {
    expect(IMPORT_COLUMNS.map((c) => c.key)).toEqual(['studentName', 'studentNationalId', 'parentName', 'parentPhone', 'parentAddress', 'groupName', 'teacherName', 'teacherPhone', 'learningMode', 'progression', 'startingSurah', 'groupSchedule']);
    expect(IMPORT_COLUMNS.filter((c) => !c.required).map((c) => c.key)).toEqual(['groupSchedule']);
  });

  it('every column has an Arabic and an English header, help and example', () => {
    for (const c of IMPORT_COLUMNS) {
      for (const text of [c.header.ar, c.header.en, c.help.ar, c.help.en, c.example.ar, c.example.en]) expect(text.trim(), c.key).not.toBe('');
      expect(c.header.ar).toMatch(/[\u0600-\u06FF]/u);
    }
  });

  it('are recognized by their Arabic and English headers, with or without the required mark, spacing and diacritics', () => {
    for (const c of IMPORT_COLUMNS) {
      expect(recognizeHeader(c.header.ar)).toBe(c.key);
      expect(recognizeHeader(`${c.header.ar} *`)).toBe(c.key);
      expect(recognizeHeader(`  ${c.header.en.toUpperCase()}*  `)).toBe(c.key);
      for (const alias of c.aliases) expect(recognizeHeader(alias)).toBe(c.key);
    }
    expect(recognizeHeader('اسم الطالب  الكامل')).toBe('studentName');
    expect(recognizeHeader('Something else')).toBeUndefined();
  });

  it('a header row may mix languages; missing, duplicated and unknown columns are reported', () => {
    const cells = [IMPORT_COLUMNS[0]!.header.ar, IMPORT_COLUMNS[1]!.header.en, IMPORT_COLUMNS[1]!.header.ar, 'Notes'];
    const r = recognizeHeaders(cells);
    expect(r.positions.get('studentName')).toBe(0);
    expect(r.positions.get('studentNationalId')).toBe(1);
    expect(r.duplicated).toEqual(['studentNationalId']);
    expect(r.unknown).toEqual([{ position: 3, text: 'Notes' }]);
    expect(r.missing).toContain('groupName');
    expect(r.missing).not.toContain('groupSchedule');
  });
});

describe('cell text', () => {
  it('converts Arabic-Indic digits, trims, collapses spaces and drops invisible marks', () => {
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩ ۰۱۲')).toBe('0123456789 012');
    expect(cellText('  عمر \u200F أحمد  ')).toBe('عمر أحمد');
    expect(cellText(30001010123456)).toBe('30001010123456');
    expect(cellText(null)).toBe('');
  });
});

describe('learning mode, progression and starting surah (Arabic and English)', () => {
  it('accepts the codes, the English words and the Arabic words', () => {
    for (const v of ['GROUP', 'group', 'جماعي', 'جماعية']) expect(parseLearningMode(v), v).toBe('GROUP');
    for (const v of ['INDIVIDUAL', 'Individual', 'فردي']) expect(parseLearningMode(v), v).toBe('INDIVIDUAL');
    for (const v of ['FORWARD', 'forward', 'للأمام', 'للامام']) expect(parseProgression(v), v).toBe('FORWARD');
    for (const v of ['BACKWARD', 'للخلف']) expect(parseProgression(v), v).toBe('BACKWARD');
    expect(parseLearningMode('أخرى')).toBeUndefined();
    expect(parseProgression('sideways')).toBeUndefined();
  });

  it('accepts a surah number from 1 to 114 in either digit system and nothing else', () => {
    expect(parseStartingSurah('78')).toBe(78);
    expect(parseStartingSurah('٧٨')).toBe(78);
    expect(parseStartingSurah('78.0')).toBe(78);
    for (const v of ['0', '115', '-1', '7.5', 'النبأ', '']) expect(parseStartingSurah(v), v).toBeUndefined();
  });
});

describe('the Group Schedule cell', () => {
  it('an empty cell is no schedule and no problem', () => {
    expect(parseScheduleCell('')).toEqual({ slots: [], problems: [] });
  });

  it('parses the approved English example', () => {
    const { slots, problems } = parseScheduleCell('SAT 16:00-17:00; MON 16:00-17:00');
    expect(problems).toEqual([]);
    expect(slots.map((s) => [s.day, s.startTime, s.endTime])).toEqual([['SATURDAY', '16:00', '17:00'], ['MONDAY', '16:00', '17:00']]);
  });

  it('parses the approved Arabic example (Arabic weekday names and the Arabic semicolon) to the same slots', () => {
    const arabic = parseScheduleCell('السبت 16:00-17:00؛ الاثنين 16:00-17:00');
    const english = parseScheduleCell('SAT 16:00-17:00; MON 16:00-17:00');
    expect(arabic.problems).toEqual([]);
    expect(arabic.slots).toEqual(english.slots);
  });

  it('accepts every weekday in Arabic and in English, full or short, any case, Arabic-Indic digits, spaces, dashes, line breaks and one-digit hours', () => {
    const days = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
    const codes = ['SATURDAY', 'SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
    days.forEach((d, i) => expect(parseScheduleCell(`${d} 16:00-17:00`).slots[0]?.day, d).toBe(codes[i]));
    for (const d of ['sat', 'Sunday', 'MON', 'tues', 'Wed', 'THU', 'friday']) expect(parseScheduleCell(`${d} 16:00-17:00`).problems, d).toEqual([]);
    expect(parseScheduleCell('الاحد ١٦:٠٠ - ١٧:٣٠').slots[0]).toMatchObject({ day: 'SUNDAY', startTime: '16:00', endTime: '17:30' });
    expect(parseScheduleCell('SAT 9:00–10:00\nMON 09:00—10:00').slots.map((s) => s.startTime)).toEqual(['09:00', '09:00']);
  });

  it('a group has at most one slot per weekday, even when the two time ranges do not overlap', () => {
    const { slots, problems } = parseScheduleCell('SAT 08:00-09:00; SAT 16:00-17:00');
    expect(slots).toHaveLength(1);
    expect(problems.map((p) => p.code)).toEqual(['EXCEL_IMPORT_SCHEDULE_DUPLICATE_DAY']);
    expect(parseScheduleCell('السبت 08:00-09:00؛ السبت 16:00-17:00').problems.map((p) => p.code)).toEqual(['EXCEL_IMPORT_SCHEDULE_DUPLICATE_DAY']);
  });

  it('reports an unknown weekday, a broken format, an impossible time and a reversed range, never guessing', () => {
    expect(parseScheduleCell('Funday 16:00-17:00').problems.map((p) => p.code)).toEqual(['EXCEL_IMPORT_SCHEDULE_DAY']);
    expect(parseScheduleCell('SAT 16:00').problems.map((p) => p.code)).toEqual(['EXCEL_IMPORT_SCHEDULE_FORMAT']);
    expect(parseScheduleCell('SAT, MON 16:00-17:00').problems.map((p) => p.code)).toEqual(['EXCEL_IMPORT_SCHEDULE_FORMAT']);
    expect(parseScheduleCell('SAT 25:00-26:00').problems.map((p) => p.code)).toEqual(['EXCEL_IMPORT_SCHEDULE_TIME']);
    expect(parseScheduleCell('SAT 17:00-16:00').problems.map((p) => p.code)).toEqual(['EXCEL_IMPORT_SCHEDULE_RANGE']);
    expect(parseScheduleCell('SAT 16:00-16:00').problems.map((p) => p.code)).toEqual(['EXCEL_IMPORT_SCHEDULE_RANGE']);
  });

  it('is written back clearly in both languages for the preview', () => {
    const { slots } = parseScheduleCell('MON 16:00-17:00; SAT 16:00-17:00');
    expect(describeSlots(slots, 'en')).toBe('Saturday 16:00-17:00; Monday 16:00-17:00');
    expect(describeSlots(slots, 'ar')).toBe('السبت 16:00-17:00؛ الاثنين 16:00-17:00');
  });
});
