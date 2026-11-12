import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  defaultTemplatesRoot,
  scaffoldPhpTemplateMap,
  scaffoldTemplateMap,
} from '../scaffold.js';

function walk(dir, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory()
      ? walk(path.join(dir, d.name), `${prefix}${d.name}/`)
      : [`${prefix}${d.name}`]
  );
}

describe('scaffold templates', () => {
  const root = defaultTemplatesRoot();

  it('contains no dotfiles (npm pack drops .gitignore / .npmignore)', () => {
    const dotted = walk(root).filter((rel) =>
      rel.split('/').some((part) => part.startsWith('.'))
    );
    expect(dotted).toEqual([]);
  });

  it.each([
    ['ts', 'scss'],
    ['ts', 'css'],
    ['js', 'scss'],
    ['js', 'css'],
  ])('every template for %s/%s exists', (lang, styles) => {
    const map = scaffoldTemplateMap(lang, styles);
    for (const { template } of map) {
      expect(fs.existsSync(path.join(root, template)), template).toBe(true);
    }
    expect(map.map((m) => m.out)).toContain('.gitignore');
  });

  it('cli-php: boilerplate templates exist when enabled and examples are not a second copy', () => {
    expect(scaffoldPhpTemplateMap({ php: false })).toEqual([]);
    const withApi = scaffoldPhpTemplateMap({ php: true, phpExamples: true });
    for (const { template } of withApi) {
      expect(fs.existsSync(path.join(root, template)), template).toBe(true);
      expect(template.split('/').some((part) => part.startsWith('.'))).toBe(false);
    }
    const outs = withApi.map((m) => m.out);
    expect(outs).toEqual(
      expect.arrayContaining([
        'api/README.md',
        'api/action.php',
        'api/actions/ping.php',
        'api/actions/contact.php',
        'api/.env.example',
        '.php/config.php',
      ])
    );
    expect(outs.some((out) => out.startsWith('examples/php/'))).toBe(false);
  });
});
