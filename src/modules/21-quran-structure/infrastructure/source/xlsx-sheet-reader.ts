import { readZip } from './zip-reader';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string): string =>
  s.replace(/&(?:#(\d+)|#x([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (_m, dec: string | undefined, hex: string | undefined, name: string | undefined) =>
    name ? ENTITIES[name]! : String.fromCodePoint(dec ? Number(dec) : parseInt(hex!, 16)),
  );
const textOf = (xml: string): string => [...xml.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)].map((m) => decode(m[1]!)).join('');
const columnIndex = (letters: string): number => [...letters].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

/**
 * Reads the first worksheet of an .xlsx workbook (a ZIP of XML parts) into rows of cell strings, exactly as stored: shared strings, inline strings and
 * raw numbers; an absent cell is ''. Dependency-free; the workbook is only read. Used to read the official KFGQPC Excel file so that its values (the
 * juz of every ayah) are compared directly with the CSV/JSON and used as stated.
 */
export function readXlsxFirstSheet(xlsx: Buffer): string[][] {
  const parts = readZip(xlsx);
  const part = (name: string): string | undefined => parts.find((p) => p.name === name)?.data.toString('utf8');
  const sheet = part('xl/worksheets/sheet1.xml');
  if (sheet === undefined) throw new Error('The workbook has no first worksheet (xl/worksheets/sheet1.xml).');
  const sharedXml = part('xl/sharedStrings.xml');
  const shared = sharedXml === undefined ? [] : [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!));
  const rows: string[][] = [];
  for (const row of sheet.matchAll(/<row\s[^>]*?r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cell of row[2]!.matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1]!;
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (ref === undefined) continue;
      const inner = cell[2] ?? '';
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      let value = '';
      if (type === 'inlineStr') value = textOf(inner);
      else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v !== undefined) value = type === 's' ? (shared[Number(v)] ?? '') : decode(v);
      }
      cells[columnIndex(ref)] = value;
    }
    rows[Number(row[1]) - 1] = Array.from(cells, (c) => c ?? '');
  }
  return Array.from(rows, (r) => r ?? []);
}
