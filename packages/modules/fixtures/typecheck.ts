/// <reference path="../global.d.ts" />
/// <reference path="../../loader/global.d.ts" />

/**
 * Typecheck fixture for modules declaration merging.
 * Run: tsc --noEmit -p fixtures/tsconfig.json
 */
const api = window.stagepass;
if (api.inject) {
  void api.inject({
    src: 'https://cdn.example.com/app.js',
    version: '2.0.0',
    integrity: 'sha384-abc',
    crossorigin: 'anonymous',
    nonce: 'n',
    allowedHosts: ['cdn.example.com'],
  });
}
if (api.cookies) {
  api.cookies.bake('a', 'b', { category: 'analytics' });
  api.cookies.eat('a');
  api.cookies.has('a');
  api.cookies.list();
  api.cookies.throw('a');
  api.cookies.throwAll({ category: 'analytics' });
  api.cookies.jar();
  api.cookies.crumbs('a');
}
if (api.cookie) {
  api.cookie.bake('x', 'y');
}
if (api.consent) {
  api.consent.set((category) => category !== 'marketing');
  void api.consent.allows('analytics');
  api.consent.update();
}
if (api.maintenance) {
  api.maintenance.enable({ title: 'Soon', text: 'Back shortly' });
  void api.maintenance.isActive();
  api.maintenance.disable();
}
