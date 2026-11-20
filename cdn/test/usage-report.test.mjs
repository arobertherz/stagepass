import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildUsageQueries,
  formatSql,
  parseUsageArgs,
  queriesForReport,
  queryAnalytics,
} from '../scripts/usage-report.mjs';

const now = new Date(Date.UTC(2026, 10, 20, 15, 0, 0));

test('usage args default to the last seven days and reject unsafe input', () => {
  const parsed = parseUsageArgs(['--env', 'staging', '--print-sql'], now);
  assert.deepEqual(parsed, {
    env: 'staging',
    from: '2026-11-13',
    to: '2026-11-20',
    report: 'all',
    limit: 20,
    includeInternal: false,
    json: false,
    printSql: true,
  });
  assert.equal(parseUsageArgs(['--env=production', '--from=2026-11-01', '--to=2026-11-02', '--limit=5'], now).limit, 5);

  for (const argv of [
    [],
    ['--env', 'dev'],
    ['--env', 'staging', '--from', '2026-02-31'],
    ['--env', 'staging', '--from', "2026-01-01' OR 1=1 --"],
    ['--env', 'staging', '--from', '2026-11-20', '--to', '2026-11-01'],
    ['--env', 'staging', '--from', '2026-01-01', '--to', '2026-06-01'],
    ['--env', 'staging', '--limit', '0'],
    ['--env', 'staging', '--limit', '20.5'],
    ['--env', 'staging', '--limit', '1; DROP TABLE x'],
    ['--env', 'staging', '--limit', '1001'],
    ['--env', 'staging', '--report', 'hosts'],
    ['--env', 'staging', '--oops'],
  ]) {
    assert.throws(() => parseUsageArgs(argv, now), Error, argv.join(' '));
  }
});

test('usage SQL names the dataset, the sample interval, and the internal filter', () => {
  const args = parseUsageArgs(['--env', 'staging', '--report', 'all', '--limit', '20'], now);
  const queries = buildUsageQueries(args);
  assert.equal(queries['top-hosts'], [
    'SELECT blob2 AS host, SUM(_sample_interval) AS requests',
    'FROM stagepass_cdn_usage_staging',
    "WHERE timestamp >= toDateTime('2026-11-13 00:00:00') AND timestamp < toDateTime('2026-11-21 00:00:00') AND blob1 = 'staging' AND blob3 = '0'",
    'GROUP BY host',
    'ORDER BY requests DESC',
    'LIMIT 20',
  ].join('\n'));
  assert.match(queries.versions, /blob4 AS package, blob5 AS resolved_version, SUM\(_sample_interval\)/);
  assert.match(queries['last-seen'], /MAX\(timestamp\) AS last_seen/);
  assert.equal(queries['top-hosts'].includes('stagepass_cdn_usage\n') || queries['top-hosts'].includes('FROM stagepass_cdn_usage\n'), false);
  assert.equal(queries['top-hosts'].includes(';'), false);

  const production = buildUsageQueries(parseUsageArgs([
    '--env', 'production',
    '--include-internal',
    '--from', '2026-11-01',
    '--to', '2026-11-02',
    '--report', 'versions',
    '--limit', '7',
  ], now));
  assert.match(production.versions, /FROM stagepass_cdn_usage\n/);
  assert.equal(production.versions.includes('stagepass_cdn_usage_staging'), false);
  assert.match(production.versions, /blob1 = 'production'/);
  assert.equal(production.versions.includes("blob3 = '0'"), false);
  assert.match(production.versions, /LIMIT 7/);

  const selected = queriesForReport(args);
  assert.deepEqual(selected.map((query) => query.name), ['top-hosts', 'versions', 'last-seen']);
  const printed = formatSql(selected);
  assert.match(printed, /^-- top-hosts\nSELECT /);
  assert.match(printed, /\n\n-- versions\n/);
  assert.match(printed, /\n\n-- last-seen\n/);
});

test('analytics query posts SQL with the bearer token and not in the URL', async () => {
  let seen;
  const payload = await queryAnalytics({
    accountId: 'a'.repeat(32),
    token: 'token-value',
    sql: 'SELECT 1',
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ data: [{ ok: 1 }], rows: 1 }), { status: 200 });
    },
  });
  assert.deepEqual(payload.data, [{ ok: 1 }]);
  assert.equal(seen.url, `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/analytics_engine/sql`);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.body, 'SELECT 1');
  assert.equal(seen.init.headers.authorization, 'Bearer token-value');
  assert.equal(seen.url.includes('token-value'), false);
  await assert.rejects(
    () => queryAnalytics({ accountId: 'nope', token: 'token-value', sql: 'SELECT 1', fetchImpl: async () => {
      throw new Error('should not fetch');
    } }),
    /invalid account id/,
  );
});
