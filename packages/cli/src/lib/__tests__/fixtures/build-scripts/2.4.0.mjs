#!/usr/bin/env node
/**
 * Stagepass project build: esbuild (+ optional sass).
 * Production: hashed files, stable copies, manifest.json (sha384 SRI), then drop stale hashes.
 * Older manifests store a filename string (CLI 2.2.x) or `{ file, integrity }`.
 * `--watch`: stable dist/main.js and dist/styles.css only. Does not touch manifest.json.
 * Writes a dist file only when its bytes changed. Watch rebuilds the affected part.
 */
import { createHash } from 'node:crypto';
import { watch as fsWatch, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const watchMode = process.argv.includes('--watch');

const ENTRY_JS = process.env.STAGEPASS_ENTRY_JS || '{{ENTRY_JS}}';
const ENTRY_CSS = process.env.STAGEPASS_ENTRY_CSS || '{{ENTRY_CSS}}';
const USE_SASS = (process.env.STAGEPASS_USE_SASS || '{{USE_SASS}}') === 'true';

/** @type {{ 'main.js': { file: string, integrity: string } | null, 'styles.css': { file: string, integrity: string } | null }} */
const manifestState = {
  'main.js': null,
  'styles.css': null,
};

async function ensureDist() {
  await fs.mkdir(distDir, { recursive: true });
}

function hashContent(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

function sriSha384(buf) {
  return `sha384-${createHash('sha384').update(buf).digest('base64')}`;
}

/**
 * Write only when contents differ from the existing file (preserves mtime when unchanged).
 * @param {string} filePath
 * @param {Buffer} buf
 * @returns {Promise<boolean>} true when written
 */
async function writeIfChanged(filePath, buf) {
  try {
    const existing = await fs.readFile(filePath);
    if (existing.equals(buf)) return false;
  } catch {
    /* missing or unreadable → write */
  }
  await fs.writeFile(filePath, buf);
  return true;
}

/**
 * @param {string} stableName
 * @param {Buffer|string} contents
 * @param {BufferEncoding} [encoding]
 */
async function writeHashed(stableName, contents, encoding = undefined) {
  const buf = Buffer.isBuffer(contents)
    ? contents
    : Buffer.from(contents, encoding || 'utf8');
  await writeIfChanged(path.join(distDir, stableName), buf);
  if (watchMode) return { file: stableName };
  const hash = hashContent(buf);
  const ext = path.extname(stableName);
  const base = path.basename(stableName, ext);
  const hashedName = `${base}.${hash}${ext}`;
  await writeIfChanged(path.join(distDir, hashedName), buf);
  return {
    file: hashedName,
    integrity: sriSha384(buf),
  };
}

async function writeManifest() {
  if (watchMode || !manifestState['main.js'] || !manifestState['styles.css']) return;
  const text = `${JSON.stringify(
    {
      'main.js': manifestState['main.js'],
      'styles.css': manifestState['styles.css'],
    },
    null,
    2
  )}\n`;
  await writeIfChanged(path.join(distDir, 'manifest.json'), Buffer.from(text, 'utf8'));
}

function jsBuildOptions() {
  return {
    entryPoints: [path.join(root, ENTRY_JS)],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2018'],
    sourcemap: false,
    logLevel: 'warning',
  };
}

/**
 * @param {Buffer} contents
 */
async function applyJsOutput(contents) {
  manifestState['main.js'] = await writeHashed('main.js', contents);
  await writeManifest();
  return manifestState['main.js'];
}

async function buildJsOnce() {
  const result = await esbuild.build(jsBuildOptions());
  const out = result.outputFiles[0];
  return applyJsOutput(out.contents);
}

async function buildCss() {
  const entry = path.join(root, ENTRY_CSS);
  let css;
  if (USE_SASS) {
    const sass = await import('sass');
    const compiled = sass.compile(entry, { style: 'compressed' });
    css = compiled.css;
  } else {
    css = await fs.readFile(entry, 'utf8');
  }
  manifestState['styles.css'] = await writeHashed('styles.css', css, 'utf8');
  await writeManifest();
  return manifestState['styles.css'];
}

function safeHashName(name) {
  return typeof name === 'string'
    && name === path.basename(name)
    && !name.includes('..')
    && !name.includes('\\')
    && !path.isAbsolute(name)
    && /^[\w-]+\.[0-9a-f]{8}\.[A-Za-z0-9]+$/.test(name);
}

/**
 * Filename recorded for one manifest entry.
 * CLI 2.2.x stored a string. Later scaffolds store `{ file, integrity }`.
 * @param {unknown} entry
 * @returns {string}
 */
function manifestEntryName(entry) {
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.file === 'string') {
    return entry.file;
  }
  return '';
}

async function priorHashNames() {
  try {
    const data = JSON.parse(await fs.readFile(path.join(distDir, 'manifest.json'), 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    const names = [];
    for (const entry of Object.values(data)) {
      const name = manifestEntryName(entry);
      if (name) names.push(name);
    }
    return names;
  } catch {
    return [];
  }
}

async function removeStaleHashes(prev) {
  const keep = new Set(['main.js', 'styles.css'].map((k) => manifestState[k] && manifestState[k].file));
  for (const name of prev) {
    if (keep.has(name) || !safeHashName(name)) continue;
    try {
      const file = path.join(distDir, name);
      if (!(await fs.lstat(file)).isFile()) continue;
      await fs.unlink(file);
    } catch {
      /* missing */
    }
  }
}

function skipPublishName(name) {
  if (name === '.env' || (name.startsWith('.env') && name !== '.env.example')) return true;
  return name === 'rate-limit' || name.endsWith('.log') || name.endsWith('.pid');
}

async function copyFiltered(src, dest) {
  let entries;
  try {
    entries = await fs.readdir(src, { withFileTypes: true });
  } catch {
    return;
  }
  await fs.mkdir(dest, { recursive: true });
  for (const ent of entries) {
    if (skipPublishName(ent.name) || ent.isSymbolicLink()) continue;
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) await copyFiltered(from, to);
    else if (ent.isFile()) await fs.copyFile(from, to);
  }
}

/** PHP projects: upload bundle is dist/api plus dist/.php/config.php. Watch serves the project root. */
async function publishPhp() {
  if (watchMode) return;
  let cfg;
  try {
    cfg = JSON.parse(await fs.readFile(path.join(root, 'stagepass.json'), 'utf8'));
  } catch {
    return;
  }
  if (!cfg || cfg.php !== true) return;
  await copyFiltered(path.join(root, 'api'), path.join(distDir, 'api'));
  const configSrc = path.join(root, '.php', 'config.php');
  let st;
  try {
    st = await fs.lstat(configSrc);
  } catch {
    return;
  }
  if (!st.isFile()) return;
  const destDir = path.join(distDir, '.php');
  await fs.mkdir(destDir, { recursive: true });
  await fs.copyFile(configSrc, path.join(destDir, 'config.php'));
}

async function buildOnce() {
  await ensureDist();
  const prev = watchMode ? null : await priorHashNames();
  await buildJsOnce();
  await buildCss();
  if (prev) await removeStaleHashes(prev);
  await publishPhp();
  return {
    'main.js': manifestState['main.js'],
    'styles.css': manifestState['styles.css'],
  };
}

/**
 * Serialize async rebuild work so overlapping esbuild / CSS events stay ordered.
 * @type {Promise<void>}
 */
let chain = Promise.resolve();
function enqueue(label, fn) {
  chain = chain
    .then(async () => {
      try {
        const next = await fn();
        console.log(`[stagepass] rebuild ${label} ok`, next);
      } catch (err) {
        console.error(`[stagepass] rebuild ${label} failed`, err);
      }
    })
    .catch(() => {});
  return chain;
}

if (!watchMode) {
  const manifest = await buildOnce();
  console.log('[stagepass] build ok', manifest);
} else {
  await ensureDist();

  /** Skip the first onEnd from context.watch (we seed via rebuild below). */
  let jsWatchReady = false;
  /** @type {import('esbuild').BuildContext|null} */
  let ctx = null;
  /** @type {import('node:fs').FSWatcher|null} */
  let cssWatcher = null;
  let shuttingDown = false;

  async function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      cssWatcher?.close();
    } catch {
      /* ignore */
    }
    cssWatcher = null;
    try {
      if (ctx) await ctx.dispose();
    } catch {
      /* ignore */
    }
    ctx = null;
    // Allow pending enqueue work to settle briefly, then exit hard.
    await Promise.race([chain, new Promise((r) => setTimeout(r, 500))]);
    process.exit(code);
  }

  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      void shutdown(0);
    });
  }

  ctx = await esbuild.context({
    ...jsBuildOptions(),
    plugins: [
      {
        name: 'stagepass-js-watch',
        setup(build) {
          build.onEnd((result) => {
            if (!jsWatchReady || shuttingDown) return;
            if (result.errors.length > 0) {
              console.error('[stagepass] rebuild js failed');
              return;
            }
            const out = result.outputFiles && result.outputFiles[0];
            if (!out) {
              enqueue('full', buildOnce);
              return;
            }
            const contents = Buffer.from(out.contents);
            enqueue('js', () => applyJsOutput(contents));
          });
        },
      },
    ],
  });

  // Initial full build (JS via context.rebuild so the graph is warm for watch).
  const initial = await ctx.rebuild();
  if (initial.errors.length > 0 || !initial.outputFiles?.[0]) {
    await shutdown(1);
    throw new Error('[stagepass] initial js build failed');
  }
  await applyJsOutput(initial.outputFiles[0].contents);
  await buildCss();
  console.log('[stagepass] build ok', {
    'main.js': manifestState['main.js'],
    'styles.css': manifestState['styles.css'],
  });

  jsWatchReady = true;
  await ctx.watch();

  let cssPending = false;
  const scheduleCss = () => {
    if (cssPending || shuttingDown) return;
    cssPending = true;
    setTimeout(() => {
      cssPending = false;
      if (shuttingDown) return;
      enqueue('css', async () => {
        await buildCss();
        return manifestState['styles.css'];
      });
    }, 40);
  };

  try {
    cssWatcher = fsWatch(path.join(root, ENTRY_CSS), () => {
      scheduleCss();
    });
  } catch (err) {
    console.error('[stagepass] css watch failed; falling back to full rebuilds', err);
    cssWatcher = fsWatch(path.join(root, ENTRY_CSS), () => {
      enqueue('full', buildOnce);
    });
  }

  console.log('[stagepass] watching…');
}
