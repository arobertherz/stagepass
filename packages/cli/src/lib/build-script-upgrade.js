/**
 * Detect an unmodified scaffold `scripts/build.mjs` and render the current one.
 *
 * Known hashes are SHA-256 of the LF-normalized template bytes (placeholders
 * intact) from git history of `templates/project/scripts/build.mjs`. When the
 * template changes, append the previous file's hash here or older projects
 * will be treated as hand-edited.
 *
 * Project copies differ only by the three scaffold tokens and by CRLF. Those
 * are normalized before hashing. Any other edit stays custom and is not overwritten.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import { applyTemplate } from './scaffold.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Project-relative path written by `stagepass new`. */
export const BUILD_SCRIPT_REL = 'scripts/build.mjs';

export const BUILD_SCRIPT_DOC_URL =
  'https://github.com/arobertherz/stagepass/blob/master/docs/cli.md#upgrade';

export const BUILD_SCRIPT_CUSTOM_HINT = [
  'scripts/build.mjs has local edits, so stagepass upgrade left it unchanged.',
  `What the current scaffold does (${BUILD_SCRIPT_DOC_URL}):`,
  '  stagepass watch and stagepass dev write only stable dist/main.js and dist/styles.css. Hashed files and manifest.json stay as the last stagepass build left them.',
  '  stagepass build writes content hashes, stable copies, and SRI in dist/manifest.json, then deletes hashed files the previous manifest listed that this build does not. CLI 2.2.x manifests store those filenames as strings; those names are included. Only plain <base>.<8 hex><ext> files directly in dist/ are removed.',
  '  When stagepass.json has "php": true, stagepass build also copies api/, .php/config.php, and a project-root .htaccess into dist. It skips .env, .php/.env, .php/rate-limit, logs, pid files, and key, certificate, or database files (.pem, .key, .p12, .pfx, .crt, .cer, .sqlite, .db). It keeps .htaccess and .env.example. A dist/.htaccess stays when the project has none. Watch does not copy them.',
  'Port that behavior into your script by hand. The Scripts section of a README from stagepass new describes the same stagepass build, stagepass watch and stagepass dev commands.',
].join('\n');

export const BUILD_SCRIPT_MISSING_NOTE =
  'No scripts/build.mjs. stagepass build, stagepass watch and stagepass dev use the scaffold from stagepass new. See ' +
  BUILD_SCRIPT_DOC_URL;

/**
 * Stock scaffold, no TTY, and no `--yes`. The file stays.
 * @param {string} id known template id
 * @returns {string}
 */
export function buildScriptUnattendedHint(id) {
  return `scripts/build.mjs matches the unmodified ${id} scaffold. No TTY and no --yes, so it was left unchanged. Run stagepass upgrade --yes to replace it.`;
}

/**
 * Distinct blobs of the scaffold before the template bundled with this CLI.
 * @type {{ id: string, commit: string, sha256: string }[]}
 */
export const KNOWN_SCAFFOLD_BUILD_SCRIPTS = [
  {
    id: '2.1.0-2.2.7',
    commit: '8a98239',
    sha256: 'f297b451318a5d37a26552fd2b284d1c8fc32d982d324d7554ea51010cc8da8b',
  },
  {
    id: '2.3.0-sri',
    commit: 'f7afa80',
    sha256: 'a3af9742800b4652603f42683f78028cb51fb31791d904d61eb474ba3ab2d2cd',
  },
  {
    id: '2.3.0',
    commit: 'bcc87fc',
    sha256: '10ee2eaa94b0b357bedb37bf89120b6ac971273e4e1fdc8c45eafb7d102bab22',
  },
  {
    id: 'watch-stable',
    commit: '688dca9',
    sha256: '8f0bc02d4a58af8ad1b830bf53c4f712db6761f5155f4d11053f02ca203b88da',
  },
  {
    id: 'pre-php',
    commit: '9cb8c49',
    sha256: 'f6507c32b6b59e97930bd9dbe1e4d272efcd2678213929b7bc1eb3aa0a167459',
  },
  {
    id: '2.4.0',
    commit: '983f090',
    sha256: '98578f87225fd03d08b7e5d5bbdecc07cbb6ccbbc754642c6e880bb2f53559bb',
  },
  {
    id: '2.4.0-keys',
    commit: '6966954',
    sha256: 'cba431ef9e0ff257ecced77613f6157c96d64f2a2db7679fcaa6467795d5ca9c',
  },
];

const TOKEN_SPECS = [
  {
    key: 'ENTRY_JS',
    placeholder: '{{ENTRY_JS}}',
    re: /^const ENTRY_JS = process\.env\.STAGEPASS_ENTRY_JS \|\| '([^'\\]*)';$/m,
    restore: "const ENTRY_JS = process.env.STAGEPASS_ENTRY_JS || '{{ENTRY_JS}}';",
  },
  {
    key: 'ENTRY_CSS',
    placeholder: '{{ENTRY_CSS}}',
    re: /^const ENTRY_CSS = process\.env\.STAGEPASS_ENTRY_CSS \|\| '([^'\\]*)';$/m,
    restore: "const ENTRY_CSS = process.env.STAGEPASS_ENTRY_CSS || '{{ENTRY_CSS}}';",
  },
  {
    key: 'USE_SASS',
    placeholder: '{{USE_SASS}}',
    re: /^const USE_SASS = \(process\.env\.STAGEPASS_USE_SASS \|\| '([^'\\]*)'\) === 'true';$/m,
    restore: "const USE_SASS = (process.env.STAGEPASS_USE_SASS || '{{USE_SASS}}') === 'true';",
  },
];

