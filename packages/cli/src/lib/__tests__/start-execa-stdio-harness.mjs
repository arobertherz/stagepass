/**
 * Bounded harness: execa@8 + logfile FD mimicking public `stagepass start`.
 * Args: --caddy=<path> --log=<path>
 */
import { execa } from 'execa';
import fs from 'node:fs';

function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const arg of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(arg);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const fake = args.caddy;
const logFile = args.log;
if (!fake || !logFile) {
  console.error('usage: --caddy= --log=');
  process.exit(2);
}

const logFd = fs.openSync(logFile, 'w');
try {
  await execa(fake, ['stop']).catch(() => {});
  await execa(fake, ['start', '--config', 'x'], {
    stdio: ['ignore', logFd, logFd],
  });
  process.stdout.write('START_FD_OK\n');
} finally {
  try {
    fs.closeSync(logFd);
  } catch {
    /* ignore */
  }
}
