import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  renderLaunchAgentPlist,
  enableAutostart,
  resolveAutostartRuntimeEnvironment,
  buildAutostartPathEnv,
  LAUNCHD_MINIMAL_PATH,
} from '../autostart.js';
import { runChildBounded } from './run-child-bounded.js';

/** @type {string[]} */
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTemp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/**
 * Fake Homebrew prefix with executable stand-ins for brew + caddy.
 * When `cellarCaddy` is set, mirrors real Homebrew: `bin/caddy` →
 * `Cellar/caddy/<ver>/bin/caddy` (relative symlink).
 * @param {'as'|'intel'} arch
 * @param {{ space?: boolean, cellarCaddy?: boolean, cellarVersion?: string }} [opts]
 */
function installFakeHomebrew(arch, opts = {}) {
  const root = makeTemp('sp-brew-');
  const baseName = opts.space
    ? arch === 'as'
      ? 'opt homebrew'
      : 'usr local'
    : arch === 'as'
      ? 'opt/homebrew'
      : 'usr/local';
  const prefix = path.join(root, baseName);
  const bin = path.join(prefix, 'bin');
  const sbin = path.join(prefix, 'sbin');
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(sbin, { recursive: true });

  const brewPath = path.join(bin, 'brew');
  const caddyShim = path.join(bin, 'caddy');
  // pwd -P so prefix matches fs.realpath (macOS /var vs /private/var).
  const brewBody = `#!/bin/sh
if [ "$1" = "--prefix" ]; then
  printf '%s\\n' "$(CDPATH= cd -- "$(dirname "$0")/.." && pwd -P)"
  exit 0
fi
printf 'brew-standin:%s\\n' "$*"
exit 0
`;
  const caddyBody = `#!/bin/sh
printf 'caddy-standin:%s\\n' "$*"
exit 0
`;
  fs.writeFileSync(brewPath, brewBody, { mode: 0o755 });

  let caddyCanonical = caddyShim;
  if (opts.cellarCaddy) {
    const version = opts.cellarVersion || '2.11.7';
    const cellarBin = path.join(prefix, 'Cellar', 'caddy', version, 'bin');
    fs.mkdirSync(cellarBin, { recursive: true });
    caddyCanonical = path.join(cellarBin, 'caddy');
    fs.writeFileSync(caddyCanonical, caddyBody, { mode: 0o755 });
    fs.symlinkSync(path.relative(bin, caddyCanonical), caddyShim);
  } else {
    fs.writeFileSync(caddyShim, caddyBody, { mode: 0o755 });
  }

  // Normalize to realpath so macOS /var vs /private/var matches brew --prefix / validatePrefixPathTool.
  const prefixReal = fs.realpathSync(prefix);
  const binReal = path.join(prefixReal, 'bin');
  const sbinReal = path.join(prefixReal, 'sbin');
  return {
    root: fs.realpathSync(root),
    prefix: prefixReal,
    bin: binReal,
    sbin: sbinReal,
    brewPath: path.join(binReal, 'brew'),
    caddyPath: path.join(binReal, 'caddy'),
    caddyCanonical: fs.realpathSync(caddyCanonical),
  };
}

/**
 * @param {{ brewPath: string, caddyPath: string, prefix: string }} fake
 */
function fakeHomebrewExec(fake) {
  return async (file, args = []) => {
    if (file === '/usr/bin/env' && args[0] === 'which') {
      if (args[1] === 'brew') {
        return { stdout: `${fake.brewPath}\n`, stderr: '', code: 0 };
      }
      if (args[1] === 'caddy') {
        return { stdout: `${fake.caddyPath}\n`, stderr: '', code: 0 };
      }
    }
    if (file === fake.brewPath && args[0] === '--prefix') {
      return { stdout: `${fake.prefix}\n`, stderr: '', code: 0 };
    }
    throw Object.assign(new Error(`unexpected exec ${file} ${args.join(' ')}`), {
      code: 'ENOENT',
    });
  };
}

/**
 * @param {string} plist
 * @returns {string|null}
 */
function pathEnvFromPlist(plist) {
  const block = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(
    plist
  );
  if (!block) return null;
  const pathMatch =
    /<key>PATH<\/key>\s*<string>([\s\S]*?)<\/string>/.exec(block[1]);
  return pathMatch ? pathMatch[1] : null;
}

