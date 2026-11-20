import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  loadPackageConfig,
  missingVersions,
  readRegistryVersions,
  selectVersions,
} from './build-assets.mjs';

// Prints one stdout line: pending=true, pending=false, or pending=unknown.
// Network and registry failures print pending=unknown and exit 0 so a schedule
// can skip the deploy instead of turning red every half hour.
function parseArgs(argv) {
  let manifestUrl;
  let config;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--manifest-url') {
      manifestUrl = argv[i + 1];
      i += 1;
      if (!manifestUrl) throw new Error('--manifest-url needs a URL');
    } else if (arg === '--config') {
      config = argv[i + 1];
      i += 1;
      if (!config) throw new Error('--config needs a file');
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!manifestUrl) throw new Error('usage: pending-versions.mjs --manifest-url URL');
  return { manifestUrl, config };
}

export async function pendingVersions({ manifestUrl, config } = {}) {
  const loaded = await loadPackageConfig(config);
  const wanted = [];
  for (const pkg of loaded.packages) {
    const versions = await readRegistryVersions(pkg.npm);
    // Every published version except the emergency exclude list.
    for (const version of selectVersions(versions, { exclude: pkg.exclude })) {
      wanted.push({ package: pkg.package, version });
    }
  }
  const response = await fetch(manifestUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 404) return { pending: true, missing: wanted, reason: 'manifest 404' };
  if (!response.ok || (response.status >= 300 && response.status < 400)) {
    throw new Error(`manifest status ${response.status}`);
  }
  const manifest = await response.json();
  const missing = missingVersions(wanted, manifest);
  return { pending: missing.length > 0, missing, reason: missing.length ? 'versions missing' : 'in sync' };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  try {
    const result = await pendingVersions(args);
    if (result.missing.length > 0) {
      console.error(result.reason);
      console.error(result.missing.map((item) => `${item.package}@${item.version}`).join(', '));
    }
    console.log(result.pending ? 'pending=true' : 'pending=false');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.log('pending=unknown');
  }
}

if (isDirectRun()) {
  main();
}
