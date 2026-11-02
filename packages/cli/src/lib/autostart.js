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
 * @param {object} opts
 * @param {string} opts.nodePath
 * @param {string} opts.cliPath
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
  const nodePath = nodeCheck.path;

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

  return { ok: true, nodePath, cliPath: cliCheck.path, error: null };
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
 */
export async function enableAutostart(opts = {}) {
  const exec = opts.exec || defaultExec;
  const uid = opts.uid ?? process.getuid?.() ?? os.userInfo().uid;
  const paths =
    opts.paths ||
    (await resolveAutostartPaths({
      execPath: opts.execPath,
      argv1: opts.argv1,
      exec,
      realpath: opts.realpath,
      pathExists: opts.pathExists,
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
  const pathExists = opts.pathExists || ((p) => fs.pathExists(p));
  if (!(await pathExists(paths.nodePath)) || !(await pathExists(paths.cliPath))) {
    return {
      ok: false,
      error: 'Autostart nodePath or cliPath does not exist on disk.',
    };
  }

  const plistPath = opts.plistPath || getLaunchAgentPlistPath();
  const agentsDir = path.dirname(plistPath);
  const ensureDir = opts.ensureDir || ((p) => fs.ensureDir(p));
  const writeFile = opts.writeFile || ((p, c) => fs.writeFile(p, c, 'utf8'));
  const logsDir = opts.logsDir || getLogsDir();

  await ensureDir(agentsDir);
  await ensureDir(logsDir);

  const plist = renderLaunchAgentPlist({
    nodePath: paths.nodePath,
    cliPath: paths.cliPath,
    stdoutPath: opts.stdoutPath || getDaemonStdoutLogPath(),
    stderrPath: opts.stderrPath || getDaemonStderrLogPath(),
    workingDirectory: opts.workingDirectory || os.homedir(),
  });

  await writeFile(plistPath, plist);

  // Idempotent: bootout if already loaded, then bootstrap.
  try {
    await exec('launchctl', buildLaunchctlBootoutArgs(uid));
  } catch {
    // not loaded yet
  }

  try {
    await exec('launchctl', buildLaunchctlBootstrapArgs(uid, plistPath));
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      plistPath,
      paths,
    };
  }

  return { ok: true, plistPath, paths, error: null };
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
