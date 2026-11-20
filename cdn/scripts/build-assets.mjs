import { execFile } from 'node:child_process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseSemver, versionAtLeast, compareSemver } from '../src/semver.js';

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cdnDir = path.resolve(scriptDir, '..');

// Workers Free: 20,000 static assets per version, 25 MiB each.
// https://developers.cloudflare.com/workers/platform/limits/ (checked 2026-11-20).
export const ASSET_LIMITS = {
  maxFiles: 20000,
  maxFileBytes: 25 * 1024 * 1024,
};

export function normalizeVersionList(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string');
  return [];
}

export function selectVersions(versions, { floor, exclude = [] }) {
  const skipped = new Set(exclude);
  const seen = new Set();
  const kept = [];
  for (const version of normalizeVersionList(versions)) {
    if (seen.has(version)) continue;
    seen.add(version);
    if (!parseSemver(version)) continue;
    if (skipped.has(version)) continue;
    if (!versionAtLeast(version, floor)) continue;
    kept.push(version);
  }
  kept.sort(compareSemver);
  return kept;
}

export function sriFor(bytes, algorithm = 'sha512') {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return `${algorithm}-${createHash(algorithm).update(buffer).digest('base64')}`;
}

export function integrityMatches(bytes, expected) {
  if (typeof expected !== 'string') return false;
  const dash = expected.indexOf('-');
  if (dash <= 0) return false;
  const algorithm = expected.slice(0, dash);
  if (algorithm !== 'sha512') return false;
  let actual;
  try {
    actual = sriFor(bytes, algorithm);
  } catch {
    return false;
  }
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

// 'dist' entries are extracted. 'skip' entries are ignored. 'reject' fails the build.
export function classifyTarEntry(name) {
  if (typeof name !== 'string' || name.length === 0) return 'reject';
  if (name.includes('\\') || name.includes('\0')) return 'reject';
  if (name.startsWith('/') || name.startsWith('../')) return 'reject';
  const parts = name.split('/');
  if (parts.some((part) => part === '..')) return 'reject';
  const segments = name.endsWith('/') ? parts.slice(0, -1) : parts;
  if (segments.some((part) => part === '')) return 'reject';
  if (segments.length < 2 || segments[0] !== 'package' || segments[1] !== 'dist') return 'skip';
  if (segments.slice(2).some((part) => part === '.')) return 'reject';
  return 'dist';
}

export function assertSafeOutDir(out, anchors = []) {
  const resolved = path.resolve(out);
  const root = path.parse(resolved).root;
  if (resolved === root) {
    throw new Error('refusing filesystem root as the asset output');
  }
  const parts = resolved.slice(root.length).split(path.sep).filter(Boolean);
  if (parts.length < 2) {
    throw new Error(`refusing asset output too close to the filesystem root: ${resolved}`);
  }
  for (const anchor of anchors) {
    if (resolved === path.resolve(anchor)) {
      throw new Error(`refusing to replace source directory ${resolved}`);
    }
  }
  return resolved;
}

export function checkAssetLimits(files, limits = ASSET_LIMITS) {
  const errors = [];
  let largest = 0;
  if (files.length > limits.maxFiles) {
    errors.push(`file count ${files.length} exceeds the Workers Free limit of ${limits.maxFiles}`);
  }
  for (const file of files) {
    if (file.bytes > largest) largest = file.bytes;
    if (file.bytes > limits.maxFileBytes) {
      errors.push(`${file.path} is ${file.bytes} bytes, over the 25 MiB Workers Static Assets limit`);
    }
  }
  return { ok: errors.length === 0, errors, largest, count: files.length };
}

export function missingVersions(wanted, manifest) {
  const have = new Set();
  const packages = manifest && Array.isArray(manifest.packages) ? manifest.packages : [];
  for (const pkg of packages) {
    if (!pkg || typeof pkg.version !== 'string' || typeof pkg.package !== 'string') continue;
    have.add(`${pkg.package}@${pkg.version}`);
  }
  return wanted.filter((item) => !have.has(`${item.package}@${item.version}`));
}

export function defaultConfigPath() {
  return path.join(cdnDir, 'versions.config.json');
}

export function defaultOutDir() {
  return path.join(cdnDir, 'dist');
}

export async function loadPackageConfig(configPath = defaultConfigPath()) {
  const raw = JSON.parse(await readFile(configPath, 'utf8'));
  if (!raw || !Array.isArray(raw.packages) || raw.packages.length === 0) {
    throw new Error(`no packages in ${configPath}`);
  }
  const packages = raw.packages.map((pkg) => {
    if (!pkg || typeof pkg.package !== 'string' || typeof pkg.npm !== 'string') {
      throw new Error('each package needs "package" and "npm"');
    }
    if (pkg.package !== 'loader' && pkg.package !== 'modules') {
      throw new Error(`unsupported package name ${pkg.package}`);
    }
    if (!parseSemver(pkg.floor)) {
      throw new Error(`floor for ${pkg.package} must be an exact version`);
    }
    const exclude = Array.isArray(pkg.exclude) ? pkg.exclude.slice() : [];
    for (const version of exclude) {
      if (typeof version !== 'string') throw new Error(`exclude entry for ${pkg.package} must be a string`);
    }
    return {
      package: pkg.package,
      npm: pkg.npm,
      floor: pkg.floor,
      exclude,
    };
  });
  packages.sort((a, b) => a.package.localeCompare(b.package));
  return { packages };
}

export function parseBuildArgs(argv) {
  let out;
  let config;
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      out = argv[i + 1];
      i += 1;
      if (!out) throw new Error('--out needs a directory');
    } else if (arg === '--config') {
      config = argv[i + 1];
      i += 1;
      if (!config) throw new Error('--config needs a file');
    } else if (arg === '--help' || arg === '-h') {
      return { help: true };
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown argument: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) throw new Error('pass one output directory');
  if (positional.length === 1) {
    if (out) throw new Error('pass either a positional directory or --out');
    out = positional[0];
  }
  return { help: false, out, config };
}

