/// <reference path="../cookies.d.ts" />
/// <reference path="../../loader/global.d.ts" />

/**
 * Per-module entry: only the cookies module is declared.
 * Run: tsc --noEmit -p fixtures/tsconfig.cookies.json
 */
if (sp.cookies) {
  sp.cookies.bake('visited', '1', { days: 30, sameSite: 'Lax' });
  sp.cookies.eat('visited');
}
if (sp.consent) {
  sp.consent.set((category) => category === 'necessary');
  sp.consent.update();
}
// @ts-expect-error inject module is not declared in this project
void sp.inject;
// @ts-expect-error maintenance module is not declared in this project
void sp.maintenance;
