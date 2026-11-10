import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { SKIP_PLATFORM_CHECK_ENV } from '../../lib/platform.js';

const binPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../bin/index.js'
);

/**
 * @returns {{ home: string, binDir: string, project: string, cleanup: () => void }}
 */
function makeHarness() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-exit-home-'));
  const binDir = path.join(home, 'bin');
  const project = path.join(home, 'Sites', 'demo');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(home, '.stagepass'), { recursive: true });
  fs.writeFileSync(
    path.join(binDir, 'caddy'),
    '#!/bin/sh\nexit 0\n',
    { mode: 0o755 }
  );
  return {
    home,
    binDir,
    project,
    cleanup: () => fs.rmSync(home, { recursive: true, force: true }),
  };
}

/**
 * @param {string[]} args
 * @param {{ home: string, binDir: string, cwd?: string }} opts
 */
function runCli(args, opts) {
  return spawnSync(process.execPath, [binPath, ...args], {
    encoding: 'utf8',
    cwd: opts.cwd || opts.home,
    env: {
      ...process.env,
      HOME: opts.home,
      PATH: `${opts.binDir}${path.delimiter}${process.env.PATH || ''}`,
      [SKIP_PLATFORM_CHECK_ENV]: '1',
    },
  });
}

describe('link/unlink process exit codes [INV-1][INV-3][INV-5][P-1]', () => {
  /** @type {ReturnType<typeof makeHarness>[]} */
  const harnesses = [];

  afterEach(() => {
    for (const h of harnesses.splice(0, harnesses.length)) h.cleanup();
  });

  it('exits 1 for link bad_domain!', () => {
    const h = makeHarness();
    harnesses.push(h);
    const r = runCli(['link', 'bad_domain!'], { ...h, cwd: h.project });
    expect(r.status).toBe(1);
  });

  it('exits 1 for link ../evil', () => {
    const h = makeHarness();
    harnesses.push(h);
    const r = runCli(['link', '../evil'], { ...h, cwd: h.project });
    expect(r.status).toBe(1);
  });

  it('exits 1 for unlink ../evil', () => {
    const h = makeHarness();
    harnesses.push(h);
    const r = runCli(['unlink', '../evil'], { ...h, cwd: h.project });
    expect(r.status).toBe(1);
  });

  it('exits 1 for link in HOME', () => {
    const h = makeHarness();
    harnesses.push(h);
    const r = runCli(['link'], { ...h, cwd: h.home });
    expect(r.status).toBe(1);
  });

  it("exits 1 for link --origin 'a.com } evil'", () => {
    const h = makeHarness();
    harnesses.push(h);
    const r = runCli(
      ['link', '--origin', 'a.com } evil.example.com { respond 200'],
      { ...h, cwd: h.project }
    );
    expect(r.status).toBe(1);
  });

  it('exits 0 for a valid link', () => {
    const h = makeHarness();
    harnesses.push(h);
    const r = runCli(['link', 'demo'], { ...h, cwd: h.project });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Linked|Caddy reload failed/i);
  });
});