function npmEnv() {
  return {
    ...process.env,
    npm_config_fund: 'false',
    npm_config_audit: 'false',
    npm_config_update_notifier: 'false',
  };
}

function parseJsonStdout(stdout, label) {
  const text = String(stdout).trim();
  if (!text) throw new Error(`${label} returned an empty response`);
  try {
    return JSON.parse(text);
  } catch {
    const start = text.search(/[[{"]/);
    if (start === -1) throw new Error(`${label} did not return JSON`);
    return JSON.parse(text.slice(start));
  }
}

export async function npmJson(args) {
  const { stdout } = await execFileAsync('npm', [...args, '--json'], {
    maxBuffer: 32 * 1024 * 1024,
    env: npmEnv(),
  });
  return parseJsonStdout(stdout, `npm ${args[0]}`);
}

export async function readRegistryVersions(npmName) {
  return normalizeVersionList(await npmJson(['view', npmName, 'versions']));
}

export async function readDistMetadata(npmName, version) {
  const data = await npmJson(['view', `${npmName}@${version}`, 'dist.integrity', 'dist.tarball']);
  if (!data || typeof data !== 'object') {
    throw new Error(`missing dist metadata for ${npmName}@${version}`);
  }
  const integrity = data['dist.integrity'] ?? data.integrity ?? data.dist?.integrity;
  const tarball = data['dist.tarball'] ?? data.tarball ?? data.dist?.tarball;
  if (typeof integrity !== 'string' || typeof tarball !== 'string') {
    throw new Error(`incomplete dist metadata for ${npmName}@${version}`);
  }
  return { integrity, tarball };
}

async function listTar(tarball) {
  const { stdout } = await execFileAsync('tar', ['-tzf', tarball], {
    maxBuffer: 32 * 1024 * 1024,
  });
  return String(stdout).split('\n').map((line) => line.trim()).filter(Boolean);
}

async function walkFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) throw new Error(`refusing symlink in package dist: ${full}`);
    if (stat.isDirectory()) {
      files.push(...await walkFiles(full));
    } else if (stat.isFile()) {
      files.push(full);
    } else {
      throw new Error(`unsupported dist entry: ${full}`);
    }
  }
  return files;
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function packAndExtract(pkg, version, tmp) {
  const spec = `${pkg.npm}@${version}`;
  const meta = await readDistMetadata(pkg.npm, version);
  const packDir = path.join(tmp, `pack-${pkg.package}-${version}`);
  await mkdir(packDir, { recursive: true });
  const { stdout } = await execFileAsync(
    'npm',
    ['pack', spec, '--json', '--pack-destination', packDir],
    { cwd: packDir, maxBuffer: 32 * 1024 * 1024, env: npmEnv() },
  );
  const packed = parseJsonStdout(stdout, `npm pack ${spec}`);
  const item = Array.isArray(packed) ? packed[0] : packed;
  if (!item || typeof item.filename !== 'string') {
    throw new Error(`npm pack did not name a tarball for ${spec}`);
  }
  const tarballPath = path.join(packDir, item.filename);
  const tarballBytes = await readFile(tarballPath);
  if (!integrityMatches(tarballBytes, meta.integrity)) {
    const actual = sriFor(tarballBytes);
    throw new Error(
      `integrity mismatch for ${spec}: registry ${meta.integrity} tarball ${actual}`,
    );
  }
  if (typeof item.integrity === 'string' && item.integrity !== meta.integrity) {
    throw new Error(`npm pack integrity does not match dist.integrity for ${spec}`);
  }

  const names = await listTar(tarballPath);
  const distEntries = [];
  for (const name of names) {
    const kind = classifyTarEntry(name);
    if (kind === 'reject') throw new Error(`unsafe tar entry in ${spec}: ${name}`);
    if (kind === 'dist') distEntries.push(name);
  }
  if (!distEntries.some((name) => !name.endsWith('/'))) {
    throw new Error(`no dist/ files in ${spec}`);
  }

  const extractDir = path.join(tmp, `extract-${pkg.package}-${version}`);
  await mkdir(extractDir, { recursive: true });
  await execFileAsync('tar', ['-xzf', tarballPath, '-C', extractDir, '--', ...distEntries]);
  const distDir = path.join(extractDir, 'package', 'dist');
  let distStat;
  try {
    distStat = await lstat(distDir);
  } catch {
    throw new Error(`dist/ missing after extract for ${spec}`);
  }
  if (!distStat.isDirectory() || distStat.isSymbolicLink()) {
    throw new Error(`dist/ is not a directory for ${spec}`);
  }

  const files = [];
  for (const full of await walkFiles(distDir)) {
    const rel = path.relative(distDir, full).split(path.sep).join('/');
    if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split('/').some((part) => part === '..' || part === '')) {
      throw new Error(`dist path escaped for ${spec}: ${rel}`);
    }
    const bytes = await readFile(full);
    files.push({
      path: rel,
      bytes: bytes.length,
      sha256: sha256Hex(bytes),
      body: bytes,
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  if (files.length === 0) throw new Error(`no dist/ files in ${spec}`);
  return { integrity: meta.integrity, tarball: meta.tarball, files };
}

function requireTool(name) {
  return execFileAsync(name, ['--version']);
}

async function writeTree(out, packages) {
  let fileCount = 0;
  let byteCount = 0;
  const manifestPackages = [];
  for (const pkg of packages) {
    for (const version of pkg.versions) {
      const destRoot = path.join(out, `${pkg.package}@${version.version}`);
      const files = [];
      for (const file of version.files) {
        const dest = path.join(destRoot, ...file.path.split('/'));
        const relative = path.relative(destRoot, dest);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new Error(`refusing to write outside ${destRoot}: ${file.path}`);
        }
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, file.body);
        files.push({ path: file.path, bytes: file.bytes, sha256: file.sha256 });
        fileCount += 1;
        byteCount += file.bytes;
      }
      manifestPackages.push({
        package: pkg.package,
        npm: pkg.npm,
        version: version.version,
        integrity: version.integrity,
        tarball: version.tarball,
        files,
      });
    }
  }
  manifestPackages.sort((a, b) => {
    if (a.package !== b.package) return a.package.localeCompare(b.package);
    return compareSemver(a.version, b.version);
  });
  const manifest = { packages: manifestPackages };
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestPath = path.join(out, 'manifest.json');
  await writeFile(manifestPath, json);
  const manifestBytes = Buffer.byteLength(json);
  return { manifest, fileCount, byteCount, manifestBytes };
}

function printSummary(built) {
  const lines = ['stagepass cdn assets'];
  const byPackage = new Map();
  for (const pkg of built.manifest.packages) {
    if (!byPackage.has(pkg.package)) {
      byPackage.set(pkg.package, { versions: 0, files: 0, bytes: 0, names: [] });
    }
    const row = byPackage.get(pkg.package);
    row.versions += 1;
    row.names.push(`${pkg.package}@${pkg.version}`);
    for (const file of pkg.files) {
      row.files += 1;
      row.bytes += file.bytes;
    }
  }
  for (const [name, row] of byPackage) {
    lines.push(`  ${name}: ${row.versions} versions, ${row.files} files, ${row.bytes} bytes`);
    for (const versionName of row.names) lines.push(`    ${versionName}`);
  }
  const totalFiles = built.fileCount + 1;
  const totalBytes = built.byteCount + built.manifestBytes;
  lines.push(`  manifest.json: ${built.manifestBytes} bytes`);
  lines.push(`  total files: ${totalFiles}`);
  lines.push(`  total bytes: ${totalBytes}`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

export async function buildAssets({ out, configPath } = {}) {
  await requireTool('npm');
  await requireTool('tar');
  const resolvedOut = assertSafeOutDir(out || defaultOutDir(), [cdnDir, path.resolve(cdnDir, '..')]);
  const config = await loadPackageConfig(configPath || defaultConfigPath());
  await rm(resolvedOut, { recursive: true, force: true });
  await mkdir(resolvedOut, { recursive: true });
  const tmp = await mkdtemp(path.join(tmpdir(), 'sp-cdn-pack-'));
  try {
    const builtPackages = [];
    for (const pkg of config.packages) {
      const available = await readRegistryVersions(pkg.npm);
      const selected = selectVersions(available, pkg);
      const versions = [];
      for (const version of selected) {
        process.stderr.write(`pack ${pkg.npm}@${version}\n`);
        const extracted = await packAndExtract(pkg, version, tmp);
        versions.push({
          version,
          integrity: extracted.integrity,
          tarball: extracted.tarball,
          files: extracted.files,
        });
      }
      builtPackages.push({ ...pkg, versions });
    }
    const built = await writeTree(resolvedOut, builtPackages);
    const limitFiles = [{ path: 'manifest.json', bytes: built.manifestBytes }];
    for (const pkg of built.manifest.packages) {
      for (const file of pkg.files) {
        limitFiles.push({
          path: `${pkg.package}@${pkg.version}/${file.path}`,
          bytes: file.bytes,
        });
      }
    }
    const limits = checkAssetLimits(limitFiles);
    if (!limits.ok) {
      throw new Error(limits.errors.join('\n'));
    }
    printSummary(built);
    return { out: resolvedOut, ...built, limits };
  } catch (error) {
    await rm(resolvedOut, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

async function main() {
  const args = parseBuildArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      'usage: node cdn/scripts/build-assets.mjs [outDir] [--out dir] [--config file]\n',
    );
    return;
  }
  await buildAssets({ out: args.out, configPath: args.config });
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}
