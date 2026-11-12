import { describe, it, expect, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { createNew, resolveNewOptions } from '../new.js';
import { dev } from '../dev.js';
import { watch } from '../npm-run.js';
import { defaultTemplatesRoot } from '../../lib/scaffold.js';
import { saveProjects } from '../../lib/projects.js';

const templates = defaultTemplatesRoot();

function deps(tmp, extra = {}) {
  return {
    isTTY: false,
    argv: extra.argv || ['--yes', '--no-git', '--php'],
    templatesRoot: templates,
    cwd: tmp,
    platform: 'darwin',
    log: extra.log || (() => {}),
    error: extra.error || (() => {}),
    exec: extra.exec || vi.fn(async () => ({ stdout: '', stderr: '' })),
    resolveCommand: extra.resolveCommand,
    spawn: vi.fn(),
    fetchPublished: vi.fn(async () => ({ distTags: { latest: '2.5.0' }, versions: ['2.5.0'] })),
    detectSite: vi.fn(),
    ...extra,
  };
}

describe('cli-php new', () => {
  it('cli-php: wizard asks PHP when interactive, including after site detection', async () => {
    const questions = [];
    const rl = {
      question: async (q) => {
        questions.push(String(q));
        if (String(q).includes('Enable PHP')) return 'y';
        if (String(q).includes('detected')) return 'y';
        return 'n';
      },
      close() {},
    };
    const detected = await resolveNewOptions('shop', {
      dir: 'shop',
      author: 'Ada',
      lang: 'ts',
      styles: 'scss',
      staging: 'shop.webflow.io',
      production: 'www.example.com',
    }, {
      isTTY: true,
      argv: [],
      exec: async () => ({ stdout: '' }),
      log: () => {},
      createReadline: () => rl,
      detectSite: async () => ({
        ok: true,
        loader: { version: '2.5.0', cdn: 'jsdelivr' },
        modules: [{ id: 'cookies', version: '2.5.0', cdn: 'jsdelivr' }],
        list: ['cookies'],
      }),
    });
    expect(detected.ok).toBe(true);
    expect(detected.config.php).toBe(true);
    expect(detected.config.siteModules).toEqual(['cookies']);
    expect(questions.filter((q) => q.includes('Enable PHP'))).toHaveLength(1);
    expect(questions.join('\n')).not.toMatch(/examples\/php/);

    const flagged = [];
    const flaggedRl = {
      question: async (q) => {
        flagged.push(String(q));
        return 'n';
      },
      close() {},
    };
    const preset = await resolveNewOptions('shop', {
      dir: 'shop',
      author: 'Ada',
      lang: 'js',
      styles: 'css',
      staging: 'shop.webflow.io',
      siteModules: 'none',
    }, {
      isTTY: true,
      argv: ['--php'],
      exec: async () => ({ stdout: '' }),
      log: () => {},
      createReadline: () => flaggedRl,
    });
    expect(preset.config.php).toBe(true);
    expect(flagged.join('\n')).not.toMatch(/Enable PHP/);

    const skipped = await resolveNewOptions('shop', {
      yes: true,
      dir: 'shop',
      author: 'Ada',
      lang: 'ts',
      styles: 'scss',
      siteModules: 'none',
    }, {
      isTTY: true,
      argv: ['--yes'],
      exec: async () => ({ stdout: '' }),
      log: () => {},
      createReadline: () => {
        throw new Error('wizard should not run under --yes');
      },
    });
    expect(skipped.config.php).toBe(false);
  });

  it('cli-php: --php writes the boilerplate and never a real .env', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-php-new-'));
    const target = path.join(tmp, 'php-app');
    const logs = [];
    try {
      const code = await createNew('php-app', {
        yes: true,
        dir: target,
        git: false,
        lang: 'js',
        styles: 'css',
        siteModules: 'none',
      }, deps(tmp, { log: (m) => logs.push(String(m)) }));
      expect(code).toBe(0);
      const action = await fs.readFile(path.join(target, 'api/action.php'));
      const template = await fs.readFile(path.join(templates, 'api/action.php'));
      expect(action.equals(template)).toBe(true);
      const contact = await fs.readFile(path.join(target, 'api/actions/contact.php'), 'utf8');
      expect(contact).not.toMatch(/\bmail\s*\(/);
      expect(await fs.pathExists(path.join(target, '.env'))).toBe(false);
      expect(await fs.pathExists(path.join(target, 'api/.env'))).toBe(false);
      const ignore = await fs.readFile(path.join(target, '.gitignore'), 'utf8');
      expect(ignore).toContain('.env');
      expect(ignore).toContain('.php/rate-limit/');
      expect(ignore).toContain('.php/*.log');
      expect(ignore).toContain('.php/server-*.pid');
      const joined = logs.join('\n');
      expect(joined).toContain('brew install php');
      expect(joined).toContain('brew services start php');
      expect(joined).toContain('https://php-app.sp');
      expect(joined).toContain('JavaScript build and live reload will continue.');
    } finally {
      await fs.remove(tmp);
    }
  });

  it('cli-php: --no-php writes no api boilerplate', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-php-off-'));
    const target = path.join(tmp, 'static-app');
    try {
      const code = await createNew('static-app', {
        yes: true,
        dir: target,
        git: false,
        lang: 'js',
        styles: 'css',
        siteModules: 'none',
      }, deps(tmp, { argv: ['--yes', '--no-git', '--no-php'] }));
      expect(code).toBe(0);
      expect(await fs.pathExists(path.join(target, 'api/action.php'))).toBe(false);
      expect(await fs.pathExists(path.join(target, '.php/config.php'))).toBe(false);
      const sp = await fs.readJson(path.join(target, 'stagepass.json'));
      expect(sp.php).toBe(false);
    } finally {
      await fs.remove(tmp);
    }
  });

  it('[F-11] new --php does not write through a parent symlink outside the project', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-php-f11-'));
    const target = path.join(tmp, 'php-app');
    const outside = path.join(tmp, 'outside');
    const errors = [];
    try {
      await fs.ensureDir(outside);
      await fs.writeFile(path.join(outside, 'keep.txt'), 'keep');
      let swapped = false;
      const wrapped = Object.assign(Object.create(fs), {
        mkdir: async (dir, opts) => {
          if (!swapped && path.basename(String(dir)) === 'api') {
            swapped = true;
            await fs.symlink(outside, dir);
            return;
          }
          return fs.mkdir(dir, opts);
        },
      });
      const code = await createNew('php-app', {
        yes: true,
        dir: target,
        git: false,
        lang: 'js',
        styles: 'css',
        siteModules: 'none',
      }, deps(tmp, {
        fs: wrapped,
        error: (m) => errors.push(String(m)),
      }));
      expect(swapped).toBe(true);
      expect(code).toBe(1);
      expect(errors.join('\n')).toMatch(/Refusing to write outside project directory/);
      expect(await fs.readdir(outside)).toEqual(['keep.txt']);
      expect(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8')).toBe('keep');
    } finally {
      await fs.remove(tmp);
    }
  });

  it('cli-php: refuses to overwrite an existing PHP file and reports it', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-php-keep-'));
    const target = path.join(tmp, 'php-app');
    const errors = [];
    try {
      await fs.ensureDir(path.join(target, 'api'));
      await fs.writeFile(path.join(target, 'api/action.php'), 'KEEP');
      const code = await createNew('php-app', {
        yes: true,
        dir: target,
        git: false,
        lang: 'js',
        styles: 'css',
        siteModules: 'none',
      }, deps(tmp, { error: (m) => errors.push(String(m)) }));
      expect(code).toBe(1);
      expect(errors.join('\n')).toMatch(/Refusing to overwrite/);
      expect(errors.join('\n')).toContain('api/action.php');
      expect(await fs.readFile(path.join(target, 'api/action.php'), 'utf8')).toBe('KEEP');
      expect(await fs.pathExists(path.join(target, 'package.json'))).toBe(false);
    } finally {
      await fs.remove(tmp);
    }
  });

  it('cli-php: an old interpreter warns and the project is still created', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-php-old-'));
    const target = path.join(tmp, 'php-app');
    const logs = [];
    try {
      const code = await createNew('php-app', {
        yes: true,
        dir: target,
        git: false,
        lang: 'js',
        styles: 'css',
        siteModules: 'none',
      }, deps(tmp, {
        log: (m) => logs.push(String(m)),
        platform: 'linux',
        resolveCommand: async (name) => (name === 'php' || name === 'php-fpm' ? `/usr/bin/${name}` : null),
        exec: async () => ({ stdout: 'PHP 8.1.2 (cli)\n', stderr: '' }),
      }));
      expect(code).toBe(0);
      expect(await fs.pathExists(path.join(target, 'api/action.php'))).toBe(true);
      const joined = logs.join('\n');
      expect(joined).toContain('PHP 8.1.2 is older than 8.2');
      expect(joined).toMatch(/apt install php-fpm/);
      expect(joined).toContain('JavaScript build and live reload will continue.');
    } finally {
      await fs.remove(tmp);
    }
  });
});