/** Absolute path of the scaffold shipped in this package. */
export function defaultBuildScriptTemplatePath() {
  return path.join(__dirname, '../../templates/project/scripts/build.mjs');
}

/**
 * @param {string} source
 * @returns {string}
 */
export function normalizeNewlines(source) {
  return String(source).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * LF newlines, and the three scaffold assignments restored to placeholders.
 * @param {string} source
 * @returns {string}
 */
export function canonicalizeBuildScript(source) {
  let text = normalizeNewlines(source);
  for (const spec of TOKEN_SPECS) {
    text = text.replace(spec.re, spec.restore);
  }
  return text;
}

/**
 * @param {string} source
 * @returns {string}
 */
export function hashBuildScript(source) {
  return createHash('sha256').update(canonicalizeBuildScript(source), 'utf8').digest('hex');
}

/**
 * Entry paths currently written in a scaffold script.
 * @param {string} source
 * @returns {Record<string, string>}
 */
export function readScaffoldTokens(source) {
  const text = normalizeNewlines(source);
  /** @type {Record<string, string>} */
  const tokens = {};
  for (const spec of TOKEN_SPECS) {
    const match = spec.re.exec(text);
    tokens[spec.key] = match ? match[1] : spec.placeholder;
  }
  return tokens;
}

/**
 * @param {string} currentSource template bytes from this package
 * @param {string} projectSource
 * @returns {string}
 */
export function renderCurrentBuildScript(currentSource, projectSource) {
  return applyTemplate(currentSource, readScaffoldTokens(projectSource));
}

/**
 * @param {string} source project or template bytes
 * @param {string} currentSource template bundled with this CLI
 * @returns {{ status: 'current' | 'stock' | 'custom', hash: string, id?: string, commit?: string }}
 */
export function classifyBuildScript(source, currentSource) {
  const hash = hashBuildScript(source);
  if (hash === hashBuildScript(currentSource)) return { status: 'current', hash };
  const known = KNOWN_SCAFFOLD_BUILD_SCRIPTS.find((item) => item.sha256 === hash);
  if (known) return { status: 'stock', hash, id: known.id, commit: known.commit };
  return { status: 'custom', hash };
}

/**
 * @param {string} cwd
 * @param {string} currentSource
 * @param {{ lstat: Function, readFile: Function }} [fse]
 * @returns {Promise<{ status: string, hash?: string, id?: string, commit?: string, raw?: string, error?: string }>}
 */
export async function inspectProjectBuildScript(cwd, currentSource, fse = fs) {
  const abs = path.join(cwd, BUILD_SCRIPT_REL);
  /** @type {import('node:fs').Stats} */
  let st;
  try {
    st = await fse.lstat(abs);
  } catch (err) {
    if (err && /** @type {{ code?: string }} */ (err).code === 'ENOENT') return { status: 'missing' };
    return {
      status: 'unreadable',
      error: err instanceof Error ? err.message : String(err),
    };
  }
  if (st.isSymbolicLink()) return { status: 'symlink' };
  if (!st.isFile()) return { status: 'unreadable', error: 'not a file' };
  /** @type {string} */
  let raw;
  try {
    raw = await fse.readFile(abs, 'utf8');
  } catch (err) {
    return {
      status: 'unreadable',
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const classified = classifyBuildScript(raw, currentSource);
  return { ...classified, raw };
}

/**
 * Decide whether upgrade should replace scripts/build.mjs.
 * Does not write. `--yes` (`assumeYes`) replaces a stock script.
 * A TTY (`interactive`) asks. Otherwise the file stays and the note names `--yes`.
 *
 * @param {object} options
 * @param {string} options.cwd
 * @param {string} options.currentSource
 * @param {boolean} options.interactive
 * @param {boolean} [options.assumeYes]
 * @param {(question: string, defYes: boolean) => Promise<boolean>} [options.confirm]
 * @param {{ lstat: Function, readFile: Function }} [options.fse]
 */
export async function planBuildScriptUpgrade(options) {
  const fse = options.fse || fs;
  const found = await inspectProjectBuildScript(options.cwd, options.currentSource, fse);
  if (found.status === 'missing') return { action: 'missing', note: BUILD_SCRIPT_MISSING_NOTE };
  if (found.status === 'symlink') {
    return { action: 'symlink', note: 'scripts/build.mjs is a symlink; left unchanged.' };
  }
  if (found.status === 'unreadable') {
    return {
      action: 'unreadable',
      note: `scripts/build.mjs could not be read; left unchanged. ${found.error || ''}`.trim(),
    };
  }
  if (found.status === 'current') {
    return { action: 'current', note: 'scripts/build.mjs already matches the current scaffold.' };
  }
  if (found.status === 'custom') return { action: 'custom', note: BUILD_SCRIPT_CUSTOM_HINT };
  const content = renderCurrentBuildScript(options.currentSource, found.raw || '');
  if (options.assumeYes === true) return { action: 'update', from: found.id, content };
  if (options.interactive) {
    if (typeof options.confirm !== 'function') {
      throw new Error('confirm is required when upgrade asks about scripts/build.mjs');
    }
    const yes = await options.confirm(
      `Replace scripts/build.mjs with the current scaffold? It matches the unmodified ${found.id} template.`,
      true
    );
    if (!yes) return { action: 'declined', note: 'scripts/build.mjs left unchanged.' };
    return { action: 'update', from: found.id, content };
  }
  return { action: 'hint', from: found.id, note: buildScriptUnattendedHint(found.id || 'scaffold') };
}
