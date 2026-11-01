/// <reference path="../global.d.ts" />

/**
 * Typecheck fixture: ensures Window.stagepass / stagepass / sp are typed.
 * Run: tsc --noEmit -p fixtures/tsconfig.json
 */
const api = window.stagepass;
const _v: string = api.vars.version;
const _env: 'local' | 'staging' | 'production' = api.vars.env;
api.log('hello');
api.warn('warn');
api.error('err');
const url: string = api.resolveLocalUrl('app.js');

const envName = api.env();
const isLocal = api.is('local');
const canLs = api.can('localStorage');
const canSw = api.can('serviceWorker');
const theme = api.client('theme');
const unsub = api.on('theme', (_payload) => {});
unsub();
api.use('demo', '2.0.0', (sp) => {
  void sp.vars;
});

const g: typeof stagepass = stagepass;
const alias: typeof sp = sp;
void _v;
void _env;
void url;
void envName;
void isLocal;
void canLs;
void canSw;
void theme;
void g;
void alias;
