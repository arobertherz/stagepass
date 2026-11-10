import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  findConflicts,
  assertScaffoldParentPath,
  writeScaffoldFiles,
  rollbackScaffold,
} from '../scaffold.js';

describe('findConflicts (INV-3 / F-10)', () => {
  /** @type {string} */
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-scaffold-conflict-'));
  });
  afterEach(async () => {
    await fs.remove(dir);
  });

  it('flags an existing file at the exact path', async () => {
    await fs.writeFile(path.join(dir, 'package.json'), '{}');
    const c = await findConflicts(dir, [{ relativePath: 'package.json' }], fs);
    expect(c).toContain('package.json');
  });

  it('flags a file named like a directory component (src as file)', async () => {
    await fs.writeFile(path.join(dir, 'src'), 'KEEP');
    const c = await findConflicts(dir, [{ relativePath: 'src/main.ts' }], fs);
    expect(c).toContain('src');
  });

  it('flags a symlink directory (src -> outside)', async () => {
    const outside = path.join(dir, 'outside');
    await fs.ensureDir(outside);
    await fs.symlink(outside, path.join(dir, 'src'));
    const c = await findConflicts(dir, [{ relativePath: 'src/main.ts' }], fs);
    expect(c).toContain('src');
  });

  it('flags a symlink file at the destination', async () => {
    const outside = path.join(dir, 'victim.txt');
    await fs.writeFile(outside, 'ORIGINAL');
    await fs.symlink(outside, path.join(dir, 'stagepass.json'));
    const c = await findConflicts(dir, [{ relativePath: 'stagepass.json' }], fs);
    expect(c).toContain('stagepass.json');
  });

  it('flags a parent symlink within the target', async () => {
    const outside = path.join(dir, 'outside');
    await fs.ensureDir(outside);
    await fs.ensureDir(path.join(dir, 'proj'));
    await fs.symlink(outside, path.join(dir, 'proj', 'nested'));
    const c = await findConflicts(path.join(dir, 'proj'), [{ relativePath: 'nested/file.txt' }], fs);
    expect(c).toContain('nested');
  });
});

describe('assertScaffoldParentPath (INV-4)', () => {
  /** @type {string} */
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-scaffold-parent-'));
  });
  afterEach(async () => {
    await fs.remove(dir);
  });

  it('rejects when a parent path is a file', async () => {
    const file = path.join(dir, 'afile');
    await fs.writeFile(file, 'x');
    const r = await assertScaffoldParentPath(path.join(file, 'child'), fs);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Parent path is a file/i);
  });

  it('rejects when the target path is a file', async () => {
    const file = path.join(dir, 'target');
    await fs.writeFile(file, 'x');
    const r = await assertScaffoldParentPath(file, fs);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Target path is a file/i);
  });

  // F-11: non-file/non-dir/non-symlink target must return `{ ok: false, error: 'Target path is not a directory: ...' }`
  it('[F-11] rejects when the target path is neither file nor directory', async () => {
    const target = path.join(dir, 'weird');
    const fakeFs = {
      lstat: async () => ({
        isSymbolicLink: () => false,
        isFile: () => false,
        isDirectory: () => false,
      }),
    };
    const r = await assertScaffoldParentPath(target, fakeFs);
    expect(r).toEqual({
      ok: false,
      error: `Target path is not a directory: ${path.resolve(target)}`,
    });
  });
});

describe('writeScaffoldFiles rollback (INV-4)', () => {
  /** @type {string} */
  let dir;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-scaffold-write-'));
  });
  afterEach(async () => {
    await fs.remove(dir);
  });

  it('rolls back a newly created target dir on mid-loop write failure', async () => {
    const target = path.join(dir, 'fresh');
    const files = [
      { relativePath: 'a.txt', contents: 'A' },
      { relativePath: 'b.txt', contents: 'B' },
      { relativePath: 'c.txt', contents: 'C' },
    ];
    let writes = 0;
    const fse = {
      ...fs,
      writeFile: async (p, data, enc) => {
        writes += 1;
        if (writes === 2) throw new Error('disk full');
        return fs.writeFile(p, data, enc);
      },
    };
    const before = await fs.readdir(dir);
    const r = await writeScaffoldFiles(target, files, fse);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/disk full/);
    expect(await fs.pathExists(target)).toBe(false);
    expect(await fs.readdir(dir)).toEqual(before);
  });

  it('does not remove pre-existing files when rolling back into an existing target', async () => {
    const target = path.join(dir, 'existing');
    await fs.ensureDir(target);
    await fs.writeFile(path.join(target, 'keep.txt'), 'KEEP');
    const files = [
      { relativePath: 'a.txt', contents: 'A' },
      { relativePath: 'b.txt', contents: 'B' },
    ];
    let writes = 0;
    const fse = {
      ...fs,
      writeFile: async (p, data, enc) => {
        writes += 1;
        if (writes === 2) throw new Error('boom');
        return fs.writeFile(p, data, enc);
      },
    };
    const r = await writeScaffoldFiles(target, files, fse);
    expect(r.ok).toBe(false);
    expect(await fs.readFile(path.join(target, 'keep.txt'), 'utf8')).toBe('KEEP');
    expect(await fs.pathExists(path.join(target, 'a.txt'))).toBe(false);
    expect(await fs.pathExists(path.join(target, 'b.txt'))).toBe(false);
  });

  it('rollbackScaffold removes a created target entirely', async () => {
    const target = path.join(dir, 'rm-me');
    await fs.ensureDir(target);
    await fs.writeFile(path.join(target, 'x.txt'), 'x');
    await rollbackScaffold([target, path.join(target, 'x.txt')], target, fs);
    expect(await fs.pathExists(target)).toBe(false);
  });
});
