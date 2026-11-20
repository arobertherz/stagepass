// Query Workers Analytics Engine for CDN usage. Node 22, no dependencies.
// The SQL API needs a token with Account Analytics Read. That right is not
// on the Workers deploy token.
//
//   node cdn/scripts/usage-report.mjs --env staging --report all --print-sql

import { pathToFileURL } from 'node:url';
import path from 'node:path';

export const DATASETS = Object.freeze({
  staging: 'stagepass_cdn_usage_staging',
  production: 'stagepass_cdn_usage',
});

export const REPORTS = Object.freeze(['top-hosts', 'versions', 'last-seen', 'all']);

const LIMIT_DEFAULT = 20;
const LIMIT_MAX = 1000;
const RANGE_MAX_DAYS = 92;
const ACCOUNT_ID = /^[a-f0-9]{32}$/i;

function formatUtc(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addUtcDays(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtc(date);
}

export function parseIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('invalid date');
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 2000 || year > 2100) throw new Error('invalid date');
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('invalid date');
  }
  return formatUtc(date);
}

function daysBetween(from, to) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86400000);
}

function parseLimit(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) throw new Error('invalid limit');
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > LIMIT_MAX) throw new Error('invalid limit');
  return limit;
}

function takeValue(argv, index, flag) {
  const inline = argv[index].indexOf('=');
  if (inline !== -1) return { value: argv[index].slice(inline + 1), next: index };
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`missing value for ${flag}`);
  return { value, next: index + 1 };
}

export function parseUsageArgs(argv, now = new Date()) {
  if (!Array.isArray(argv)) throw new Error('invalid arguments');
  let env = '';
  let from = '';
  let to = '';
  let report = 'all';
  let limit = LIMIT_DEFAULT;
  let includeInternal = false;
  let json = false;
  let printSql = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--include-internal') {
      includeInternal = true;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--print-sql') {
      printSql = true;
      continue;
    }
    if (arg === '--env' || arg.startsWith('--env=')) {
      const taken = takeValue(argv, i, '--env');
      env = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--from' || arg.startsWith('--from=')) {
      const taken = takeValue(argv, i, '--from');
      from = parseIsoDate(taken.value);
      i = taken.next;
      continue;
    }
    if (arg === '--to' || arg.startsWith('--to=')) {
      const taken = takeValue(argv, i, '--to');
      to = parseIsoDate(taken.value);
      i = taken.next;
      continue;
    }
    if (arg === '--report' || arg.startsWith('--report=')) {
      const taken = takeValue(argv, i, '--report');
      if (!REPORTS.includes(taken.value)) throw new Error('invalid report');
      report = taken.value;
      i = taken.next;
      continue;
    }
    if (arg === '--limit' || arg.startsWith('--limit=')) {
      const taken = takeValue(argv, i, '--limit');
      limit = parseLimit(taken.value);
      i = taken.next;
      continue;
    }
    throw new Error('invalid arguments');
  }

  if (env !== 'staging' && env !== 'production') throw new Error('invalid env');
  const today = formatUtc(now);
  if (!to) to = today;
  if (!from) from = addUtcDays(to, -7);
  if (daysBetween(from, to) < 0) throw new Error('invalid date range');
  if (daysBetween(from, to) > RANGE_MAX_DAYS) throw new Error('invalid date range');

  return {
    env,
    from,
    to,
    report,
    limit,
    includeInternal,
    json,
    printSql,
  };
}

function whereSql(args) {
  const datasetEnv = args.env === 'production' ? 'production' : 'staging';
  const end = addUtcDays(args.to, 1);
  const parts = [
    `timestamp >= toDateTime('${args.from} 00:00:00')`,
    `timestamp < toDateTime('${end} 00:00:00')`,
    `blob1 = '${datasetEnv}'`,
  ];
  if (!args.includeInternal) parts.push(`blob3 = '0'`);
  return parts.join(' AND ');
}

export function buildUsageQueries(args) {
  const dataset = DATASETS[args.env];
  if (!dataset || !/^[a-z0-9_]+$/.test(dataset)) throw new Error('invalid env');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from) || !/^\d{4}-\d{2}-\d{2}$/.test(args.to)) {
    throw new Error('invalid date');
  }
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > LIMIT_MAX) {
    throw new Error('invalid limit');
  }
  const where = whereSql(args);
  const limit = String(args.limit);
  return {
    'top-hosts': [
      'SELECT blob2 AS host, SUM(_sample_interval) AS requests',
      `FROM ${dataset}`,
      `WHERE ${where}`,
      'GROUP BY host',
      'ORDER BY requests DESC',
      `LIMIT ${limit}`,
    ].join('\n'),
    versions: [
      'SELECT blob2 AS host, blob4 AS package, blob5 AS resolved_version, SUM(_sample_interval) AS requests',
      `FROM ${dataset}`,
      `WHERE ${where}`,
      'GROUP BY host, package, resolved_version',
      'ORDER BY requests DESC',
      `LIMIT ${limit}`,
    ].join('\n'),
    'last-seen': [
      'SELECT blob2 AS host, MAX(timestamp) AS last_seen',
      `FROM ${dataset}`,
      `WHERE ${where}`,
      'GROUP BY host',
      'ORDER BY last_seen DESC',
      `LIMIT ${limit}`,
    ].join('\n'),
  };
}

export function queriesForReport(args) {
  const all = buildUsageQueries(args);
  if (args.report === 'all') {
    return [
      { name: 'top-hosts', sql: all['top-hosts'] },
      { name: 'versions', sql: all.versions },
      { name: 'last-seen', sql: all['last-seen'] },
    ];
  }
  if (!Object.prototype.hasOwnProperty.call(all, args.report)) throw new Error('invalid report');
  return [{ name: args.report, sql: all[args.report] }];
}

export function formatSql(queries) {
  return `${queries.map((query) => `-- ${query.name}\n${query.sql}`).join('\n\n')}\n`;
}

export async function queryAnalytics({ accountId, token, sql, fetchImpl }) {
  if (typeof accountId !== 'string' || !ACCOUNT_ID.test(accountId)) throw new Error('invalid account id');
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096 || /\s/.test(token)) {
    throw new Error('invalid token');
  }
  if (typeof sql !== 'string' || sql.length === 0 || sql.includes(';')) throw new Error('invalid sql');
  const fetchFn = fetchImpl || fetch;
  const response = await fetchFn(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'text/plain; charset=utf-8',
      },
      body: sql,
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`analytics query failed (${response.status})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('analytics query returned invalid json');
  }
}

function printRows(name, payload) {
  const rows = payload && Array.isArray(payload.data) ? payload.data : [];
  process.stdout.write(`${name}\n`);
  if (rows.length === 0) {
    process.stdout.write('(no rows)\n');
    return;
  }
  const keys = Object.keys(rows[0]);
  process.stdout.write(`${keys.join('\t')}\n`);
  for (const row of rows) {
    process.stdout.write(`${keys.map((key) => String(row[key] ?? '')).join('\t')}\n`);
  }
}

async function main() {
  const args = parseUsageArgs(process.argv.slice(2), new Date());
  const queries = queriesForReport(args);
  if (args.printSql) {
    process.stdout.write(formatSql(queries));
    return;
  }
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required');
  }
  const results = {};
  for (const query of queries) {
    results[query.name] = await queryAnalytics({ accountId, token, sql: query.sql });
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(results)}\n`);
    return;
  }
  for (const query of queries) printRows(query.name, results[query.name]);
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
