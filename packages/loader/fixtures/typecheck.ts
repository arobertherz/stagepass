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

const g: typeof stagepass = stagepass;
const alias: typeof sp = sp;
void _v;
void _env;
void url;
void g;
void alias;
