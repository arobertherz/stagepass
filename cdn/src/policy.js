// Shared response policy. Kept out of worker.js exports: workerd rejects
// non-function module exports on the worker entry ("not of type function or
// ExportedHandler"). Tests import these values from this module.

// Versioned files are immutable. Errors, the index, the manifest, and
// unsupported aliases stay short so a typo or a just-published version is not
// pinned for a year.
// max-age=60 (not no-store) lets a shared cache absorb a burst of misses
// without outliving the next deploy by more than a minute.
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
export const SHORT_CACHE = 'public, max-age=60';
// Major aliases (`@2`, `@2.x`) 302 to an exact file. Five minutes is how long
// a cache may keep the previous target after a deploy. No purge is required.
export const MAJOR_ALIAS_CACHE = 'public, max-age=300';

export const ROOT_BODY =
  'Stagepass CDN. Exact versions: /loader@<version>/<file> and /modules@<version>/<file>. Major aliases (@1, @2, @1.x, @2.x) redirect to the highest stable release. Manifest: /manifest.json.\n';
export const NOT_FOUND_BODY = 'Not found.\n';
export const ALIAS_BODY =
  'Not found. This CDN serves exact versions, for example /loader@2.5.0/loader.min.js. Major aliases such as @2 and @2.x redirect to the highest stable release in that major. @latest, @next, and ranges such as @2.5 are not served.\n';
export const METHOD_BODY = 'Method not allowed.\n';
export const BAD_GATEWAY_BODY = 'Asset server error.\n';

export const FORBIDDEN_HEADERS = [
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'x-frame-options',
  'permissions-policy',
  'referrer-policy',
];
