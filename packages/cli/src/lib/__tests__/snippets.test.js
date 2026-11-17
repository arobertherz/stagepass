import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  SNIPPET_LOADER_VERSION,
  SNIPPET_MODULES_VERSION,
  STAGEPASS_PACKAGE_CDN,
  stagepassPackageUrl,
} from '../cdn-base.js';
import { defaultTemplatesRoot, planScaffoldFiles } from '../scaffold.js';
import {
  buildOfficialHeadSnippets,
  buildWebflowSnippets,
  printWebflowHeadSnippets,
  printWebflowSnippets,
  readSnippetGitRef,
  sanitizeSnippetToken,
  sanitizeSnippetVersion,
} from '../snippets.js';

async function readTemplate(rel) {
  return fs.readFile(path.join(defaultTemplatesRoot(), rel), 'utf8');
}

function scaffoldOptions(extra = {}) {
  return {
    name: 'demo',
    dir: '/tmp/demo',
    lang: 'js',
    styles: 'css',
    modules: false,
    siteModules: [],
    php: false,
    install: false,
    dryRun: true,
    ...extra,
  };
}

describe('sanitizeSnippetVersion', () => {
  it('accepts semver and optional range prefixes', () => {
    expect(sanitizeSnippetVersion('2.0.0')).toBe('2.0.0');
    expect(sanitizeSnippetVersion('^2.1.0')).toBe('^2.1.0');
    expect(sanitizeSnippetVersion('~2.0.0')).toBe('~2.0.0');
  });

  it('rejects HTML / quote injection', () => {
    expect(() => sanitizeSnippetVersion('2"><img src=x onerror=alert(1)>')).toThrow(
      /Invalid version/
    );
    expect(() => sanitizeSnippetVersion('2.0.0</script>')).toThrow(/Invalid version/);
  });
});

