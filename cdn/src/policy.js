// Shared response policy. Kept out of worker.js exports: workerd rejects
// non-function module exports on the worker entry ("not of type function or
// ExportedHandler"). Tests import these values from this module.

// Versioned files are immutable. Errors, the index, and the manifest stay short
// so a typo or a just-published version is not pinned for a year.
// max-age=60 (not no-store) lets a shared cache absorb a burst of misses
// without outliving the next deploy by more than a minute.
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
export const SHORT_CACHE = 'public, max-age=60';

export const ROOT_BODY =
  'Stagepass CDN. Exact versions only: /loader@<version>/<file> and /modules@<version>/<file>. Manifest: /manifest.json.\n';
export const NOT_FOUND_BODY = 'Not found.\n';
export const ALIAS_BODY =
  'Not found. This CDN serves exact versions only, for example /loader@2.5.0/loader.min.js. Floating aliases such as @latest, @2, and @2.5 are not served.\n';
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
