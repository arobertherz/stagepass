import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
  LAUNCH_AGENT_LABEL,
  getLaunchAgentPlistPath,
  getLaunchAgentsDir,
  getLogsDir,
  getDaemonStdoutLogPath,
  getDaemonStderrLogPath,
  getCaddyfilePath,
} from './paths.js';
import { defaultExec, resolveCommand } from './exec.js';

/** Default PATH used by macOS user LaunchAgents (no Homebrew). */
export const LAUNCHD_MINIMAL_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

/**
 * Escape a string for use inside an XML plist text node.
 * @param {string} value
 */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build LaunchAgent PATH: validated Homebrew bin/sbin + launchd minimal dirs.
 * Does not inherit the interactive user environment.
 * @param {string} brewPrefix Absolute Homebrew prefix (`brew --prefix`)
 * @returns {string}
 */
export function buildAutostartPathEnv(brewPrefix) {
  if (typeof brewPrefix !== 'string' || brewPrefix.length === 0) {
    throw new Error('brewPrefix is required');
  }
  if (!path.isAbsolute(brewPrefix)) {
    throw new Error(`brewPrefix must be absolute (got: ${brewPrefix})`);
  }
  if (/[\r\n\0]/.test(brewPrefix)) {
    throw new Error('brewPrefix must not contain control characters');
  }
  // `:` would split PATH entries; reject before embedding.
  if (brewPrefix.includes(path.delimiter)) {
    throw new Error(
      `brewPrefix must not contain PATH delimiter (${path.delimiter})`
    );
  }
  const bin = path.join(brewPrefix, 'bin');
  const sbin = path.join(brewPrefix, 'sbin');
  return `${bin}${path.delimiter}${sbin}${path.delimiter}${LAUNCHD_MINIMAL_PATH}`;
}

/**
 * Build LaunchAgent ProgramArguments for `stagepass daemon`.
 * @param {{ nodePath: string, cliPath: string }} paths
 * @returns {string[]}
 */
export function buildDaemonProgramArguments(paths) {
  return [paths.nodePath, paths.cliPath, 'daemon'];
}

/**
 * launchctl bootstrap arguments (gui domain).
 * @param {number|string} uid
 * @param {string} plistPath
 * @returns {string[]}
 */
export function buildLaunchctlBootstrapArgs(uid, plistPath) {
  return ['bootstrap', `gui/${uid}`, plistPath];
}

/**
 * launchctl bootout arguments (gui domain).
 * @param {number|string} uid
 * @param {string} [label]
 * @returns {string[]}
 */
export function buildLaunchctlBootoutArgs(uid, label = LAUNCH_AGENT_LABEL) {
  return ['bootout', `gui/${uid}/${label}`];
}

/**
 * launchctl print arguments (gui domain).
 * @param {number|string} uid
 * @param {string} [label]
 * @returns {string[]}
 */
export function buildLaunchctlPrintArgs(uid, label = LAUNCH_AGENT_LABEL) {
  return ['print', `gui/${uid}/${label}`];
}

/**
 * launchctl kickstart arguments (gui domain).
 * `-k` kills any existing instance before starting.
 * @param {number|string} uid
 * @param {string} [label]
 * @returns {string[]}
 */
export function buildLaunchctlKickstartArgs(uid, label = LAUNCH_AGENT_LABEL) {
  return ['kickstart', '-k', `gui/${uid}/${label}`];
}

/**
 * Render a LaunchAgent plist that runs `stagepass daemon` at login.
 *
 * Port 443: existing `stagepass start` runs `caddy start` as the user (sudo is
 * only used for conflict detection / kill). A user LaunchAgent therefore has the
 * same bind privileges as interactive `start` on macOS. If bind fails at
 * runtime, `daemon` logs a clear error and exits 0 so KeepAlive does not loop.
 *
 * `pathEnv` is required so launchd (minimal PATH) can still resolve Homebrew
 * `brew` / `caddy` by bare name without inheriting the interactive user env.
 *
 * @param {object} opts
 * @param {string} opts.nodePath
 * @param {string} opts.cliPath
 * @param {string} opts.pathEnv Validated PATH for EnvironmentVariables
 * @param {string} [opts.label]
 * @param {string} [opts.stdoutPath]
 * @param {string} [opts.stderrPath]
 * @param {string} [opts.workingDirectory]
 */