describe('buildWebflowSnippets', () => {
  it('uses jsDelivr @2 loader and optional module dist paths', () => {
    const withModules = buildWebflowSnippets({ version: '2.0.0', modules: true });
    expect(withModules.head).toContain(
      'cdn.jsdelivr.net/npm/@stagepass/loader@2/dist/loader.min.js'
    );
    expect(withModules.head).toContain(
      'cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/inject.min.js'
    );
    expect(withModules.head).toContain(
      'cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/cookies.min.js'
    );
    expect(withModules.head).not.toContain('unpkg.com');
    expect(withModules.head).toContain('data-stagepass-version="2.0.0"');

    const without = buildWebflowSnippets({ version: '2.0.0', modules: false });
    expect(without.head).not.toContain('@stagepass/modules');
    expect(STAGEPASS_PACKAGE_CDN).toBe('https://cdn.jsdelivr.net/npm');
    expect(STAGEPASS_PACKAGE_CDN).not.toContain('stagepass.one');
    expect(withModules.head).toContain(stagepassPackageUrl('loader', '@2', 'loader.min.js'));
    expect(withModules.head).not.toContain('stagepass.one');
  });

  it('uses a jsDelivr GitHub URL for an https origin', () => {
    const snippets = buildWebflowSnippets({
      version: '2.0.0',
      gitRemote: 'https://github.com/acme/widgets.git',
      gitBranch: 'develop',
    });
    expect(snippets.footer).toContain(
      'https://cdn.jsdelivr.net/gh/acme/widgets@develop/dist/main.js'
    );
    expect(snippets.footer).toContain(
      'https://cdn.jsdelivr.net/gh/acme/widgets@develop/dist/styles.css'
    );
    expect(snippets.footer).toContain('jsDelivr only serves public repos');
    expect(snippets.footer).toContain('better production pin than a branch');
    expect(snippets.footer).toContain('commit the dist folder');
    expect(snippets.footer).toContain('dist/manifest.json');
    expect(snippets.footer).not.toContain('YOUR-PRODUCTION-URL');
    expect(snippets.footer).not.toContain('cdn.example.com');
  });

  it('accepts ssh origins and falls back to main', () => {
    const scp = buildWebflowSnippets({
      version: '2.0.0',
      gitRemote: 'git@github.com:acme/my_repo.git',
    });
    expect(scp.footer).toContain(
      'https://cdn.jsdelivr.net/gh/acme/my_repo@main/dist/main.js'
    );
    expect(scp.footer).toContain(
      'https://cdn.jsdelivr.net/gh/acme/my_repo@main/dist/styles.css'
    );

    const sshUrl = buildWebflowSnippets({
      version: '2.0.0',
      gitRemote: 'ssh://git@github.com/acme/widgets.git',
      gitBranch: 'release/cli-2.5.0',
    });
    expect(sshUrl.footer).toContain(
      'https://cdn.jsdelivr.net/gh/acme/widgets@release/cli-2.5.0/dist/main.js'
    );
  });

  it('uses a production placeholder when there is no remote', () => {
    const snippets = buildWebflowSnippets({ version: '2.0.0' });
    expect(snippets.footer).toContain('https://YOUR-PRODUCTION-URL/js/main.js');
    expect(snippets.footer).toContain('https://YOUR-PRODUCTION-URL/css/styles.css');
    expect(snippets.footer).toContain('Replace YOUR-PRODUCTION-URL');
    expect(snippets.footer).not.toContain('cdn.jsdelivr.net/gh/');
    expect(snippets.footer).not.toContain('cdn.example.com');
  });

  it('ignores a non-GitHub remote', () => {
    const snippets = buildWebflowSnippets({
      version: '2.0.0',
      gitRemote: 'https://gitlab.com/acme/widgets.git',
      gitBranch: 'develop',
    });
    expect(snippets.footer).toContain('https://YOUR-PRODUCTION-URL/js/main.js');
    expect(snippets.footer).not.toContain('gitlab.com');
    expect(snippets.footer).not.toContain('cdn.jsdelivr.net/gh/');
  });

  it('rejects a malicious repo name instead of writing it into the snippet', () => {
    const payload = 'foo"><img src=x onerror=alert(1)>';
    expect(() => sanitizeSnippetToken(payload)).toThrow(/Invalid name/);
    expect(() => sanitizeSnippetVersion(payload)).toThrow(/Invalid version/);
    expect(() =>
      buildWebflowSnippets({
        version: '2.0.0',
        gitRemote: `https://github.com/acme/${payload}.git`,
      })
    ).toThrow(/Invalid name/);
    expect(() =>
      buildWebflowSnippets({
        version: '2.0.0',
        gitRemote: `git@github.com:acme/${payload}.git`,
      })
    ).toThrow(/Invalid name/);
  });

  it('falls back to main when the branch is not a safe token', () => {
    const snippets = buildWebflowSnippets({
      version: '2.0.0',
      gitRemote: 'https://github.com/acme/widgets.git',
      gitBranch: 'feat/"><script>',
    });
    expect(snippets.footer).toContain(
      'https://cdn.jsdelivr.net/gh/acme/widgets@main/dist/main.js'
    );
    expect(snippets.footer).not.toContain('feat/');
    expect(snippets.footer).not.toContain('"><');
  });
});

