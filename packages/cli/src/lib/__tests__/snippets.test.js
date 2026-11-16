import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { STAGEPASS_PACKAGE_CDN, stagepassPackageUrl } from '../cdn-base.js';
import { defaultTemplatesRoot, planScaffoldFiles } from '../scaffold.js';
import {
  buildOfficialHeadSnippets,
  buildWebflowSnippets,
  printWebflowHeadSnippets,
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
    loaderVersion: '2.5.0',
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
  it('prints loader and module tags from the package CDN', () => {
    const lines = [];
    const snippets = buildOfficialHeadSnippets({ version: '2.5.0' });
    printWebflowHeadSnippets(snippets, (msg) => lines.push(String(msg)));
    const text = lines.join('\n');
    expect(text).toContain('Webflow Custom Code (Head):');
    expect(text).toContain(stagepassPackageUrl('loader', '@2', 'loader.min.js'));
    expect(text).toContain(stagepassPackageUrl('modules', '@2', 'inject.min.js'));
    expect(text).toContain(stagepassPackageUrl('modules', '@2', 'cookies.min.js'));
    expect(text).toContain(stagepassPackageUrl('modules', '@2', 'maintenance.min.js'));
    expect(text).toContain('data-stagepass-version="2.5.0"');
    expect(text).not.toContain('Webflow Custom Code (Footer):');
    expect(text).not.toContain('stagepass.one');
  });
});

describe('readSnippetGitRef', () => {
  it('reads origin and the current branch', async () => {
    const ref = await readSnippetGitRef('/proj', async (file, args) => {
      expect(file).toBe('git');
      if (args[0] === 'remote') return { stdout: 'git@github.com:acme/widgets.git\n' };
      if (args[0] === 'rev-parse') return { stdout: 'release/cli-2.5.0\n' };
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
