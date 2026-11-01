#!/usr/bin/env node
/**
 * Stagepass project build: esbuild (+ optional sass) → content-hashed dist files + manifest.json.
 * Also writes stable dist/main.js and dist/styles.css copies for local Stagepass paths.
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

async function ensureDist() {
  await fs.mkdir(distDir, { recursive: true });
}

function hashContent(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 8);
}

async function writeHashed(stableName, contents, encoding = undefined) {
  const buf = Buffer.isBuffer(contents)
    ? contents
    : Buffer.from(contents, encoding || 'utf8');
  const hash = hashContent(buf);
  const ext = path.extname(stableName);
  const base = path.basename(stableName, ext);
  const hashedName = `${base}.${hash}${ext}`;
  await fs.writeFile(path.join(distDir, hashedName), buf);
  await fs.writeFile(path.join(distDir, stableName), buf);
  return hashedName;
}

async function buildJs() {
  const entry = path.join(root, ENTRY_JS);
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2018'],
    sourcemap: false,
    logLevel: 'warning',
  });
  const out = result.outputFiles[0];
  return writeHashed('main.js', out.contents);
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
  return writeHashed('styles.css', css, 'utf8');
}

async function buildOnce() {
  await ensureDist();
  const mainFile = await buildJs();
  const stylesFile = await buildCss();
  const manifest = {
    'main.js': mainFile,
    'styles.css': stylesFile,
  };
  await fs.writeFile(
    path.join(distDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  return manifest;
}

const manifest = await buildOnce();
console.log('[stagepass] build ok', manifest);

if (watchMode) {
  let pending = false;
  const rebuild = async () => {
    if (pending) return;
    pending = true;
    try {
      const next = await buildOnce();
      console.log('[stagepass] rebuild ok', next);
    } catch (err) {
      console.error('[stagepass] rebuild failed', err);
    } finally {
      pending = false;
    }
  };
  for (const rel of [ENTRY_JS, ENTRY_CSS]) {
    fsWatch(path.join(root, rel), () => {
      rebuild().catch(() => {});
    });
  }
  console.log('[stagepass] watching…');
}
