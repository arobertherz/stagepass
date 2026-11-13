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

import { execFileSync, spawn } from 'node:child_process';
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
import { fileURLToPath, pathToFileURL } from 'node:url';

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

/**
 * Destroy child stdio so a surviving grandchild cannot keep the parent pipes open.
 * @param {import('node:child_process').ChildProcess} child
 */
function destroyChildStdio(child) {
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    try {
      stream?.destroy();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Signal a child; when `detached` was used, kill the whole process group (-pid).
 * @param {import('node:child_process').ChildProcess} child
 * @param {NodeJS.Signals} signal
 */
function signalChild(child, signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      process.kill(child.pid, signal);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Stop a child reliably: SIGTERM → await exit → SIGKILL fallback; always destroy stdio.
 * @param {import('node:child_process').ChildProcess|null|undefined} child
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<void>}
 */
async function stopChild(child, opts = {}) {
  if (!child || !child.pid) return;
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 3000;
  if (child.exitCode !== null || child.signalCode) {
    destroyChildStdio(child);
    return;
  }
  signalChild(child, 'SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      signalChild(child, 'SIGKILL');
      setTimeout(resolve, 250);
    }, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  destroyChildStdio(child);
}

/**
 * @param {import('node:child_process').ChildProcess} child
 * @param {RegExp} re
 * @param {number} [ms]
 */
function waitForChildOutput(child, re, ms = 20000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += String(chunk);
      if (re.test(buf)) {
        cleanup();
        resolve(buf);
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`child exited (${code}): ${buf.slice(-500)}`));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${re}: ${buf.slice(-500)}`));
    }, ms);
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout?.off('data', onData);
      child.stderr?.off('data', onData);
      child.off('exit', onExit);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', onExit);
  });
}

/**
 * @param {ReadableStreamDefaultReader<Uint8Array>} reader
 * @param {number} ms
 */
async function readSseEvents(reader, ms) {
  /** @type {{ type: string, paths: string[] }[]} */
  const events = [];
  const dec = new TextDecoder();
  let buf = '';
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '));
        if (line) events.push(JSON.parse(line.slice(6)));
      }
    }
  })();
  await timeout;
  clearTimeout(timer);
  await reader.cancel().catch(() => {});
  await pump.catch(() => {});
  return events;
}

const HOT_SWAP_HARD_TIMEOUT_MS = 90_000;

/**
 * CSS-only edit on a generated project must emit `{type:'css'}` (no reload);
 * a JS edit must emit `{type:'reload'}`. Uses the packed CLI's createLiveServer
 * over loopback HTTP (no Caddy).
 *
 * Spawns `node scripts/build.mjs --watch` directly (not via npm) so SIGTERM
 * reaches the watch process; builds dispose esbuild on signal. Overall hard
 * timeout kills children and fails clearly.
 *
 * @param {string} projectDir
 * @param {string} npmPrefix
 * @param {NodeJS.ProcessEnv} env
 */
async function assertCssHotSwap(projectDir, npmPrefix, env) {
  const cliRoot = join(npmPrefix, 'lib', 'node_modules', '@stagepass', 'cli');
  const liveServerPath = join(cliRoot, 'src', 'lib', 'live-server.js');
  assert(existsSync(liveServerPath), `packed CLI live-server at ${liveServerPath}`);
  const { createLiveServer, LIVE_PATH } = await import(pathToFileURL(liveServerPath).href);

  /** @type {import('node:child_process').ChildProcess|null} */
  let watchProc = null;
  /** @type {{ close: () => Promise<void> }|null} */
  let liveHandle = null;
  let watchLog = '';
  let hardTimedOut = false;

  /**
   * @param {RegExp} re
   * @param {number} [ms]
   * @param {number} [from]
   */
  function waitForWatchLog(re, ms = 20000, from = 0) {
    return new Promise((resolve, reject) => {
      const check = () => {
        const slice = watchLog.slice(from);
        if (re.test(slice)) {
          cleanup();
          resolve(slice);
        }
      };
      const onExit = (code, signal) => {
        cleanup();
        reject(
          new Error(
            `watch exited (${code}${signal ? `/${signal}` : ''}): ${watchLog.slice(-500)}`
          )
        );
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`timeout waiting for ${re}: ${watchLog.slice(-500)}`));
      }, ms);
      const onTick = () => check();
      const cleanup = () => {
        clearTimeout(timer);
        clearInterval(interval);
        watchProc?.off('exit', onExit);
      };
      const interval = setInterval(onTick, 50);
      watchProc?.on('exit', onExit);
      check();
    });
  }

  async function cleanupHotSwap() {
    await stopChild(watchProc, { timeoutMs: 3000 });
    watchProc = null;
    if (liveHandle) {
      await liveHandle.close().catch(() => {});
      liveHandle = null;
    }
  }

  const hardTimer = setTimeout(() => {
    hardTimedOut = true;
    void cleanupHotSwap();
  }, HOT_SWAP_HARD_TIMEOUT_MS);

  try {
    // Direct node spawn (not `npm run watch`): npm exiting leaves the child
    // `node scripts/build.mjs --watch` (+ esbuild service) alive and keeps
    // piped stdio open forever. detached so we can kill the whole group.
    watchProc = spawn(process.execPath, ['scripts/build.mjs', '--watch'], {
      cwd: projectDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const append = (chunk) => {
      watchLog += String(chunk);
    };
    watchProc.stdout?.on('data', append);
    watchProc.stderr?.on('data', append);
    await waitForWatchLog(/watching/);

    const live = createLiveServer({
      projectRoot: projectDir,
      outDir: 'dist',
      debounceMs: 50,
    });
    liveHandle = await live.listen(0);
    const sseUrl = `http://127.0.0.1:${liveHandle.port}${LIVE_PATH}`;

    const cssPath = existsSync(join(projectDir, 'src', 'styles.css'))
      ? join(projectDir, 'src', 'styles.css')
      : join(projectDir, 'src', 'styles.scss');
    const jsPath = existsSync(join(projectDir, 'src', 'main.js'))
      ? join(projectDir, 'src', 'main.js')
      : join(projectDir, 'src', 'main.ts');

    // --- CSS-only: expect exactly one css event, no reload ---
    {
      const res = await fetch(sseUrl);
      assert(res.status === 200, 'SSE connect for css');
      const reader = res.body.getReader();
      await reader.read(); // : connected

      const marker = watchLog.length;
      const before = readFileSync(cssPath, 'utf8');
      // Must change emitted CSS bytes (sass strips normal comments when compressed).
      const token = String(Date.now());
      writeFileSync(
        cssPath,
        `${before}\n.hotswap-css-probe { content: "${token}"; }\n`,
        'utf8'
      );
      await waitForWatchLog(/rebuild css ok/, 20000, marker);
      // Allow live-server debounce + content hash read
      const events = await readSseEvents(reader, 800);
      const dataEvents = events.filter((e) => e && (e.type === 'css' || e.type === 'reload'));
      assert(
        dataEvents.length === 1 && dataEvents[0].type === 'css',
        `CSS-only edit => one css event, got ${JSON.stringify(dataEvents)}`
      );
      assert(
        !dataEvents.some((e) => e.type === 'reload'),
        'CSS-only edit must not emit reload'
      );
    }

    // --- JS edit: expect reload ---
    {
      const res = await fetch(sseUrl);
      assert(res.status === 200, 'SSE connect for js');
      const reader = res.body.getReader();
      await reader.read();

      const marker = watchLog.length;
      const before = readFileSync(jsPath, 'utf8');
      writeFileSync(jsPath, `${before}\nconsole.log("hotswap-js ${Date.now()}");\n`, 'utf8');
      await waitForWatchLog(/rebuild js ok/, 20000, marker);
      const events = await readSseEvents(reader, 500);
      const dataEvents = events.filter((e) => e && (e.type === 'css' || e.type === 'reload'));
      assert(
        dataEvents.some((e) => e.type === 'reload'),
        `JS edit => reload, got ${JSON.stringify(dataEvents)}`
      );
    }

    if (hardTimedOut) {
      throw new Error(`CSS hot-swap check exceeded ${HOT_SWAP_HARD_TIMEOUT_MS}ms hard timeout`);
    }
    console.log('✅ js/all: CSS hot-swap SSE (css then reload) ok');
  } finally {
    clearTimeout(hardTimer);
    await cleanupHotSwap();
    if (hardTimedOut) {
      throw new Error(`CSS hot-swap check exceeded ${HOT_SWAP_HARD_TIMEOUT_MS}ms hard timeout`);
    }
  }
}

