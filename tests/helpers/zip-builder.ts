/** Builds minimal ZIP archives (stored, no compression) for tests. Not for production use. */
export interface ZipTestEntry {
  name: string;
  data?: Buffer | string;
  encrypted?: boolean;
  /** Override the declared uncompressed size (to simulate a zip bomb). */
  declaredSize?: number;
}

export function buildZip(entries: ZipTestEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '', 'utf8');
    const flags = e.encrypted ? 1 : 0;
    const declared = e.declaredSize ?? data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

const BASE_ENTRIES: ZipTestEntry[] = [
  { name: '[Content_Types].xml', data: '<Types/>' },
  { name: 'xl/workbook.xml', data: '<workbook/>' },
  { name: 'xl/worksheets/sheet1.xml', data: '<worksheet/>' },
];

/** A structurally valid minimal .xlsx (plus optional extra entries). */
export function buildXlsx(extra: ZipTestEntry[] = [], base: ZipTestEntry[] = BASE_ENTRIES): Buffer {
  return buildZip([...base, ...extra]);
}
