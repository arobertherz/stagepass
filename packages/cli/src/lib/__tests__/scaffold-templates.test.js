import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { defaultTemplatesRoot, scaffoldTemplateMap } from '../scaffold.js';

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
});
