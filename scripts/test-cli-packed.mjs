#!/usr/bin/env node
/**
 * End-to-end check of the *packed* @stagepass/cli (what npm actually ships).
 *
 * 1. `npm pack` packages/cli into a temp dir
 * 2. install the tarball globally into a temp prefix
 * 3. run the installed `stagepass new` for ts and js with `--install`
 * 4. assert dotfiles (.gitignore) exist, deps resolve and `npm run build` works
 *
 * Catches files that exist in the repo but are dropped by npm pack (e.g.
 * `.gitignore` templates, paths missing from the `files` field).
 *
 * Usage: node scripts/test-cli-packed.mjs
 * Needs network access to the npm registry (same as `npm ci`).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_DIR = join(ROOT, 'packages', 'cli');
const work = mkdtempSync(join(tmpdir(), 'stagepass-packed-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, {
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    ...opts,
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

try {
  // Avoid inheriting a workspace-level npm prefix / config from the monorepo.
  const env = { ...process.env, npm_config_prefix: undefined };
  delete env.npm_config_prefix;
  // The CLI is macOS only; CI runs on Linux. Documented test/CI escape hatch.
  if (process.platform !== 'darwin') env.STAGEPASS_SKIP_PLATFORM_CHECK = '1';

  const packOut = run(npm, ['pack', '--json', '--pack-destination', work], {
    cwd: CLI_DIR,
    env,
  });
  const [packInfo] = JSON.parse(packOut);
  const tarball = join(work, packInfo.filename);
  const packed = new Set(packInfo.files.map((f) => f.path));

  // Every file under templates/ in the repo must be in the tarball.
  const walk = (dir, prefix = '') =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory()
        ? walk(join(dir, d.name), `${prefix}${d.name}/`)
        : [`${prefix}${d.name}`]
    );
  for (const rel of walk(join(CLI_DIR, 'templates'))) {
    assert(packed.has(`templates/${rel}`), `templates/${rel} missing from npm tarball`);
  }

  const prefix = join(work, 'prefix');
  run(npm, ['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', tarball], {
    env,
  });
  const bin = join(prefix, 'bin', 'stagepass');
  assert(existsSync(bin), 'stagepass bin installed');

  const version = run(bin, ['--version'], { env }).trim();
  const expected = JSON.parse(readFileSync(join(CLI_DIR, 'package.json'), 'utf8')).version;
  assert(version === expected, `--version ${version} === ${expected}`);

  for (const lang of ['ts', 'js']) {
    const projects = join(work, `projects-${lang}`);
    execFileSync('mkdir', ['-p', projects]);
    const name = `packed-${lang}`;
    run(
      bin,
      ['new', name, '--yes', '--lang', lang, '--no-git', '--install'],
      { cwd: projects, env, stdio: ['ignore', 'inherit', 'inherit'] }
    );
    const dir = join(projects, name);
    const gitignore = join(dir, '.gitignore');
    assert(existsSync(gitignore), `${lang}: .gitignore created`);
    assert(
      readFileSync(gitignore, 'utf8').includes('node_modules/'),
      `${lang}: .gitignore content`
    );
    assert(existsSync(join(dir, lang === 'ts' ? 'src/main.ts' : 'src/main.js')), `${lang}: entry`);
    assert(existsSync(join(dir, 'node_modules', '@stagepass', 'loader')), `${lang}: loader installed`);
    assert(existsSync(join(dir, 'node_modules', '@stagepass', 'modules')), `${lang}: modules installed`);
    run(npm, ['run', 'build'], { cwd: dir, env, stdio: ['ignore', 'inherit', 'inherit'] });
    assert(existsSync(join(dir, 'dist', 'manifest.json')), `${lang}: build wrote manifest`);
    console.log(`✅ ${lang}: scaffold + install + build ok`);
  }

  console.log('✅ packed CLI smoke test passed');
} catch (err) {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