describe('autostart LaunchAgent Homebrew PATH contract', () => {
  it('renderLaunchAgentPlist embeds EnvironmentVariables PATH (Apple Silicon style)', () => {
    const pathEnv = buildAutostartPathEnv('/opt/homebrew');
    const plist = renderLaunchAgentPlist({
      nodePath: '/usr/local/bin/node',
      cliPath: '/opt/cli/bin/index.js',
      pathEnv,
      stdoutPath: '/tmp/out.log',
      stderrPath: '/tmp/err.log',
      workingDirectory: '/tmp',
    });
    expect(plist).toContain('<key>EnvironmentVariables</key>');
    expect(plist).toContain('<key>PATH</key>');
    expect(pathEnvFromPlist(plist)).toBe(pathEnv);
    expect(pathEnv).toContain('/opt/homebrew/bin');
    expect(pathEnv).toContain('/opt/homebrew/sbin');
    expect(pathEnv.endsWith(LAUNCHD_MINIMAL_PATH) || pathEnv.includes(LAUNCHD_MINIMAL_PATH)).toBe(
      true
    );
  });

  it('renderLaunchAgentPlist embeds Intel-style prefix and XML-escapes PATH', () => {
    const weirdPrefix = '/usr/local/brew&path<"x">';
    const pathEnv = buildAutostartPathEnv(weirdPrefix);
    const plist = renderLaunchAgentPlist({
      nodePath: '/usr/local/bin/node',
      cliPath: '/opt/cli/bin/index.js',
      pathEnv,
      stdoutPath: '/tmp/out.log',
      stderrPath: '/tmp/err.log',
      workingDirectory: '/tmp',
    });
    expect(plist).toContain('&amp;');
    expect(plist).toContain('&lt;');
    expect(plist).toContain('&quot;');
    expect(plist).toContain('/usr/local/brew&amp;path&lt;&quot;x&quot;&gt;/bin');
  });

  it('launchd-minimal PATH alone cannot resolve Homebrew stand-ins (bug baseline)', async () => {
    const fake = installFakeHomebrew('as');
    const probe = path.join(fake.root, 'probe.mjs');
    fs.writeFileSync(
      probe,
      `
import { spawn } from 'node:child_process';
const child = spawn('caddy', ['version'], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
child.on('error', (err) => {
  process.stdout.write('PROBE_ERR ' + err.code + '\\n');
  process.exit(0);
});
child.on('close', (code) => {
  process.stdout.write('PROBE_CLOSE ' + code + '\\n');
  process.exit(0);
});
`
    );
    const result = await runChildBounded({
      args: [probe],
      deadlineMs: 3000,
      outputBudget: 16 * 1024,
      label: 'minimal-path-enoent',
      env: {
        PATH: LAUNCHD_MINIMAL_PATH,
        HOME: fake.root,
      },
    });
    expect(result.aliveAfterClose).toBe(false);
    expect(result.output).toContain('PROBE_ERR ENOENT');
  });

  it(
    'hermetic: generated LaunchAgent PATH resolves brew/caddy under launchd-like env (AS)',
    async () => {
      const fake = installFakeHomebrew('as', { cellarCaddy: true });
      const runtime = await resolveAutostartRuntimeEnvironment({
        exec: fakeHomebrewExec(fake),
        pathExists: async (p) => fs.existsSync(p),
        realpath: async (p) => fs.realpathSync(p),
        stat: async (p) => fs.statSync(p),
      });
      expect(runtime.ok).toBe(true);
      expect(runtime.pathEnv).toContain(fake.bin);

      const plistPath = path.join(fake.root, 'agent.plist');
      const writes = [];
      const enabled = await enableAutostart({
        uid: 501,
        plistPath,
        logsDir: path.join(fake.root, 'logs'),
        paths: {
          ok: true,
          nodePath: process.execPath,
          cliPath: path.join(fake.root, 'cli.js'),
        },
        runtime,
        pathExists: async (p) => {
          if (p === path.join(fake.root, 'cli.js')) {
            fs.writeFileSync(p, '// cli\n');
            return true;
          }
          return fs.existsSync(p) || p === process.execPath;
        },
        ensureDir: async (p) => fs.mkdirSync(p, { recursive: true }),
        writeFile: async (p, c) => {
          writes.push(p);
          fs.writeFileSync(p, c);
        },
        exec: async (_file, args) => {
          if (args?.[0] === 'print') throw new Error('Could not find service');
          return { stdout: '', stderr: '', code: 0 };
        },
      });
      expect(enabled.ok).toBe(true);
      expect(writes).toContain(plistPath);
      const plist = fs.readFileSync(plistPath, 'utf8');
      const pathEnv = pathEnvFromPlist(plist);
      expect(pathEnv).toBe(runtime.pathEnv);

      const probe = path.join(fake.root, 'probe-ok.mjs');
      fs.writeFileSync(
        probe,
        `
import { spawn } from 'node:child_process';
function run(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('error', (err) => resolve({ ok: false, err: err.code || String(err) }));
    child.on('close', (code) => resolve({ ok: code === 0, out, code }));
  });
}
const brew = await run('brew', ['--prefix']);
const caddy = await run('caddy', ['version']);
if (!brew.ok || !caddy.ok) {
  process.stdout.write('PROBE_FAIL brew=' + JSON.stringify(brew) + ' caddy=' + JSON.stringify(caddy) + '\\n');
  process.exit(1);
}
process.stdout.write('PROBE_OK brew=' + brew.out.trim() + ' caddy=' + caddy.out.trim() + '\\n');
`
      );

      const result = await runChildBounded({
        args: [probe],
        deadlineMs: 4000,
        outputBudget: 32 * 1024,
        label: 'plist-path-resolves',
        env: {
          PATH: pathEnv,
          // No Homebrew credentials / user secrets.
          HOME: fake.root,
          LANG: 'C',
        },
      });
      expect(result.aliveAfterClose).toBe(false);
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(0);
      expect(result.output).toContain('PROBE_OK');
      expect(result.output).toContain('caddy-standin');
    },
    12_000
  );

  it(
    'hermetic: Intel-style prefix + whitespace in prefix still resolves',
    async () => {
      const fake = installFakeHomebrew('intel', {
        space: true,
        cellarCaddy: true,
      });
      const runtime = await resolveAutostartRuntimeEnvironment({
        exec: fakeHomebrewExec(fake),
        pathExists: async (p) => fs.existsSync(p),
        realpath: async (p) => fs.realpathSync(p),
        stat: async (p) => fs.statSync(p),
      });
      expect(runtime.ok).toBe(true);
      expect(runtime.brewPrefix).toBe(fake.prefix);
      expect(runtime.pathEnv.split(':')[0]).toBe(path.join(fake.prefix, 'bin'));

      const probe = path.join(fake.root, 'probe-intel.mjs');
      fs.writeFileSync(
        probe,
        `
import { spawn } from 'node:child_process';
const child = spawn('caddy', ['run'], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
let out = '';
child.stdout.on('data', (c) => { out += c; });
child.on('error', (err) => {
  process.stdout.write('ERR ' + err.code + '\\n');
  process.exit(1);
});
child.on('close', () => {
  process.stdout.write('OK ' + out.trim() + '\\n');
  process.exit(0);
});
`
      );
      const result = await runChildBounded({
        args: [probe],
        deadlineMs: 4000,
        outputBudget: 16 * 1024,
        label: 'intel-whitespace-path',
        env: { PATH: runtime.pathEnv, HOME: fake.root, LANG: 'C' },
      });
      expect(result.code).toBe(0);
      expect(result.output).toContain('OK caddy-standin');
      expect(result.aliveAfterClose).toBe(false);
    },
    12_000
  );

  it('missing brew/caddy fails before plist write', async () => {
    const writes = [];
    const runtime = await resolveAutostartRuntimeEnvironment({
      exec: async () => {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      },
      pathExists: async () => false,
      realpath: async (p) => p,
    });
    expect(runtime.ok).toBe(false);
    expect(runtime.error).toMatch(/brew|caddy|Homebrew/i);

    const enabled = await enableAutostart({
      uid: 501,
      plistPath: '/tmp/should-not-write-stagepass.plist',
      logsDir: '/tmp/should-not-write-logs',
      paths: {
        ok: true,
        nodePath: '/usr/local/bin/node',
        cliPath: '/opt/cli/bin/index.js',
      },
      runtime,
      pathExists: async () => true,
      ensureDir: async () => {},
      writeFile: async (p) => {
        writes.push(p);
      },
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
    });
    expect(enabled.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it('invalid brew --prefix fails without writing plist', async () => {
    const fake = installFakeHomebrew('as');
    const writes = [];
    const runtime = await resolveAutostartRuntimeEnvironment({
      exec: async (file, args = []) => {
        if (file === '/usr/bin/env' && args[0] === 'which') {
          if (args[1] === 'brew') {
            return { stdout: `${fake.brewPath}\n`, stderr: '', code: 0 };
          }
          if (args[1] === 'caddy') {
            return { stdout: `${fake.caddyPath}\n`, stderr: '', code: 0 };
          }
        }
        if (file === fake.brewPath && args[0] === '--prefix') {
          return { stdout: '/nonexistent/stagepass-prefix\n', stderr: '', code: 0 };
        }
        throw Object.assign(new Error('unexpected'), { code: 1 });
      },
      pathExists: async (p) => p === fake.brewPath || p === fake.caddyPath,
      realpath: async (p) => p,
    });
    expect(runtime.ok).toBe(false);
    expect(runtime.error).toMatch(/prefix/i);

    const enabled = await enableAutostart({
      uid: 501,
      plistPath: '/tmp/nope.plist',
      logsDir: '/tmp/nope-logs',
      paths: {
        ok: true,
        nodePath: process.execPath,
        cliPath: fake.caddyPath,
      },
      runtime,
      pathExists: async () => true,
      writeFile: async (p) => {
        writes.push(p);
      },
      exec: async () => ({ stdout: '', stderr: '', code: 0 }),
    });
    expect(enabled.ok).toBe(false);
    expect(writes).toEqual([]);
  });

  it('buildAutostartPathEnv rejects PATH delimiter in brewPrefix', () => {
    expect(() => buildAutostartPathEnv('/opt/homebrew:evil')).toThrow(/delimiter|:/i);
  });

  it(
    'hermetic: Apple Silicon Cellar symlink topology for caddy is accepted',
    async () => {
      const fake = installFakeHomebrew('as', { cellarCaddy: true });
      expect(fs.lstatSync(fake.caddyPath).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(fake.caddyPath)).toBe(fs.realpathSync(fake.caddyCanonical));
      expect(path.dirname(fs.realpathSync(fake.caddyPath))).not.toBe(fake.bin);

      const runtime = await resolveAutostartRuntimeEnvironment({
        exec: fakeHomebrewExec(fake),
        pathExists: async (p) => fs.existsSync(p),
        realpath: async (p) => fs.realpathSync(p),
        stat: async (p) => fs.statSync(p),
      });
      expect(runtime.ok).toBe(true);
      expect(runtime.caddyPath).toBe(fake.caddyPath);
      expect(runtime.pathEnv.split(':')[0]).toBe(fake.bin);

      const probe = path.join(fake.root, 'probe-cellar-as.mjs');
      fs.writeFileSync(
        probe,
        `
import { spawn } from 'node:child_process';
const child = spawn('caddy', ['version'], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
let out = '';
child.stdout.on('data', (c) => { out += c; });
child.on('error', (err) => {
  process.stdout.write('ERR ' + err.code + '\\n');
  process.exit(1);
});
child.on('close', (code) => {
  process.stdout.write('OK ' + out.trim() + ' code=' + code + '\\n');
  process.exit(code === 0 ? 0 : 1);
});
`
      );
      const result = await runChildBounded({
        args: [probe],
        deadlineMs: 4000,
        outputBudget: 16 * 1024,
        label: 'cellar-as-path',
        env: { PATH: runtime.pathEnv, HOME: fake.root, LANG: 'C' },
      });
      expect(result.aliveAfterClose).toBe(false);
      expect(result.code).toBe(0);
      expect(result.output).toContain('OK caddy-standin');
    },
    12_000
  );

  it(
    'hermetic: Intel Homebrew bin→Cellar caddy symlink is accepted',
    async () => {
      const fake = installFakeHomebrew('intel', {
        cellarCaddy: true,
        cellarVersion: '2.10.0',
      });
      const runtime = await resolveAutostartRuntimeEnvironment({
        exec: fakeHomebrewExec(fake),
        pathExists: async (p) => fs.existsSync(p),
        realpath: async (p) => fs.realpathSync(p),
        stat: async (p) => fs.statSync(p),
      });
      expect(runtime.ok).toBe(true);
      expect(path.dirname(runtime.caddyPath)).toBe(fake.bin);
      expect(fs.realpathSync(runtime.caddyPath)).toContain(
        `${path.sep}Cellar${path.sep}caddy${path.sep}`
      );
    },
    8_000
  );

  it('rejects when PATH shim is a directory instead of an executable', async () => {
    const fake = installFakeHomebrew('as');
    fs.rmSync(fake.caddyPath);
    fs.mkdirSync(fake.caddyPath);
    const runtime = await resolveAutostartRuntimeEnvironment({
      exec: fakeHomebrewExec(fake),
      pathExists: async (p) => fs.existsSync(p),
      realpath: async (p) => fs.realpathSync(p),
      stat: async (p) => fs.statSync(p),
    });
    expect(runtime.ok).toBe(false);
    expect(runtime.error).toMatch(/non-file|not a file|directory|executable/i);
  });
});
