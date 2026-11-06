/**
 * F-4 / AC-4: NodeNext umbrella (Schirm) consumer typecheck.
 * Resolves `@stagepass/modules` via package `types` without skipLibCheck.
 * Catches missing `.js` extensions on global.d.ts re-exports (F-1).
 */
import '@stagepass/modules';

if (sp.inject) {
  void sp.inject({
    src: 'https://cdn.example.com/app.js',
    version: '2.2.1',
  });
}
if (sp.cookies) {
  sp.cookies.bake('visited', '1', { days: 30 });
  sp.cookies.eat('visited');
}
if (sp.cookie) {
  sp.cookie.bake('x', 'y');
}
if (sp.consent) {
  sp.consent.set((category) => category === 'necessary');
  void sp.consent.allows('necessary');
  sp.consent.update();
}
if (sp.maintenance) {
  sp.maintenance.enable({ title: 'Soon', text: 'Back shortly' });
  void sp.maintenance.isActive();
  sp.maintenance.disable();
}
