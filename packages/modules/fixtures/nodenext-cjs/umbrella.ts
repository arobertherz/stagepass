/**
 * AC-4: NodeNext umbrella consumer typecheck (CJS; package.json has no "type": "module").
 * Same positive and negative checks as the ESM fixture.
 */
import '@stagepass/modules';

if (sp.inject) {
  void sp.inject({
    src: 'https://cdn.example.com/app.js',
    version: '2.2.1',
  });
  void sp.inject({});
  // @ts-expect-error src must be a string (no any-fallback)
  void sp.inject({ src: 123 });
}
if (sp.cookies) {
  sp.cookies.bake('visited', '1', { days: 30 });
  sp.cookies.eat('visited');
  // @ts-expect-error crumbs expects a string prefix
  sp.cookies.crumbs(5);
}
if (sp.cookie) {
  sp.cookie.bake('x', 'y');
  // @ts-expect-error eat expects a string name
  sp.cookie.eat(5);
}
if (sp.consent) {
  sp.consent.set((category) => category === 'necessary');
  void sp.consent.allows('necessary');
  sp.consent.update();
  // @ts-expect-error set expects a predicate, not a number
  sp.consent.set(5);
}
if (sp.maintenance) {
  sp.maintenance.enable({ title: 'Soon', text: 'Back shortly' });
  void sp.maintenance.isActive();
  sp.maintenance.disable();
  // @ts-expect-error title must be a string
  sp.maintenance.enable({ title: 5 });
}
