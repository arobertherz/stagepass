/// <reference path="../../loader/global.d.ts" />

/**
 * Loader only: no module APIs are typed.
 * Run: tsc --noEmit -p fixtures/tsconfig.none.json
 */
sp.on('theme', ({ current }) => {
  document.documentElement.dataset.theme = current;
});
sp.on('session', ({ active, swap }) => {
  if (active && swap) sp.log('local');
});
// @ts-expect-error cookies module is not declared
void sp.cookies;
// @ts-expect-error inject module is not declared
void sp.inject;