async function main() {
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
  assert(packed.has('templates/project/htaccess'), 'htaccess template missing from npm tarball');
  const packedHtDir = join(work, 'packed-htaccess');
  mkdirSync(packedHtDir);
  run('tar', ['-xzf', tarball, '-C', packedHtDir, 'package/templates/project/htaccess']);
  const repoHt = readFileSync(join(CLI_DIR, 'templates', 'project', 'htaccess'));
  const packedHt = readFileSync(join(packedHtDir, 'package', 'templates', 'project', 'htaccess'));
  assert(packedHt.equals(repoHt), 'packed htaccess bytes match the template');
  assert(
    packedHt.includes('RewriteRule "(^|/)\\." - [F]'),
    'packed htaccess contains the deny rule'
  );

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
  for (const f of [
    'global.d.ts',
    'dist/loader.min.js',
    'dist/flag.min.js',
    'dist/flag-card.min.js',
    'dist/live.min.js',
  ]) {
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
    assert(!existsSync(join(dir, '.htaccess')), `${lang}: no .htaccess without PHP`);
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

    if (lang === 'js' && modules === 'all') {
      await assertCssHotSwap(dir, prefix, env);
    }
  }

  const phpProjects = join(work, 'projects-php');
  mkdirSync(phpProjects, { recursive: true });
  run(
    bin,
    ['new', 'packed-php', '--yes', '--php', '--lang', 'js', '--styles', 'css', '--no-git', '--no-install', '--no-link', '--site-modules', 'none'],
    { cwd: phpProjects, env: shimEnv, stdio: ['ignore', 'inherit', 'inherit'] }
  );
  const phpDir = join(phpProjects, 'packed-php');
  const phpHt = readFileSync(join(phpDir, '.htaccess'));
  assert(phpHt.equals(repoHt), 'php scaffold writes the packed .htaccess');
  assert(!existsSync(join(phpDir, '.env')), 'php scaffold does not write a real .env');
  console.log('✅ php scaffold .htaccess matches the packed template');

  // Old-style (2.0/2.1) project: no modules list, no managed block, no rule.
  const old = join(work, 'old-project');
  mkdirSync(old);
  writeFileSync(
    join(old, 'package.json'),
    `${JSON.stringify({ name: 'old', private: true, devDependencies: { '@stagepass/loader': '^2.0.0', '@stagepass/modules': '^2.0.0' } }, null, 2)}\n`
  );
  writeFileSync(
    join(old, 'stagepass.json'),
    `${JSON.stringify({ name: 'old', modules: true, php: true, version: 1 }, null, 2)}\n`
  );
  writeFileSync(join(old, 'AGENTS.md'), '# old\n\nHand-written notes.\n');
  writeFileSync(
    join(old, 'tsconfig.json'),
    `${JSON.stringify({ compilerOptions: { strict: true, types: ['@stagepass/loader', '@stagepass/modules'] } }, null, 2)}\n`
  );
  const dry = run(bin, ['upgrade', '--dry-run', '--site-modules', 'cookies'], { cwd: old, env });
  assert(dry.includes('Dry run'), 'upgrade --dry-run reports');
  assert(dry.includes('.htaccess: created'), 'upgrade --dry-run plans a missing PHP .htaccess');
  assert(!existsSync(join(old, '.cursor')), 'dry run wrote nothing');
  assert(!existsSync(join(old, '.htaccess')), 'dry run wrote no .htaccess');
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
  assert(oldSp.php === true, 'upgrade keeps php: true');
  assert(readFileSync(join(old, '.htaccess')).equals(repoHt), 'upgrade writes the packed .htaccess when php is true');
  console.log('✅ upgrade on old-style project ok');

  console.log('✅ packed CLI smoke test passed');
} catch (err) {
  console.error(`❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
}

await main();
