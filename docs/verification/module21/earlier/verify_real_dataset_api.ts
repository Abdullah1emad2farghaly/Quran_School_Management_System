/**
 * Evidence script (read-only, no database): imports the converted OFFICIAL dataset into the in-memory repository through the real use case with the
 * REAL edition profile, then checks that what the Module 21 service returns for every endpoint conforms to the OpenAPI schemas of the contract.
 * Run from the project root:  tsx verify_real_dataset_api.ts /path/to/converted-dataset.json
 */
import { readFileSync } from 'node:fs';
import { registerAllErrorMessages } from '/home/claude/qsms/src/app/bootstrap/register-error-messages';
import { FixedClock } from '/home/claude/qsms/src/modules/00-shared-kernel/public';
import { defaultMessageCatalog } from '/home/claude/qsms/src/modules/03-error-localization/public';
import { buildOpenApiDocument } from '/home/claude/qsms/src/modules/04-validation-api/public';
import { ImportQuranDataset, InMemoryQuranStructureRepository, QuranStructureService, quranApiDoc } from '/home/claude/qsms/src/modules/21-quran-structure/public';

registerAllErrorMessages();
const doc: any = buildOpenApiDocument({ modules: [quranApiDoc], basePath: '/api/v1', title: 't', version: 't', messages: defaultMessageCatalog });
const schemas = doc.components.schemas;
const problems: string[] = [];
function check(schema: any, value: any, where: string): void {
  if (value === null) { if (!schema.nullable) problems.push(`${where}: null not allowed`); return; } // OpenAPI 3.0: nullable applies at the level it is declared
  if (schema.$ref) return check(schemas[schema.$ref.split('/').pop()!], value, where);
  if (schema.allOf) return schema.allOf.forEach((s: any) => check(s, value, where));
  const t = schema.type;
  if (t === 'integer' && !(Number.isInteger(value))) problems.push(`${where}: not an integer`);
  else if (t === 'string' && typeof value !== 'string') problems.push(`${where}: not a string`);
  else if (t === 'boolean' && typeof value !== 'boolean') problems.push(`${where}: not a boolean`);
  else if (t === 'array') { if (!Array.isArray(value)) problems.push(`${where}: not an array`); else value.forEach((v, i) => check(schema.items, v, `${where}[${i}]`)); }
  else if (t === 'object') {
    for (const r of schema.required ?? []) if (!(r in value)) problems.push(`${where}: missing "${r}"`);
    for (const k of Object.keys(value)) { if (!schema.properties?.[k]) problems.push(`${where}: undocumented "${k}"`); else check(schema.properties[k], value[k], `${where}.${k}`); }
  }
  if (typeof value === 'number') { if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${where}: < minimum`); if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${where}: > maximum`); }
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${where}: ${value} not in enum`);
}

(async () => {
  const repository = new InMemoryQuranStructureRepository();
  const service = new QuranStructureService(repository);
  const importer = new ImportQuranDataset({ store: repository, unitOfWork: { run: (w) => w({} as never) }, clock: new FixedClock(new Date('2026-10-24T00:00:00Z')) });
  const summary = await importer.execute({ raw: JSON.parse(readFileSync(process.argv[2]!, 'utf8')), checksum: 'f'.repeat(64), replace: false }); // REAL profile
  console.log('imported into memory (real profile):', summary.outcome, JSON.stringify(summary.counts));
  const op = (path: string) => doc.paths[`/quran${path}`].get.responses['200'].content['application/json'].schema.properties;
  const data = (path: string) => op(path).data;
  const samples: Array<[string, string, unknown]> = [
    ['/dataset', 'dataset', await service.getDatasetInfo()],
    ['/surahs', 'surahs', await service.listSurahs()],
    ['/surahs/{surah}', 'surah 114', await service.getSurah(114)],
    ['/surahs/{surah}/ayahs/{ayah}', 'ayah 1:1', await service.getAyah(1, 1)],
    ['/surahs/{surah}/ayahs/{ayah}', 'ayah 2:255 (page span)', await service.getAyah(2, 255)],
    ['/ayahs/{position}', 'ayah 6236', await service.getAyahByGlobalPosition(6236)],
    ['/pages/{page}', 'page 1', await service.getPage(1)],
    ['/pages/{page}', 'page 349', await service.getPage(349)],
    ['/pages/{page}', 'page 604', await service.getPage(604)],
    ['/juz', 'juz', await service.listJuzs()],
    ['/quarter-marks', 'quarter marks', await service.listQuarterMarks()],
  ];
  for (const [path, label, value] of samples) { const before = problems.length; check(data(path), value, label); console.log(`${problems.length === before ? 'OK  ' : 'FAIL'} ${path.padEnd(32)} ${label}`); }
  const page = await service.listAyahsOfSurah(2, { page: 3, pageSize: 100 }, 'asc');
  const before = problems.length; for (const a of page.items) check(data('/surahs/{surah}/ayahs').items ?? data('/surahs/{surah}/ayahs'), a, `ayah ${a.surah}:${a.ayah}`);
  console.log(`${problems.length === before ? 'OK  ' : 'FAIL'} ${'/surahs/{surah}/ayahs'.padEnd(32)} paginated, page 3 of surah 2 (${page.items.length} of ${page.total})`);
  // semantic spot checks on the real data
  const a = (await service.getAyah(23, 118))!, p349 = (await service.getPage(349))!;
  console.log('23:118 ->', JSON.stringify({ page: a.firstPage, lines: `${a.firstLine}-${a.lastLine}`, juz: a.juz }), '| page 349 kinds of lines 13-15:', p349.lines.slice(12).map((l) => l.kind).join(','));
  console.log(problems.length ? `PROBLEMS (${problems.length}):\n${problems.slice(0, 10).join('\n')}` : 'ALL responses conform to the OpenAPI schemas.');
  process.exit(problems.length ? 1 : 0);
})();