describe('official head snippets', () => {
  function printed(moduleList) {
    const lines = [];
    const snippets = buildOfficialHeadSnippets({ moduleList });
    printWebflowHeadSnippets(snippets, (msg) => lines.push(String(msg)));
    return lines.join('\n');
  }

  it('prints loader and module tags from the package CDN', () => {
    const text = printed(['all']);
    expect(text).toContain('Webflow Custom Code (Head):');
    expect(text).toContain(stagepassPackageUrl('loader', '@2', 'loader.min.js'));
    const inject = text.indexOf(stagepassPackageUrl('modules', '@2', 'inject.min.js'));
    const cookies = text.indexOf(stagepassPackageUrl('modules', '@2', 'cookies.min.js'));
    const maintenance = text.indexOf(stagepassPackageUrl('modules', '@2', 'maintenance.min.js'));
    expect(inject).toBeGreaterThan(-1);
    expect(cookies).toBeGreaterThan(inject);
    expect(maintenance).toBeGreaterThan(cookies);
    expect(text).toContain(`data-stagepass-version="${SNIPPET_LOADER_VERSION}"`);
    expect(text).toContain(`loader @${SNIPPET_LOADER_VERSION}`);
    expect(text).toContain(`modules @${SNIPPET_MODULES_VERSION}`);
    expect(text).not.toContain('Webflow Custom Code (Footer):');
    expect(text).not.toContain('all.min.js');
    expect(text).not.toContain('stagepass.one');
  });

  it('reads snippet pins from cdn-base literals, not the CLI package.json', async () => {
    expect(SNIPPET_LOADER_VERSION).toBe('2.5.0');
    expect(SNIPPET_MODULES_VERSION).toBe('2.2.2');
    const pins = await fs.readFile(new URL('../cdn-base.js', import.meta.url), 'utf8');
    expect(pins).not.toMatch(/package\.json/);
    expect(pins).toContain("export const SNIPPET_LOADER_VERSION = '2.5.0';");
    expect(pins).toContain("export const SNIPPET_MODULES_VERSION = '2.2.2';");
    const builder = await fs.readFile(new URL('../snippets.js', import.meta.url), 'utf8');
    expect(builder).toContain('SNIPPET_LOADER_VERSION');
    expect(builder).toContain('SNIPPET_MODULES_VERSION');
    expect(builder).not.toMatch(/package\.json/);
    expect(builder).not.toMatch(/\bLOADER_VERSION\b/);

    const lines = [];
    const snippets = buildWebflowSnippets({ moduleList: ['cookies'] });
    printWebflowSnippets(snippets, (msg) => lines.push(String(msg)));
    const text = lines.join('\n');
    expect(snippets.head).toContain(`data-stagepass-version="${SNIPPET_LOADER_VERSION}"`);
    expect(snippets.head).toContain(stagepassPackageUrl('modules', '@2', 'cookies.min.js'));
    expect(snippets.head).not.toContain('inject.min.js');
    expect(text).toContain(`loader @${SNIPPET_LOADER_VERSION}`);
    expect(text).toContain(`modules @${SNIPPET_MODULES_VERSION}`);
  });

  it('prints only the declared module, in inject, cookies, maintenance order', () => {
    const only = printed(['cookies']);
    expect(only).toContain(stagepassPackageUrl('loader', '@2', 'loader.min.js'));
    expect(only).toContain(stagepassPackageUrl('modules', '@2', 'cookies.min.js'));
    expect(only).not.toContain('inject.min.js');
    expect(only).not.toContain('maintenance.min.js');

    const several = printed(['maintenance', 'inject']);
    const inject = several.indexOf('inject.min.js');
    const maintenance = several.indexOf('maintenance.min.js');
    expect(inject).toBeGreaterThan(-1);
    expect(maintenance).toBeGreaterThan(inject);
    expect(several).not.toContain('cookies.min.js');
  });

  it('prints the loader only when no modules are declared', () => {
    for (const moduleList of [[], undefined]) {
      const text = printed(moduleList);
      expect(text).toContain(stagepassPackageUrl('loader', '@2', 'loader.min.js'));
      expect(text).not.toContain('@stagepass/modules');
      expect(text).not.toContain('Webflow Custom Code (Footer):');
    }
  });
});

describe('readSnippetGitRef', () => {
  it('reads origin and the current branch', async () => {
    const ref = await readSnippetGitRef('/proj', async (file, args) => {
      expect(file).toBe('git');
      if (args[0] === 'remote') return { stdout: 'git@github.com:acme/widgets.git\n' };
      if (args[0] === 'symbolic-ref') return { stdout: 'release/cli-2.5.0\n' };
      throw new Error(`unexpected ${args.join(' ')}`);
    });
    expect(ref).toEqual({
      gitRemote: 'git@github.com:acme/widgets.git',
      gitBranch: 'release/cli-2.5.0',
    });
  });

  it('uses main when git has no branch', async () => {
    const ref = await readSnippetGitRef('/proj', async () => {
      throw new Error('not a repo');
    });
    expect(ref).toEqual({ gitRemote: '', gitBranch: 'main' });
  });

  it('falls back to branch --show-current when symbolic-ref fails', async () => {
    const ref = await readSnippetGitRef('/proj', async (file, args) => {
      expect(file).toBe('git');
      if (args[0] === 'remote') return { stdout: 'https://github.com/acme/widgets.git\n' };
      if (args[0] === 'symbolic-ref') throw new Error('detached');
      if (args[0] === 'branch' && args[1] === '--show-current') return { stdout: 'hotfix\n' };
      throw new Error(`unexpected ${args.join(' ')}`);
    });
    expect(ref).toEqual({
      gitRemote: 'https://github.com/acme/widgets.git',
      gitBranch: 'hotfix',
    });
  });
});

