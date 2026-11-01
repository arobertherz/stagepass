/// <reference path="../global.d.ts" />
/// <reference path="../../loader/global.d.ts" />

/**
 * Typecheck fixture for modules declaration merging.
 * Run: tsc --noEmit -p fixtures/tsconfig.json
 */
const api = window.stagepass;
if (api.inject) {
  void api.inject({ src: 'https://cdn.example.com/app.js', version: '2.0.0-beta.1' });
}
if (api.cookies) {
  api.cookies.bake('a', 'b');
  api.cookies.eat('a');
  api.cookies.has('a');
  api.cookies.list();
  api.cookies.throw('a');
}
