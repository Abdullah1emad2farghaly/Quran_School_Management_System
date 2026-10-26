/** Converts the approved KFGQPC Hafs package into the normalized Module 21 dataset (see docs/QURAN-STRUCTURE.md). No database. */
import { readFile, writeFile } from 'node:fs/promises';
import { runConvertQuranCli } from './convert-kfgqpc-hafs-cli';

runConvertQuranCli({
  args: process.argv.slice(2),
  readFile: (path) => readFile(path),
  writeFile: (path, content) => writeFile(path, content, 'utf8'),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
}).then(
  (code) => process.exit(code),
  () => {
    console.error('Conversion failed.');
    process.exit(1);
  },
);