export function renderLaunchAgentPlist(opts) {
  const label = opts.label || LAUNCH_AGENT_LABEL;
  const programArguments = buildDaemonProgramArguments({
    nodePath: opts.nodePath,
    cliPath: opts.cliPath,
  });
  const stdoutPath = opts.stdoutPath || getDaemonStdoutLogPath();
  const stderrPath = opts.stderrPath || getDaemonStderrLogPath();
  const workingDirectory = opts.workingDirectory || os.homedir();
  const pathEnv = opts.pathEnv;
  if (typeof pathEnv !== 'string' || pathEnv.length === 0) {
    throw new Error('pathEnv is required for LaunchAgent EnvironmentVariables');
  }
  if (/[\r\n\0]/.test(pathEnv)) {
    throw new Error('pathEnv must not contain control characters');
  }

  const argXml = programArguments
    .map((a) => `\t\t<string>${escapeXml(a)}</string>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${escapeXml(label)}</string>
\t<key>ProgramArguments</key>
\t<array>
${argXml}
\t</array>
\t<key>WorkingDirectory</key>
\t<string>${escapeXml(workingDirectory)}</string>
\t<key>EnvironmentVariables</key>
\t<dict>
\t\t<key>PATH</key>
\t\t<string>${escapeXml(pathEnv)}</string>
\t</dict>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<dict>
\t\t<key>SuccessfulExit</key>
\t\t<false/>
\t</dict>
\t<key>StandardOutPath</key>
\t<string>${escapeXml(stdoutPath)}</string>
\t<key>StandardErrorPath</key>
\t<string>${escapeXml(stderrPath)}</string>
</dict>
</plist>
`;
}

/**
 * Require an absolute path that exists on disk (LaunchAgent ProgramArguments).
 * @param {string|null|undefined} candidate
 * @param {string} label
 * @param {(p: string) => Promise<boolean>} pathExists
 * @returns {Promise<{ ok: true, path: string } | { ok: false, error: string }>}
 */
async function requireAbsoluteExistingPath(candidate, label, pathExists) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return { ok: false, error: `Could not resolve absolute path to ${label}.` };
  }
  if (!path.isAbsolute(candidate)) {
    return {
      ok: false,
      error: `${label} path must be absolute (got: ${candidate}).`,
    };
  }
  if (!(await pathExists(candidate))) {
    return {
      ok: false,
      error: `${label} path does not exist: ${candidate}`,
    };
  }
  return { ok: true, path: candidate };
}

/** `<prefix>/Cellar/node[…]/<version>/<rel>` (Homebrew node keg). */
const CELLAR_NODE_RE = /^(.*)\/Cellar\/node[^/]*\/[^/]+\/(.+)$/;

/**
 * Use `<prefix>/<rel>` when `absPath` is a versioned Homebrew node Cellar
 * path and that unversioned file exists. Otherwise return `absPath`.
 * @param {string} absPath
 * @param {(p: string) => Promise<boolean>} pathExists
 */
async function preferHomebrewStablePath(absPath, pathExists) {
  const m = CELLAR_NODE_RE.exec(absPath);
  if (!m) return absPath;
  const stable = `${m[1]}/${m[2]}`;
  if (stable !== absPath && (await pathExists(stable))) return stable;
  return absPath;
}

/**
 * True for `<prefix>/Cellar/node[…]/<version>/bin/node`.
 * @param {string} absPath
 */
export function isVersionedCellarNodeBin(absPath) {
  const m = CELLAR_NODE_RE.exec(String(absPath || ''));
  return !!m && m[2] === 'bin/node';
}

/**
 * Resolve absolute node + CLI entry paths for the LaunchAgent.
 * @param {object} [opts]
 * @param {string} [opts.execPath]
 * @param {string} [opts.argv1]
 * @param {import('./exec.js').ExecFn} [opts.exec]
 * @param {(p: string) => Promise<string>} [opts.realpath]
 * @param {(p: string) => Promise<boolean>} [opts.pathExists]
 */
