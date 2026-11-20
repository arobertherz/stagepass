// Exact semver, including prerelease. Build metadata (+) is rejected.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;

export function parseSemver(value) {
  if (typeof value !== 'string') return null;
  const match = SEMVER.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : null,
    raw: value,
  };
}

export function isExactSemver(value) {
  return parseSemver(value) !== null;
}

function compareIdentifier(left, right) {
  const leftNum = /^(0|[1-9]\d*)$/.test(left);
  const rightNum = /^(0|[1-9]\d*)$/.test(right);
  if (leftNum && rightNum) {
    if (left.length !== right.length) return left.length - right.length;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  if (leftNum) return -1;
  if (rightNum) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

// Semver precedence. A release is greater than its own prerelease.
export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) {
    throw new Error('compareSemver requires exact versions');
  }
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    if (i >= a.prerelease.length) return -1;
    if (i >= b.prerelease.length) return 1;
    const diff = compareIdentifier(a.prerelease[i], b.prerelease[i]);
    if (diff !== 0) return diff;
  }
  return 0;
}

// True when `version` is greater than or equal to `floor` in semver precedence.
// 2.3.0-beta.1 is included for floor 2.0.0. 2.0.0-beta.1 is not, because it precedes 2.0.0.
export function versionAtLeast(version, floor) {
  if (!parseSemver(version) || !parseSemver(floor)) return false;
  return compareSemver(version, floor) >= 0;
}
