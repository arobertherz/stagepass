/**
 * Generated AI guidance (AGENTS.md managed block + Cursor rule).
 *
 * Content depends on the declared modules so agents only see APIs that
 * actually run on the Webflow site.
 */

import { MODULE_IDS, expandModules, formatModules } from './project-modules.js';

export const BLOCK_BEGIN = '<!-- stagepass:begin -->';
export const BLOCK_END = '<!-- stagepass:end -->';
export const CURSOR_RULE_PATH = '.cursor/rules/stagepass.mdc';

const LOADER_SECTION = `### Loader API (always available)

\`sp\` (same object as \`window.stagepass\`) is created by \`loader.min.js\` in the Webflow head before your bundle runs.

| API | Returns | Notes |
| --- | --- | --- |
| \`sp.vars\` | frozen object | \`isLocal\`, \`env\`, \`domain\`, \`timestamp\`, \`version\`, \`client\` |
| \`sp.env()\` | \`'local' \\| 'staging' \\| 'production'\` | \`local\` = active session to a \`.sp\` domain; \`staging\` = \`*.webflow.io\` or \`data-stagepass-staging-hosts\` |
| \`sp.is(name)\` | \`boolean\` | \`true\` when \`sp.env() === name\` |
| \`sp.can(cap)\` | \`boolean\` | \`'localStorage' \\| 'sessionStorage' \\| 'cookies' \\| 'serviceWorker'\`; anything else is \`false\` |
| \`sp.client(key?)\` | \`unknown\` | key of \`sp.vars.client\` (\`theme\`, \`browser\`, \`os\`, \`device\`, \`viewport\`, \`locale\`, \`capabilities\`), or the whole object |
| \`sp.log(...)\`, \`sp.warn(...)\`, \`sp.error(...)\` | \`void\` | prefixed console output, only while a Stagepass session is active |
| \`sp.resolveLocalUrl(path)\` | \`string\` | local HTTPS URL during a session, \`''\` otherwise |
| \`sp.on('theme', fn)\` | unsubscribe \`() => void\` | payload \`{ preferred, current }\` on color scheme changes |
| \`sp.on('session', fn)\` | unsubscribe \`() => void\` | payload \`{ active, domain, swap, debug }\` |
| \`sp.use(name, version, factory)\` | \`boolean\` | module registration (used by @stagepass/modules, not needed in app code) |

\`\`\`ts
if (sp.is('local')) sp.log('running against the local dev server');
const off = sp.on('theme', (payload) => {
  const { current } = payload as { current: string };
  document.documentElement.dataset.theme = current;
});
if (sp.can('localStorage')) localStorage.setItem('seen', '1');
\`\`\``;

const MODULE_SECTIONS = {
  inject: `### Module: inject (\`sp.inject\`)

Loads extra scripts and stylesheets. Webflow script tag: \`@stagepass/modules@2/dist/inject.min.js\` after \`loader.min.js\`.

\`\`\`ts
if (sp.inject) {
  await sp.inject({ src: 'https://cdn.example.com/lib.js', defer: true, stagepass: false });
  await sp.inject({ src: 'https://cdn.example.com/site/widgets.js', localPath: 'dist/widgets.js' });
  await sp.inject({ scripts: [{ src: 'https://cdn.example.com/a.js' }], styles: [{ src: 'https://cdn.example.com/a.css' }] });
}
\`\`\`

Argument: one options object, an array of them, or \`{ scripts?, styles? }\`. Returns \`Promise<void>\`.
Options: \`src\` (required), \`type\` (\`'script' \\| 'style'\`), \`stagepass\` (default true: during a session the file is served from the local project via \`localPath\`/\`path\` or the file name; \`false\` always uses \`src\`), \`localPath\`, \`path\`, \`id\`, \`async\`, \`defer\`, \`version\` (adds \`?v=\` in production), \`attributes\`, \`position\` (\`'head' \\| 'body-start' \\| 'body-end' \\| { target, action: 'before' \\| 'after' }\`), \`integrity\`, \`crossorigin\`, \`nonce\`, \`allowedHosts\`.`,
  cookies: `### Module: cookies (\`sp.cookies\`, alias \`sp.cookie\`, plus \`sp.consent\`)

Webflow script tag: \`@stagepass/modules@2/dist/cookies.min.js\` after \`loader.min.js\`.

\`\`\`ts
if (sp.cookies) {
  sp.cookies.bake('visited', '1', { days: 30, sameSite: 'Lax' });
  const prefs = sp.cookies.eat('prefs', { json: true }); // value or null
  if (sp.cookies.has('visited')) sp.cookies.throw('visited');
  sp.cookies.bake('ga', 'x', { category: 'analytics' }); // queued until consent allows it
}
if (sp.consent) {
  const accepted = ['necessary', 'analytics']; // from your consent banner
  sp.consent.set((category) => accepted.includes(category));
  sp.consent.update(); // flush queued cookies against the consent function
}
\`\`\`

Cookies: \`bake(name, value, options?)\`, \`eat(name, { decode?, json? })\` (value or \`null\`), \`throw(name, { path?, domain?, secure?, sameSite? })\`, \`has(name)\`, \`list({ decode?, json? })\`, \`throwAll({ category? })\`, \`jar()\`, \`crumbs(prefix)\`.
Write options: \`days\`, \`maxAge\`, \`path\`, \`domain\`, \`secure\`, \`sameSite\`, \`encode\`, \`json\`, \`category\`.
Consent: \`allows(category)\`, \`set(fn)\`, \`update()\`.`,
  maintenance: `### Module: maintenance (\`sp.maintenance\`)

Webflow script tag: \`@stagepass/modules@2/dist/maintenance.min.js\` after \`loader.min.js\` (optional attributes \`data-stagepass-maintenance="true"\`, \`data-stagepass-maintenance-title\`, \`data-stagepass-maintenance-text\`).

\`\`\`ts
if (sp.maintenance && !sp.maintenance.isActive()) {
  sp.maintenance.enable({ title: 'Back soon', text: 'We are updating the site.' });
}
\`\`\`

API: \`enable({ title?, text? })\`, \`disable()\`, \`isActive()\`. Developer sessions see a badge instead of the overlay. This is a visual overlay, not access protection.`,
};

