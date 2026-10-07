import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/modules/00-shared-kernel/public';
import {
  MAX_EXCEL_FILE_BYTES,
  ZipFormatError,
  inspectZip,
  validateExcelFile,
} from '../../../src/modules/07-file-infrastructure/public';
import { buildXlsx, buildZip } from '../../helpers/zip-builder';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof AppError) return e.code;
    throw e;
  }
  return 'OK';
}
const validate = (name: string, data: Buffer, max?: number) => () => validateExcelFile({ originalName: name, data }, max);

describe('inspectZip', () => {
  it('lists entries, sizes and encryption flags', () => {
    const info = inspectZip(buildZip([{ name: 'a.txt', data: '12345' }, { name: 'b/c.txt', data: 'xy', encrypted: true }]));
    expect(info.entryNames).toEqual(['a.txt', 'b/c.txt']);
    expect(info.totalUncompressedBytes).toBe(7);
    expect(info.hasEncryptedEntries).toBe(true);
  });
  it('rejects garbage and truncated archives', () => {
    expect(() => inspectZip(Buffer.from('not a zip at all, just text'))).toThrow();
    const good = buildXlsx();
    let failed = false;
    try {
      inspectZip(good.subarray(0, good.length - 10));
    } catch (e) {
      failed = e instanceof ZipFormatError;
    }
    expect(failed).toBe(true);
  });
});

describe('validateExcelFile', () => {
  it('accepts a structurally valid .xlsx and reports sanitized metadata', () => {
    const data = buildXlsx();
    const v = validateExcelFile({ originalName: '..\\evil/الطلاب.XLSX', data });
    expect(v.originalName).toBe('الطلاب.XLSX');
    expect(v.extension).toBe('xlsx');
    expect(v.mimeType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(v.sizeBytes).toBe(data.length);
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('rejects empty and oversized files, honoring a lower configured limit', () => {
    expect(codeOf(validate('a.xlsx', Buffer.alloc(0)))).toBe('FILE_EMPTY');
    const data = buildXlsx();
    expect(codeOf(validate('a.xlsx', data, data.length - 1))).toBe('FILE_TOO_LARGE');
    expect(codeOf(validate('a.xlsx', Buffer.alloc(MAX_EXCEL_FILE_BYTES + 1, 1), MAX_EXCEL_FILE_BYTES * 5))).toBe('FILE_TOO_LARGE');
    expect(codeOf(validate('a.xlsx', data, MAX_EXCEL_FILE_BYTES * 5))).toBe('OK');
  });
  it('allows .xlsx only', () => {
    const data = buildXlsx();
    for (const name of ['a.xls', 'a.xlsm', 'a.csv', 'a.pdf', 'a.xlsx.exe', 'noext', 'a.xlsx.']) {
      expect(codeOf(validate(name, data))).toBe('FILE_TYPE_NOT_ALLOWED');
    }
    expect(codeOf(validate('report.exe.xlsx', data))).toBe('OK');
  });
  it('rejects content that is not a zip, even with an .xlsx name', () => {
    expect(codeOf(validate('a.xlsx', Buffer.from('MZ\u0090\u0000 executable')))).toBe('FILE_CORRUPT');
    expect(codeOf(validate('a.xlsx', Buffer.from('plain text file content')))).toBe('FILE_CORRUPT');
  });
  it('rejects zips that are not workbooks', () => {
    expect(codeOf(validate('a.xlsx', buildZip([{ name: 'readme.txt', data: 'hi' }])))).toBe('FILE_CORRUPT');
    expect(codeOf(validate('a.xlsx', buildZip([{ name: '[Content_Types].xml' }])))).toBe('FILE_CORRUPT');
  });
  it('rejects macros, embedded objects, encryption, path tricks and zip bombs', () => {
    const unsafe = [
      { name: 'xl/vbaProject.bin', data: 'x' },
      { name: 'xl/embeddings/oleObject1.bin', data: 'x' },
      { name: 'xl/activeX/activeX1.xml', data: 'x' },
      { name: '../../evil.txt', data: 'x' },
      { name: '/etc/passwd', data: 'x' },
      { name: 'dir\\evil.txt', data: 'x' },
      { name: 'xl/tool.exe', data: 'x' },
      { name: 'xl/secret.xml', data: 'x', encrypted: true },
      { name: 'xl/bomb.xml', data: 'x', declaredSize: 300 * 1024 * 1024 },
    ];
    for (const entry of unsafe) {
      expect(codeOf(validate('a.xlsx', buildXlsx([entry])))).toBe('FILE_UNSAFE_CONTENT');
    }
  });
  it('rejects archives with too many entries', () => {
    const many = Array.from({ length: 5001 }, (_, i) => ({ name: `xl/media/f${i}.xml` }));
    expect(codeOf(validate('a.xlsx', buildXlsx(many)))).toBe('FILE_UNSAFE_CONTENT');
  });
  it('reports the limit in MB for the localized message', () => {
    try {
      validateExcelFile({ originalName: 'a.xlsx', data: Buffer.alloc(11 * 1024 * 1024, 1) });
    } catch (e) {
      expect((e as AppError).params).toEqual({ maxMb: 10 });
    }
  });
});
