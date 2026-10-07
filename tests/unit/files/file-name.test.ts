import { describe, expect, it } from 'vitest';
import { extensionOf, sanitizeFileName } from '../../../src/modules/07-file-infrastructure/public';

describe('sanitizeFileName', () => {
  it('drops directory parts and path traversal', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\x\\students.xlsx')).toBe('students.xlsx');
    expect(sanitizeFileName('/abs/path/file.xlsx')).toBe('file.xlsx');
  });
  it('removes control and reserved characters, hidden-file dots and extra spaces', () => {
    expect(sanitizeFileName('a\u0000b\nc.xlsx')).toBe('abc.xlsx');
    expect(sanitizeFileName('we<ir>d:na"me|?*.xlsx')).toBe('we_ir_d_na_me___.xlsx');
    expect(sanitizeFileName('...hidden.xlsx')).toBe('hidden.xlsx');
    expect(sanitizeFileName('  a   b .xlsx')).toBe('a b .xlsx');
  });
  it('keeps Arabic names', () => {
    expect(sanitizeFileName('الطلاب.xlsx')).toBe('الطلاب.xlsx');
  });
  it('falls back for empty names and caps the length while keeping the extension', () => {
    expect(sanitizeFileName('', 'file.xlsx')).toBe('file.xlsx');
    expect(sanitizeFileName('///')).toBe('file');
    const long = sanitizeFileName(`${'a'.repeat(400)}.xlsx`);
    expect(long.length).toBe(255);
    expect(long.endsWith('.xlsx')).toBe(true);
  });
});

describe('extensionOf', () => {
  it('returns the lower-case final extension', () => {
    expect(extensionOf('a.XLSX')).toBe('xlsx');
    expect(extensionOf('report.exe.xlsx')).toBe('xlsx');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('trailingdot.')).toBe('');
    expect(extensionOf('.xlsx')).toBe('');
  });
});