function unavailableLine(id) {
  return `- \`sp.${id}\`: not available; enable by adding the \`${id}.min.js\` script tag after \`loader.min.js\` in Webflow, adding \`"${id}"\` to \`modules\` in stagepass.json, and running \`stagepass upgrade\`.`;
}

/**
 * Inner Markdown for the managed block (without markers).
 * @param {string[]} modules normalized declared list
 */
export function buildGuideBody(modules) {
  const enabled = expandModules(modules);
  const disabled = MODULE_IDS.filter((id) => !enabled.includes(id));
  const parts = [
    '## Stagepass runtime API',
    '',
    `Generated by \`stagepass upgrade\` from \`stagepass.json\` (modules: ${formatModules(modules)}). Do not edit inside this block; it is replaced on upgrade.`,
    '',
    '**Rule for agents:** only use the `sp.*` APIs listed below. Never call `sp.<module>` APIs that are not listed as available. If a task needs one, tell the user to enable that module first (Webflow script tag, stagepass.json, `stagepass upgrade`). Guard optional modules (`if (sp.cookies) { ... }`).',
    '',
    LOADER_SECTION,
  ];
  for (const id of enabled) {
    parts.push('', MODULE_SECTIONS[id]);
  }
  if (disabled.length > 0) {
    parts.push('', '### Modules not enabled in this project', '');
    for (const id of disabled) parts.push(unavailableLine(id));
  }
  return parts.join('\n');
}

/** Full managed block including markers. */
export function buildManagedBlock(modules) {
  return `${BLOCK_BEGIN}\n${buildGuideBody(modules)}\n${BLOCK_END}`;
}

/**
 * Insert or replace the managed block in existing content.
 * Content outside the markers is preserved byte for byte.
 *
 * @param {string} content
 * @param {string} block full block incl. markers
 * @returns {{ content: string, action: 'inserted' | 'updated' | 'unchanged' | 'invalid' }}
 */
export function upsertManagedBlock(content, block) {
  const begin = content.indexOf(BLOCK_BEGIN);
  const end = content.indexOf(BLOCK_END);
  if (begin === -1 && end === -1) {
    const sep = content.length === 0 ? '' : content.endsWith('\n\n') ? '' : content.endsWith('\n') ? '\n' : '\n\n';
    return { content: `${content}${sep}${block}\n`, action: 'inserted' };
  }
  if (begin === -1 || end === -1 || end < begin) {
    return { content, action: 'invalid' };
  }
  const next = content.slice(0, begin) + block + content.slice(end + BLOCK_END.length);
  return { content: next, action: next === content ? 'unchanged' : 'updated' };
}

/**
 * Cursor project rule (.cursor/rules/stagepass.mdc).
 * @param {string[]} modules
 */
export function buildCursorRule(modules) {
  return [
    '---',
    'description: Stagepass runtime API (sp) for this Webflow project',
    'globs: src/**',
    'alwaysApply: false',
    '---',
    '',
    buildManagedBlock(modules),
    '',
  ].join('\n');
}