describe('cli-php dev and watch warnings', () => {
  it('cli-php: dev warns when PHP is missing and still runs the JS watch', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-php-dev-'));
    const root = path.join(tmp, 'app');
    const logs = [];
    try {
      await fs.ensureDir(root);
      await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { watch: 'echo watch' } }));
      await fs.writeJson(path.join(root, 'stagepass.json'), { name: 'app', php: true, modules: [] });
      const projectsPath = path.join(tmp, 'projects.json');
      await saveProjects({
        version: 1,
        projects: { 'app.sp': { root, origins: [], allowAllOrigins: false, php: true } },
      }, projectsPath);
      const ensureFpm = vi.fn();
      const code = await dev({}, {
        cwd: root,
        platform: 'darwin',
        projectsPath,
        caddyfilePath: path.join(tmp, 'Caddyfile'),
        log: (m) => logs.push(String(m)),
        error: () => {},
        ensureStagepassReady: async () => ({ ok: true, running: true, linked: true, started: false }),
        resolveCommand: async () => null,
        ensurePhpFpm: ensureFpm,
        spawnWatch: async () => ({ code: 0, signal: null }),
        reloadCaddy: async () => {},
        createLiveServer: () => ({ listen: async () => ({ port: 34567, close: async () => {} }) }),
      });
      expect(code).toBe(0);
      expect(ensureFpm).not.toHaveBeenCalled();
      const joined = logs.join('\n');
      expect(joined).toContain('PHP / php-fpm not found');
      expect(joined).toContain('brew install php');
      expect(joined).toContain('https://app.sp/api/action.php needs PHP before it can answer.');
    } finally {
      await fs.remove(tmp);
    }
  });

  it('cli-php: watch warns on old PHP and still runs the script', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sp-php-watch-'));
    const logs = [];
    const spawn = vi.fn(async () => ({ code: 0, signal: null }));
    try {
      await fs.writeJson(path.join(tmp, 'package.json'), { scripts: { watch: 'node scripts/build.mjs --watch' } });
      await fs.writeJson(path.join(tmp, 'stagepass.json'), { name: 'app', php: true, modules: [] });
      const code = await watch({}, {
        cwd: tmp,
        platform: 'linux',
        domain: 'app.sp',
        fs,
        spawn,
        log: (m) => logs.push(String(m)),
        error: () => {},
        ensureStagepassReady: async () => ({ ok: true }),
        ensurePhpFpm: vi.fn(),
        resolveCommand: async (name) => (name === 'php' ? '/usr/bin/php' : null),
        exec: async () => ({ stdout: 'PHP 8.0.30 (cli)\n', stderr: '' }),
      });
      expect(code).toBe(0);
      expect(spawn).toHaveBeenCalled();
      expect(logs.join('\n')).toContain('PHP 8.0.30 is older than 8.2');
      expect(logs.join('\n')).toContain('https://app.sp/api/action.php needs PHP before it can answer.');
    } finally {
      await fs.remove(tmp);
    }
  });
});