export async function resolveAutostartPaths(opts = {}) {
  const execPath = opts.execPath || process.execPath;
  // Nullish coalescing so tests can inject '' / null without falling back to process.argv[1].
  const argv1 = opts.argv1 !== undefined ? opts.argv1 : process.argv[1];
  const realpath =
    opts.realpath || ((p) => fs.realpath(p).then((r) => String(r)));
  const exec = opts.exec || defaultExec;
  const pathExists = opts.pathExists || ((p) => fs.pathExists(p));

  const nodeResolved = path.resolve(execPath);
  const nodeCheck = await requireAbsoluteExistingPath(
    nodeResolved,
    'node',
    pathExists
  );
  if (!nodeCheck.ok) {
    return {
      ok: false,
      error: nodeCheck.error,
      nodePath: nodeResolved,
      cliPath: null,
    };
  }
  const nodePath = await preferHomebrewStablePath(nodeCheck.path, pathExists);

  let cliPath = null;

  if (argv1) {
    try {
      cliPath = await realpath(argv1);
    } catch {
      cliPath = path.resolve(argv1);
    }
  }

  if (!cliPath) {
    const whichStagepass = await resolveCommand('stagepass', exec);
    if (whichStagepass) {
      try {
        cliPath = await realpath(whichStagepass);
      } catch {
        cliPath = whichStagepass;
      }
    }
  }

  const cliCheck = await requireAbsoluteExistingPath(
    cliPath,
    'stagepass CLI entrypoint',
    pathExists
  );
  if (!cliCheck.ok) {
    return {
      ok: false,
      error: cliCheck.error,
      nodePath,
      cliPath: cliPath || null,
    };
  }

  const cliPathStable = await preferHomebrewStablePath(cliCheck.path, pathExists);
  return { ok: true, nodePath, cliPath: cliPathStable, error: null };
}

/**
 * True when `absolutePath` is the Homebrew prefix or a path beneath it.
 * @param {string} absolutePath
 * @param {string} brewPrefix
 */
function isPathUnderPrefix(absolutePath, brewPrefix) {
  return (
    absolutePath === brewPrefix ||
    absolutePath.startsWith(`${brewPrefix}${path.sep}`)
  );
}

/**
 * Validate a tool as launchd will see it: the PATH shim must live in
 * `prefix/bin` or `prefix/sbin`. The realpath target may be under Cellar
 * (normal Homebrew layout) but must remain under the same prefix, be a
 * regular file, and be executable.
 *
 * @param {object} opts
 * @param {string} opts.name
 * @param {string} opts.shimPath Absolute path returned by `which` / PATH lookup
 * @param {string} opts.brewPrefix
 * @param {(p: string) => Promise<string>} opts.realpath
 * @param {(p: string) => Promise<boolean>} opts.pathExists
 * @param {(p: string) => Promise<import('node:fs').Stats>} opts.stat
 * @returns {Promise<{ ok: true, path: string, canonicalPath: string } | { ok: false, error: string }>}
 */