describe('readSnippetGitRef with a real git repo', () => {
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: 'Stagepass Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Stagepass Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };

  function git(cwd, args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8', env: gitEnv });
  }

  function makeRepo() {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'sp-gitref-'));
    git(dir, ['init', '-b', 'main']);
    git(dir, ['config', 'user.name', 'Stagepass Test']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['remote', 'add', 'origin', 'https://github.com/acme/widgets.git']);
    return dir;
  }

  it('reads the current branch in a repo with no commits', async () => {
    const dir = makeRepo();
    try {
      git(dir, ['checkout', '-b', 'develop']);
      const ref = await readSnippetGitRef(dir);
      expect(ref).toEqual({
        gitRemote: 'https://github.com/acme/widgets.git',
        gitBranch: 'develop',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a normal branch after a commit', async () => {
    const dir = makeRepo();
    try {
      writeFileSync(path.join(dir, 'README.md'), 'ok\n');
      git(dir, ['add', 'README.md']);
      git(dir, ['commit', '-m', 'init']);
      git(dir, ['checkout', '-b', 'feature/footer']);
      const ref = await readSnippetGitRef(dir);
      expect(ref).toEqual({
        gitRemote: 'https://github.com/acme/widgets.git',
        gitBranch: 'feature/footer',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to main on a detached HEAD', async () => {
    const dir = makeRepo();
    try {
      writeFileSync(path.join(dir, 'README.md'), 'ok\n');
      git(dir, ['add', 'README.md']);
      git(dir, ['commit', '-m', 'init']);
      git(dir, ['checkout', '--detach']);
      const ref = await readSnippetGitRef(dir);
      expect(ref).toEqual({
        gitRemote: 'https://github.com/acme/widgets.git',
        gitBranch: 'main',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('project README asset URLs', () => {
  it('writes a jsDelivr GitHub URL when new has a GitHub remote', async () => {
    const files = await planScaffoldFiles(
      scaffoldOptions({ git: true, remote: 'https://github.com/acme/widgets.git' }),
      { readTemplate }
    );
    const readme = files.find((file) => file.relativePath === 'README.md').contents;
    expect(readme).toContain('https://cdn.jsdelivr.net/gh/acme/widgets@main/dist/main.js');
    expect(readme).toContain('https://cdn.jsdelivr.net/gh/acme/widgets@main/dist/styles.css');
    expect(readme).toContain(
      'https://cdn.jsdelivr.net/gh/acme/widgets@main/dist/main.a1b2c3d4.js'
    );
    expect(readme).toContain('public repos');
    expect(readme).not.toContain('cdn.example.com');
  });

  it('writes a production placeholder when git is not initialized', async () => {
    const files = await planScaffoldFiles(scaffoldOptions({ git: false }), { readTemplate });
    const readme = files.find((file) => file.relativePath === 'README.md').contents;
    expect(readme).toContain('https://YOUR-PRODUCTION-URL/js/main.js');
    expect(readme).toContain('https://YOUR-PRODUCTION-URL/css/styles.css');
    expect(readme).toContain('https://YOUR-PRODUCTION-URL/demo/main.a1b2c3d4.js');
    expect(readme).toContain('Replace YOUR-PRODUCTION-URL');
    expect(readme).not.toContain('cdn.example.com');
    expect(readme).not.toContain('cdn.jsdelivr.net/gh/');
  });

  it('does not treat a non-GitHub remote as jsDelivr', async () => {
    const files = await planScaffoldFiles(
      scaffoldOptions({ git: true, remote: 'git@gitlab.com:acme/widgets.git' }),
      { readTemplate }
    );
    const readme = files.find((file) => file.relativePath === 'README.md').contents;
    expect(readme).toContain('YOUR-PRODUCTION-URL');
    expect(readme).not.toContain('gitlab.com');
    expect(readme).not.toContain('cdn.jsdelivr.net/gh/');
  });

  it('refuses a malicious repo name before writing the README', async () => {
    await expect(
      planScaffoldFiles(
        scaffoldOptions({
          git: true,
          remote: 'https://github.com/acme/foo"><img>.git',
        }),
        { readTemplate }
      )
    ).rejects.toThrow(/Invalid name/);
  });
});
