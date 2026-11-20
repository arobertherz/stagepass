import { highestStable, highestStableInMajor, parseSemver } from './semver.js';

function recordsFor(manifest, packageName) {
  const packages = manifest && Array.isArray(manifest.packages) ? manifest.packages : [];
  const records = [];
  for (const pkg of packages) {
    if (!pkg || pkg.package !== packageName || typeof pkg.version !== 'string') continue;
    records.push(pkg);
  }
  return records;
}

export function recordFor(manifest, packageName, version) {
  const records = recordsFor(manifest, packageName);
  for (const record of records) {
    if (record.version === version) return record;
  }
  return null;
}

export function fileSet(record) {
  const files = new Set();
  const list = record && Array.isArray(record.files) ? record.files : [];
  for (const file of list) {
    if (file && typeof file.path === 'string') files.add(file.path);
  }
  return files;
}

// `distTags.latest` when that version is in the manifest. Otherwise the
// highest stable version. Null when the package has no stable version.
export function resolveLatestVersion(manifest, packageName) {
  const tags = manifest && manifest.distTags && manifest.distTags[packageName];
  const latest = tags && typeof tags.latest === 'string' ? tags.latest : null;
  if (latest && recordFor(manifest, packageName, latest)) return latest;
  return highestStable(recordsFor(manifest, packageName).map((record) => record.version));
}

export function resolveMajorVersion(manifest, packageName, major) {
  return highestStableInMajor(
    recordsFor(manifest, packageName).map((record) => record.version),
    major,
  );
}

export function stableMajors(manifest, packageName) {
  const majors = new Set();
  for (const record of recordsFor(manifest, packageName)) {
    const parsed = parseSemver(record.version);
    if (!parsed || parsed.prerelease) continue;
    majors.add(parsed.major);
  }
  return [...majors].sort((left, right) => left - right);
}

// `file` set: that file in `version`. `file` empty: the version's `entry`.
// Null when the version or the file is not in the manifest.
export function aliasLocation(manifest, packageName, version, file) {
  const record = recordFor(manifest, packageName, version);
  if (!record) return null;
  const target = file ? file : record.entry;
  if (typeof target !== 'string' || target.length === 0) return null;
  if (!fileSet(record).has(target)) return null;
  return `/${packageName}@${version}/${target}`;
}
