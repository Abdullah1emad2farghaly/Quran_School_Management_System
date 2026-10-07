import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalFileStorage } from '../../../src/modules/07-file-infrastructure/public';

let root: string;
let storage: LocalFileStorage;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'qsms-files-'));
  storage = new LocalFileStorage(root);
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('LocalFileStorage', () => {
  it('stores, reads, checks and deletes files in nested folders', async () => {
    const data = Buffer.from('hello');
    await storage.put('2026/03/abc.xlsx', data);
    expect(await storage.exists('2026/03/abc.xlsx')).toBe(true);
    expect((await storage.get('2026/03/abc.xlsx'))?.equals(data)).toBe(true);
    await storage.delete('2026/03/abc.xlsx');
    expect(await storage.exists('2026/03/abc.xlsx')).toBe(false);
    expect(await storage.get('2026/03/abc.xlsx')).toBe(undefined);
  });
  it('overwrites atomically and leaves no temporary files', async () => {
    await storage.put('2026/04/x.xlsx', Buffer.from('one'));
    await storage.put('2026/04/x.xlsx', Buffer.from('two'));
    expect((await storage.get('2026/04/x.xlsx'))?.toString()).toBe('two');
    expect(await readdir(path.join(root, '2026', '04'))).toEqual(['x.xlsx']);
  });
  it('delete is idempotent', async () => {
    await storage.delete('2026/05/missing.xlsx');
    await storage.delete('2026/05/missing.xlsx');
    expect(await storage.exists('2026/05/missing.xlsx')).toBe(false);
  });
  it('rejects keys that could escape the storage root', async () => {
    const bad = ['../outside.xlsx', 'a/../../b.xlsx', '/etc/passwd', 'a//b', '.hidden', 'a/.hidden', 'a\\b', 'a b', '', 'C:/x'];
    for (const key of bad) {
      let rejected = false;
      try {
        await storage.put(key, Buffer.from('x'));
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
    }
  });
});
