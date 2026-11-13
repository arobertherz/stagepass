import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const script = 'packages/cli/src/lib/__tests__/php-security-behaviour.php';

function canRun(command, args) {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasPhp = canRun('php', ['-r', 'echo PHP_VERSION;']);
const hasDocker = !hasPhp && canRun('docker', ['info']);

describe.skipIf(!hasPhp && !hasDocker)('php security behaviour', () => {
  it('rate limit storage faults and trusted proxy client IPs', () => {
    const out = hasPhp
      ? execFileSync('php', [path.join(repoRoot, script)], { encoding: 'utf8' })
      : execFileSync(
          'docker',
          ['run', '--rm', '-v', `${repoRoot}:/src:ro`, '-w', '/src', 'php:8.2-cli', 'php', script],
          { encoding: 'utf8', timeout: 120000 }
        );
    expect(out).toContain('php-security: ok');
  }, 180000);
});
