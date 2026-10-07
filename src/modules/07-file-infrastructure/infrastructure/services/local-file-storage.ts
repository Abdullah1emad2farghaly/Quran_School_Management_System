import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FileStorage } from '../../application/ports/file-storage';

/** Segments of letters/digits/._- separated by "/", never starting with "." (so no ".." or hidden files). */
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/**
 * Private on-disk storage under one root directory that is NOT served by the
 * web server. Keys are validated and the resolved path must stay inside the
 * root. Writes go to a temporary file first and are renamed into place, so a
 * crash never leaves a half-written file under its real name.
 */
export class LocalFileStorage implements FileStorage {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  private resolve(key: string): string {
    if (!KEY_PATTERN.test(key) || key.includes('..')) throw new Error('Invalid storage key');
    const full = path.resolve(this.root, ...key.split('/'));
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, data, { flag: 'wx', mode: 0o600 });
      await fs.rename(temp, target);
    } catch (error) {
      await fs.unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  async get(key: string): Promise<Buffer | undefined> {
    try {
      return await fs.readFile(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.stat(this.resolve(key));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
}