async function validatePrefixPathTool(opts) {
  const { name, shimPath, brewPrefix, realpath, pathExists, stat } = opts;
  const shimCheck = await requireAbsoluteExistingPath(shimPath, name, pathExists);
  if (!shimCheck.ok) return shimCheck;

  const prefixBin = path.join(brewPrefix, 'bin');
  const prefixSbin = path.join(brewPrefix, 'sbin');
  const shimDir = path.dirname(shimCheck.path);
  if (shimDir !== prefixBin && shimDir !== prefixSbin) {
    return {
      ok: false,
      error: `${name} PATH entry must be in ${prefixBin} or ${prefixSbin} (got ${shimDir}).`,
    };
  }

  let canonicalPath;
  try {
    canonicalPath = await realpath(shimCheck.path);
  } catch (error) {
    return {
      ok: false,
      error: `Could not realpath ${name} at ${shimCheck.path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (!isPathUnderPrefix(canonicalPath, brewPrefix)) {
    return {
      ok: false,
      error: `${name} realpath (${canonicalPath}) is not under brew --prefix (${brewPrefix}).`,
    };
  }

  let st;
  try {
    st = await stat(canonicalPath);
  } catch (error) {
    return {
      ok: false,
      error: `Could not stat ${name} at ${canonicalPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  if (!st.isFile()) {
    return {
      ok: false,
      error: `${name} resolves to a non-file: ${canonicalPath}`,
    };
  }
  if (!(st.mode & 0o111)) {
    return {
      ok: false,
      error: `${name} is not executable: ${canonicalPath}`,
    };
  }

  return { ok: true, path: shimCheck.path, canonicalPath };
}

/**
 * Resolve Homebrew + Caddy for the LaunchAgent runtime environment.
 * Uses the interactive enable-time PATH to locate tools, then records a
 * launchd-safe PATH from the validated `brew --prefix` (Apple Silicon
 * `/opt/homebrew` or Intel `/usr/local` via brew itself — not hardcoded).
 *
 * PATH shims must sit in `prefix/bin` or `prefix/sbin`. Realpaths may point
 * into `Cellar/...` (standard Homebrew) as long as they stay under the prefix.
 *
 * @param {object} [opts]
 * @param {import('./exec.js').ExecFn} [opts.exec]
 * @param {(p: string) => Promise<string>} [opts.realpath]
 * @param {(p: string) => Promise<boolean>} [opts.pathExists]
 * @param {(p: string) => Promise<import('node:fs').Stats>} [opts.stat]
 * @returns {Promise<{
 *   ok: boolean,
 *   error?: string,
 *   brewPath?: string,
 *   caddyPath?: string,
 *   brewPrefix?: string,
 *   pathEnv?: string,
 * }>}
 */
export async function resolveAutostartRuntimeEnvironment(opts = {}) {
  const exec = opts.exec || defaultExec;
  const realpath =
    opts.realpath || ((p) => fs.realpath(p).then((r) => String(r)));
  const pathExists = opts.pathExists || ((p) => fs.pathExists(p));
  const stat = opts.stat || ((p) => fs.stat(p));

  const brewWhich = await resolveCommand('brew', exec);
  if (!brewWhich) {
    return {
      ok: false,
      error:
        'Homebrew `brew` not found. Install Homebrew and ensure it is on PATH before enabling autostart.',
    };
  }
  const brewShim = path.resolve(brewWhich);
  const brewShimCheck = await requireAbsoluteExistingPath(
    brewShim,
    'brew',
    pathExists
  );
  if (!brewShimCheck.ok) {
    return { ok: false, error: brewShimCheck.error };
  }

  let brewPrefix = '';
  try {
    // Invoke via the PATH shim (not Cellar realpath) — matches user `brew --prefix`.
    const { stdout } = await exec(brewShimCheck.path, ['--prefix']);
    brewPrefix = String(stdout || '').trim();
  } catch (error) {
    return {
      ok: false,
      error: `Could not read Homebrew prefix via brew --prefix: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  if (!brewPrefix || !path.isAbsolute(brewPrefix) || /[\r\n\0]/.test(brewPrefix)) {
    return {
      ok: false,
      error: `Invalid Homebrew prefix from brew --prefix: ${brewPrefix || '(empty)'}`,
    };
  }
  if (brewPrefix.includes(path.delimiter)) {
    return {
      ok: false,
      error: `Homebrew prefix contains PATH delimiter: ${brewPrefix}`,
    };
  }

  const prefixBin = path.join(brewPrefix, 'bin');
  if (!(await pathExists(prefixBin))) {
    return {
      ok: false,
      error: `Homebrew prefix bin directory does not exist: ${prefixBin}`,
    };
  }

  const brewTool = await validatePrefixPathTool({
    name: 'brew',
    shimPath: brewShimCheck.path,
    brewPrefix,
    realpath,
    pathExists,
    stat,
  });
  if (!brewTool.ok) {
    return { ok: false, error: brewTool.error };
  }

  const caddyWhich = await resolveCommand('caddy', exec);
  if (!caddyWhich) {
    return {
      ok: false,
      error:
        'Caddy not found. Run `stagepass setup` (or `brew install caddy`) before enabling autostart.',
    };
  }
  const caddyTool = await validatePrefixPathTool({
    name: 'caddy',
    shimPath: path.resolve(caddyWhich),
    brewPrefix,
    realpath,
    pathExists,
    stat,
  });
  if (!caddyTool.ok) {
    return { ok: false, error: caddyTool.error };
  }

  let pathEnv;
  try {
    pathEnv = buildAutostartPathEnv(brewPrefix);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    ok: true,
    brewPath: brewTool.path,
    caddyPath: caddyTool.path,
    brewPrefix,
    pathEnv,
  };
}

/**
 * @param {object} [opts]
 * @param {import('./exec.js').ExecFn} [opts.exec]
 * @param {number|string} [opts.uid]
 * @param {string} [opts.plistPath]
 */
export async function getAutostartStatus(opts = {}) {
  const exec = opts.exec || defaultExec;
  const uid = opts.uid ?? process.getuid?.() ?? os.userInfo().uid;
  const plistPath = opts.plistPath || getLaunchAgentPlistPath();
  const pathExists = opts.pathExists || ((p) => fs.pathExists(p));
  const plistExists = await pathExists(plistPath);

  let loaded = false;
  let printOutput = '';
  let printError = null;
  try {
    const result = await exec('launchctl', buildLaunchctlPrintArgs(uid));
    printOutput = result.stdout || '';
    loaded = true;
  } catch (error) {
    printError = error instanceof Error ? error.message : String(error);
    loaded = false;
  }

  return {
    label: LAUNCH_AGENT_LABEL,
    plistPath,
    plistExists,
    loaded,
    printOutput,
    printError,
    logsDir: getLogsDir(),
    caddyfilePath: getCaddyfilePath(),
  };
}

/**
 * Write plist (idempotent) and bootstrap the LaunchAgent.
 * @param {object} [opts]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 * @param {() => number} [opts.now]
 */
export async function enableAutostart(opts = {}) {
  const exec = opts.exec || defaultExec;
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now || Date.now;
  const uid = opts.uid ?? process.getuid?.() ?? os.userInfo().uid;
  const pathExists = opts.pathExists || ((p) => fs.pathExists(p));
  const paths =
    opts.paths ||
    (await resolveAutostartPaths({
      execPath: opts.execPath,
      argv1: opts.argv1,
      exec,
      realpath: opts.realpath,
      pathExists,
    }));

  if (!paths.ok) {
    return { ok: false, error: paths.error };
  }

  // Defense in depth when callers inject `paths` directly.
  if (!path.isAbsolute(paths.nodePath) || !path.isAbsolute(paths.cliPath)) {
    return {
      ok: false,
      error: 'Autostart nodePath and cliPath must be absolute.',
    };
  }
  if (!(await pathExists(paths.nodePath)) || !(await pathExists(paths.cliPath))) {
    return {
      ok: false,
      error: 'Autostart nodePath or cliPath does not exist on disk.',
    };
  }

  const runtime =
    opts.runtime ||
    (await resolveAutostartRuntimeEnvironment({
      exec,
      realpath: opts.realpath,
      pathExists,
    }));
  if (!runtime.ok || !runtime.pathEnv) {
    return {
      ok: false,
      error:
        runtime.error ||
        'Could not resolve Homebrew/Caddy paths for LaunchAgent PATH.',
    };
  }

  const plistPath = opts.plistPath || getLaunchAgentPlistPath();
  const agentsDir = path.dirname(plistPath);
  const ensureDir = opts.ensureDir || ((p) => fs.ensureDir(p));
  const writeFile = opts.writeFile || ((p, c) => fs.writeFile(p, c, 'utf8'));
  const logsDir = opts.logsDir || getLogsDir();

  // Write only after node/cli + Homebrew/Caddy prerequisites validate.
  await ensureDir(agentsDir);
  await ensureDir(logsDir);

  const plist = renderLaunchAgentPlist({
    nodePath: paths.nodePath,
    cliPath: paths.cliPath,
    pathEnv: runtime.pathEnv,
    stdoutPath: opts.stdoutPath || getDaemonStdoutLogPath(),
    stderrPath: opts.stderrPath || getDaemonStderrLogPath(),
    workingDirectory: opts.workingDirectory || os.homedir(),
  });

  await writeFile(plistPath, plist);

  // bootout returns before launchd drops the job; bootstrap then hits error 5.
  let unloaded = false;
  try {
    await exec('launchctl', buildLaunchctlBootoutArgs(uid));
    unloaded = true;
  } catch {
    // not loaded yet: one bootstrap, no wait
  }
  if (unloaded) {
    const until = now() + 3000;
    for (let i = 0; i < 60 && now() < until; i++) {
      try {
        await exec('launchctl', buildLaunchctlPrintArgs(uid));
      } catch {
        break;
      }
      await sleep(50);
    }
  }

  let bootErr = null;
  for (let n = 0, tries = unloaded ? 3 : 1; n < tries; n++) {
    try {
      await exec('launchctl', buildLaunchctlBootstrapArgs(uid, plistPath));
      bootErr = null;
      break;
    } catch (error) {
      bootErr = error;
      const msg = `${error instanceof Error ? error.message : error} ${error?.stderr || ''}`;
      const race =
        error?.code === 5 ||
        /Input\/output error|Bootstrap failed: 5/.test(msg);
      if (!race || n + 1 === tries) break;
      await sleep(100);
    }
  }
  if (bootErr) {
    return {
      ok: false,
      error: bootErr instanceof Error ? bootErr.message : String(bootErr),
      plistPath,
      paths,
    };
  }

  return { ok: true, plistPath, paths, runtime, error: null };
}

/**
 * Bootout and remove the LaunchAgent plist.
 * @param {object} [opts]
 */
export async function disableAutostart(opts = {}) {
  const exec = opts.exec || defaultExec;
  const uid = opts.uid ?? process.getuid?.() ?? os.userInfo().uid;
  const plistPath = opts.plistPath || getLaunchAgentPlistPath();
  const pathExists = opts.pathExists || ((p) => fs.pathExists(p));
  const remove = opts.remove || ((p) => fs.remove(p));

  try {
    await exec('launchctl', buildLaunchctlBootoutArgs(uid));
  } catch {
    // ignore if not loaded
  }

  if (await pathExists(plistPath)) {
    await remove(plistPath);
  }

  return { ok: true, plistPath };
}

export { LAUNCH_AGENT_LABEL, getLaunchAgentPlistPath, getLaunchAgentsDir };
