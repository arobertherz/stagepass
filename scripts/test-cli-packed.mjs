#!/usr/bin/env node
/**
 * End-to-end check of the *packed* @stagepass/cli (what npm actually ships).
 *
 * 1. `npm pack` packages/cli, loader and modules into a temp dir
 * 2. install the CLI tarball globally into a temp prefix
 * 3. run the installed `stagepass new` for ts and js with `--install`; an
 *    `npm` shim on PATH adds the local loader/modules tarballs to
 *    `npm install`, so the unpublished versions resolve
 * 4. assert dotfiles (.gitignore, .cursor rule) exist, deps resolve,
 *    `tsc --noEmit` sees `sp` (and only declared modules), `npm run build` works
 * 5. run `stagepass upgrade` on an old-style project and check the sync
 *
 * Catches files that exist in the repo but are dropped by npm pack (e.g.
 * `.gitignore` templates, paths missing from the `files` field).
 *
 * Usage: node scripts/test-cli-packed.mjs
 * Needs network access to the npm registry (same as `npm ci`).
 */

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_DIR = join(ROOT, 'packages', 'cli');
const LOADER_DIR = join(ROOT, 'packages', 'loader');
const MODULES_DIR = join(ROOT, 'packages', 'modules');
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

  // Loader/modules tarballs: generated projects need ^<packages version>,
  // which may not be on the registry yet (staged or unreleased).
  const packLocal = (dir) => {
    const [info] = JSON.parse(
      run(npm, ['pack', '--json', '--pack-destination', work], { cwd: dir, env })
    );
    return { tarball: join(work, info.filename), files: new Set(info.files.map((f) => f.path)) };
  };
  const loaderPack = packLocal(LOADER_DIR);
  const modulesPack = packLocal(MODULES_DIR);
  for (const f of ['global.d.ts', 'dist/loader.min.js', 'dist/flag.min.js']) {
    assert(loaderPack.files.has(f), `loader tarball has ${f}`);
  }
  for (const f of ['global.d.ts', 'inject.d.ts', 'cookies.d.ts', 'maintenance.d.ts', 'dist/all.min.js', 'dist/cookies.min.js']) {
    assert(modulesPack.files.has(f), `modules tarball has ${f}`);
  }

  // npm shim: `npm install` (as run by `stagepass new --install`) also gets
  // the local tarballs with --no-save, so package.json keeps the caret ranges.
  const realNpm = run('sh', ['-c', `command -v ${npm}`], { env }).trim();
  const shimDir = join(work, 'shim');
  mkdirSync(shimDir);
  const shim = join(shimDir, 'npm');
  writeFileSync(
    shim,
    [
      '#!/bin/sh',
      'if [ "$1" = "install" ] && [ "$#" -eq 1 ]; then',
      `  exec "${realNpm}" install --no-save --no-audit --no-fund "${loaderPack.tarball}" "${modulesPack.tarball}"`,
      'fi',
      `exec "${realNpm}" "$@"`,
      '',
    ].join('\n')
  );
  chmodSync(shim, 0o755);
  const shimEnv = { ...env, PATH: `${shimDir}:${env.PATH}` };

  const prefix = join(work, 'prefix');
  run(npm, ['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', tarball], {
    env,
  });
  const bin = join(prefix, 'bin', 'stagepass');
  assert(existsSync(bin), 'stagepass bin installed');

  const version = run(bin, ['--version'], { env }).trim();
  const expected = JSON.parse(readFileSync(join(CLI_DIR, 'package.json'), 'utf8')).version;
  assert(version === expected, `--version ${version} === ${expected}`);

  const cases = [
    { lang: 'ts', modules: 'none' },
    { lang: 'ts', modules: 'cookies' },
    { lang: 'js', modules: 'all' },
  ];
  for (const { lang, modules } of cases) {
    const projects = join(work, `projects-${lang}-${modules}`);
    mkdirSync(projects, { recursive: true });
    const name = `packed-${lang}-${modules}`;
    run(
      bin,
      ['new', name, '--yes', '--lang', lang, '--no-git', '--install', '--site-modules', modules],
      { cwd: projects, env: shimEnv, stdio: ['ignore', 'inherit', 'inherit'] }
    );
    const dir = join(projects, name);
    const gitignore = join(dir, '.gitignore');
    assert(existsSync(gitignore), `${lang}: .gitignore created`);
    assert(
      readFileSync(gitignore, 'utf8').includes('node_modules/'),
      `${lang}: .gitignore content`
    );
    assert(existsSync(join(dir, '.cursor', 'rules', 'stagepass.mdc')), `${lang}: cursor rule`);
    assert(existsSync(join(dir, lang === 'ts' ? 'src/main.ts' : 'src/main.js')), `${lang}: entry`);
    assert(existsSync(join(dir, 'node_modules', '@stagepass', 'loader')), `${lang}: loader installed`);
    assert(existsSync(join(dir, 'node_modules', '@stagepass', 'modules')), `${lang}: modules installed`);
    const sp = JSON.parse(readFileSync(join(dir, 'stagepass.json'), 'utf8'));
    assert(
      JSON.stringify(sp.modules) === JSON.stringify(modules === 'none' ? [] : [modules]),
      `${lang}/${modules}: stagepass.json modules`
    );

    if (lang === 'ts') {
      // tsc must see `sp`; undeclared modules must be type errors.
      writeFileSync(
        join(dir, 'src', 'sp-check.ts'),
        [
          "const env: 'production' | 'staging' | 'local' = sp.env();",
          "sp.on('theme', (t) => sp.log(t.current));",
          'void env;',
          modules === 'cookies'
            ? "if (sp.cookies) sp.cookies.bake('a', '1', { days: 1 });"
            : '// @ts-expect-error cookies is not declared in this project\nsp.cookies;',
          '// @ts-expect-error inject is not declared in this project',
          'sp.inject;',
          '',
        ].join('\n')
      );
      run(join(dir, 'node_modules', '.bin', 'tsc'), ['--noEmit', '-p', '.'], {
        cwd: dir,
        env,
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      rmSync(join(dir, 'src', 'sp-check.ts'));
      console.log(`✅ ${lang}/${modules}: tsc sees sp and only declared modules`);
    } else {
      // jsconfig has checkJs + strict: the generated JS must type check too.
      run(npm, ['exec', '--yes', '--package', 'typescript@5', '--', 'tsc', '--noEmit', '-p', 'jsconfig.json'], {
        cwd: dir,
        env,
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      console.log(`✅ ${lang}/${modules}: tsc -p jsconfig.json passes (checkJs)`);
    }

    run(npm, ['run', 'build'], { cwd: dir, env, stdio: ['ignore', 'inherit', 'inherit'] });
    assert(existsSync(join(dir, 'dist', 'manifest.json')), `${lang}: build wrote manifest`);
    console.log(`✅ ${lang}/${modules}: scaffold + install + build ok`);
  }

  // Old-style (2.0/2.1) project: no modules list, no managed block, no rule.
  const old = join(work, 'old-project');
  mkdirSync(old);
  writeFileSync(
    join(old, 'package.json'),
    `${JSON.stringify({ name: 'old', private: true, devDependencies: { '@stagepass/loader': '^2.0.0', '@stagepass/modules': '^2.0.0' } }, null, 2)}\n`
  );
  writeFileSync(join(old, 'stagepass.json'), `${JSON.stringify({ name: 'old', modules: true, version: 1 }, null, 2)}\n`);
  writeFileSync(join(old, 'AGENTS.md'), '# old\n\nHand-written notes.\n');
  writeFileSync(
    join(old, 'tsconfig.json'),
    `${JSON.stringify({ compilerOptions: { strict: true, types: ['@stagepass/loader', '@stagepass/modules'] } }, null, 2)}\n`
  );
  const dry = run(bin, ['upgrade', '--dry-run', '--site-modules', 'cookies'], { cwd: old, env });
  assert(dry.includes('Dry run'), 'upgrade --dry-run reports');
  assert(!existsSync(join(old, '.cursor')), 'dry run wrote nothing');
  run(bin, ['upgrade', '--site-modules', 'cookies'], { cwd: old, env });
  const agents = readFileSync(join(old, 'AGENTS.md'), 'utf8');
  assert(agents.startsWith('# old\n\nHand-written notes.\n'), 'upgrade keeps AGENTS.md content');
  assert(agents.includes('<!-- stagepass:begin -->') && agents.includes('sp.cookies'), 'upgrade adds block');
  assert(existsSync(join(old, '.cursor', 'rules', 'stagepass.mdc')), 'upgrade adds cursor rule');
  // upgrade only writes published ranges, and per-module types only when the
  // published @stagepass/modules ships them (>= 2.2.0). Expectations follow
  // the real registry state, so this works before and after a release.
  const latestModules = run(npm, ['view', '@stagepass/modules', 'version'], { cwd: old, env }).trim();
  const latestLoader = run(npm, ['view', '@stagepass/loader', 'version'], { cwd: old, env }).trim();
  // `^<latest>` installs the newest published stable of that major (also one
  // only tagged `next`), so per-module types follow that version, as in the CLI.
  const modulesVersions = JSON.parse(run(npm, ['view', '@stagepass/modules', 'versions', '--json'], { cwd: old, env }));
  const [latestMaj] = latestModules.split('.').map(Number);
  const perModule = [].concat(modulesVersions).some((v) => {
    if (typeof v !== 'string' || v.includes('-')) return false;
    const [maj, min] = v.split('.').map(Number);
    return maj === latestMaj && (maj > 2 || min >= 2);
  });
  const oldPkg = JSON.parse(readFileSync(join(old, 'package.json'), 'utf8'));
  assert(oldPkg.devDependencies['@stagepass/loader'] === `^${latestLoader}`, `upgrade writes published loader range ^${latestLoader}`);
  assert(oldPkg.devDependencies['@stagepass/modules'] === `^${latestModules}`, `upgrade writes published modules range ^${latestModules}`);
  const ts = JSON.parse(readFileSync(join(old, 'tsconfig.json'), 'utf8'));
  const expectedTypes = perModule
    ? ['@stagepass/loader', '@stagepass/modules/cookies']
    : ['@stagepass/loader', '@stagepass/modules'];
  assert(
    JSON.stringify(ts.compilerOptions.types) === JSON.stringify(expectedTypes),
    `upgrade sets types for published modules ${latestModules}`
  );
  assert(ts.compilerOptions.strict === true, 'upgrade keeps tsconfig options');
  const oldSp = JSON.parse(readFileSync(join(old, 'stagepass.json'), 'utf8'));
  assert(JSON.stringify(oldSp.modules) === '["cookies"]', 'upgrade writes modules list');
  console.log('✅ upgrade on old-style project ok');

  console.log('✅ packed CLI smoke test passed');
} catch (err) {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
