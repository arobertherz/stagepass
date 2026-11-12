import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyTemplate } from '../../lib/scaffold.js';
import {
  defaultBuildScriptTemplatePath,
  renderCurrentBuildScript,
} from '../../lib/build-script-upgrade.js';
import { SKIP_PLATFORM_CHECK_ENV } from '../../lib/platform.js';

const binPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../bin/index.js');
const oldTemplate = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../lib/__tests__/fixtures/build-scripts/2.3.0.mjs'
);

describe('upgrade fixture project with an old scripts/build.mjs', () => {
  /** @type {string[]} */
  const dirs = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('replaces the unmodified 2.3.0 scaffold and keeps the project entry paths', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-upgrade-int-'));
    dirs.push(home);
    const binDir = path.join(home, 'bin');
    const project = path.join(home, 'app');
    fs.mkdirSync(binDir, { recursive: true });
    fs.mkdirSync(path.join(project, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(binDir, 'npm'),
      `#!/bin/sh
pkg=""
for arg in "$@"; do
  case "$arg" in
    @stagepass/*) pkg="$arg" ;;
  esac
done
if [ "$pkg" = "@stagepass/modules" ]; then
  printf '%s\\n' '{"dist-tags":{"latest":"2.2.2"},"versions":["2.2.0","2.2.2"]}'
else
  printf '%s\\n' '{"dist-tags":{"latest":"2.4.0"},"versions":["2.2.0","2.4.0"]}'
fi
`,
      { mode: 0o755 }
    );

    const preset = { ENTRY_JS: 'src/main.ts', ENTRY_CSS: 'src/styles.scss', USE_SASS: 'true' };
    const oldScript = applyTemplate(fs.readFileSync(oldTemplate, 'utf8'), preset);
    fs.writeFileSync(path.join(project, 'scripts', 'build.mjs'), oldScript);
    fs.writeFileSync(
      path.join(project, 'package.json'),
      `${JSON.stringify(
        {
          name: 'app',
          private: true,
          devDependencies: { '@stagepass/loader': '^2.2.0', '@stagepass/modules': '^2.2.0' },
        },
        null,
        2
      )}\n`
    );
    fs.writeFileSync(
      path.join(project, 'stagepass.json'),
      `${JSON.stringify({ name: 'app', modules: [], version: 1 }, null, 2)}\n`
    );

    const result = spawnSync(
      process.execPath,
      [binPath, 'upgrade', '--yes', '--skip-site', '--site-modules', 'none'],
      {
        cwd: project,
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: home,
          PATH: `${binDir}${path.delimiter}${process.env.PATH || ''}`,
          [SKIP_PLATFORM_CHECK_ENV]: '1',
        },
      }
    );

    const text = `${result.stdout}\n${result.stderr}`.replace(/\u001b\[[0-9;]*m/g, '');
    expect(result.status, text).toBe(0);
    expect(text).toContain('scripts/build.mjs: replace unmodified scaffold (2.3.0)');
    const current = fs.readFileSync(defaultBuildScriptTemplatePath(), 'utf8');
    const written = fs.readFileSync(path.join(project, 'scripts', 'build.mjs'), 'utf8');
    expect(written).toBe(renderCurrentBuildScript(current, oldScript));
    expect(written).toContain("|| 'src/main.ts'");
    expect(written).toContain("|| 'src/styles.scss'");
    expect(written).toContain('manifestEntryName');
    expect(written).not.toBe(oldScript);
  });
});
