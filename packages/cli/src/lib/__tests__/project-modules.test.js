import { describe, it, expect } from 'vitest';
import {
  normalizeModulesList,
  typesForModules,
  formatModules,
  sameModules,
  expandModules,
} from '../project-modules.js';

describe('normalizeModulesList', () => {
  it.each([
    [[], []],
    ['', []],
    ['none', []],
    ['[]', []],
    ['cookies', ['cookies']],
    ['maintenance, inject cookies', ['inject', 'cookies', 'maintenance']],
    [['cookies', 'cookies'], ['cookies']],
    ['all', ['all']],
    [['ALL'], ['all']],
  ])('%j -> %j', (input, out) => {
    expect(normalizeModulesList(input)).toEqual({ ok: true, modules: out });
  });
  it('rejects unknown ids; all absorbs the rest', () => {
    expect(normalizeModulesList('cookies,evil').ok).toBe(false);
    expect(normalizeModulesList('all,cookies')).toEqual({ ok: true, modules: ['all'] });
    expect(normalizeModulesList('"><script>').ok).toBe(false);
  });
});

describe('typesForModules', () => {
  it('none, single, all', () => {
    expect(typesForModules([], { modulesDependency: true })).toEqual(['@stagepass/loader']);
    expect(typesForModules(['cookies'], { modulesDependency: true })).toEqual(['@stagepass/loader', '@stagepass/modules/cookies']);
    expect(typesForModules(['all'], { modulesDependency: true })).toEqual(['@stagepass/loader', '@stagepass/modules']);
    expect(typesForModules(['all'], { modulesDependency: false })).toEqual(['@stagepass/loader']);
  });
  it('formats and compares', () => {
    expect(formatModules([])).toBe('none');
    expect(formatModules(['inject', 'cookies'])).toBe('inject, cookies');
    expect(expandModules(['all'])).toEqual(['inject', 'cookies', 'maintenance']);
    expect(sameModules(['all'], ['all'])).toBe(true);
    expect(sameModules(['cookies'], [])).toBe(false);
  });
});
