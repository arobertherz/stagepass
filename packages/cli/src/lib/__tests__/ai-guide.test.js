import { describe, it, expect } from 'vitest';
import {
  BLOCK_BEGIN,
  BLOCK_END,
  buildCursorRule,
  buildGuideBody,
  buildManagedBlock,
  upsertManagedBlock,
} from '../ai-guide.js';

describe('buildGuideBody', () => {
  it('none: loader API only, every module listed as not available', () => {
    const body = buildGuideBody([]);
    expect(body).toContain('modules: none');
    expect(body).toContain('sp.vars');
    expect(body).toContain('sp.on(');
    expect(body).toMatch(/Never call `sp\.<module>`/);
    for (const id of ['inject', 'cookies', 'maintenance']) {
      expect(body).toContain(`\`sp.${id}\`: not available; enable by`);
      expect(body).not.toContain(`### \`sp.${id}\``);
    }
  });

  it('single module: full section for it, others unavailable', () => {
    const body = buildGuideBody(['cookies']);
    expect(body).toContain('sp.cookies.bake');
    expect(body).toContain('sp.consent');
    expect(body).toContain('if (sp.cookies)');
    expect(body).toContain('`sp.inject`: not available');
    expect(body).toContain('`sp.maintenance`: not available');
    expect(body).not.toContain('`sp.cookies`: not available');
  });

  it('all: every module documented, nothing listed as unavailable', () => {
    const body = buildGuideBody(['all']);
    expect(body).toContain('if (sp.inject)');
    expect(body).toContain('if (sp.cookies)');
    expect(body).toContain('if (sp.maintenance');
    expect(body).not.toContain('not available');
    expect(body).not.toContain('Modules not enabled');
  });
});

describe('upsertManagedBlock', () => {
  const block = buildManagedBlock(['cookies']);
  it('inserts into a file without markers and preserves content', () => {
    const r = upsertManagedBlock('# Mine\n\nKeep me.\n', block);
    expect(r.action).toBe('inserted');
    expect(r.content.startsWith('# Mine\n\nKeep me.\n\n')).toBe(true);
    expect(r.content.endsWith(`${BLOCK_END}\n`)).toBe(true);
  });
  it('replaces only between markers', () => {
    const old = `top\n${BLOCK_BEGIN}\nold stuff\n${BLOCK_END}\nbottom\n`;
    const r = upsertManagedBlock(old, block);
    expect(r.action).toBe('updated');
    expect(r.content.startsWith('top\n')).toBe(true);
    expect(r.content.endsWith('\nbottom\n')).toBe(true);
    expect(r.content).not.toContain('old stuff');
    expect(upsertManagedBlock(r.content, block).action).toBe('unchanged');
  });
  it('refuses broken markers', () => {
    expect(upsertManagedBlock(`${BLOCK_BEGIN}\nno end`, block).action).toBe('invalid');
    expect(upsertManagedBlock(`${BLOCK_END}\n${BLOCK_BEGIN}`, block).action).toBe('invalid');
  });
});

describe('buildCursorRule', () => {
  it('has frontmatter scoped to src/**', () => {
    const rule = buildCursorRule([]);
    expect(rule.startsWith('---\ndescription: ')).toBe(true);
    expect(rule).toContain('\nglobs: src/**\n');
    expect(rule).toContain('alwaysApply: false');
    expect(rule).toContain(BLOCK_BEGIN);
  });
});
