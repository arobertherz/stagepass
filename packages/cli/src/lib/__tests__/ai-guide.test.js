import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  BLOCK_BEGIN,
  BLOCK_END,
  CURSOR_POINTER_TEXT,
  buildAgentsPointerBlock,
  buildCursorRule,
  buildGuideBody,
  buildManagedBlock,
  buildStagepassGuide,
  decideStagepassAgentsUpdate,
  hasLegacyAgentsProse,
  inspectStagepassAgents,
  migrateCursorRuleContent,
  renderStagepassAgentsFile,
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
  it('always applies and points at AGENTS.stagepass.md', () => {
    const rule = buildCursorRule();
    expect(rule.startsWith('---\ndescription: ')).toBe(true);
    expect(rule).toContain('alwaysApply: true');
    expect(rule).not.toContain('globs:');
    expect(rule).toContain(CURSOR_POINTER_TEXT);
    expect(rule).toContain(BLOCK_BEGIN);
  });
});

const guideCtx = (extra = {}) => ({
  name: 'demo',
  domain: 'demo.sp',
  modules: [],
  php: false,
  phpBoilerplate: false,
  lang: 'ts',
  origin: 'demo.webflow.io',
  production: null,
  configFile: 'tsconfig.json',
  types: ['@stagepass/loader'],
  modulesDependency: true,
  ...extra,
});

describe('buildStagepassGuide', () => {
  it('documents only the declared modules and omits PHP when php is off', () => {
    const cookies = buildStagepassGuide(guideCtx({ modules: ['cookies'], types: ['@stagepass/loader', '@stagepass/modules/cookies'] }));
    expect(cookies).toContain('sp.cookies.bake');
    expect(cookies).toContain('`sp.inject`: not available');
    expect(cookies).toContain('`sp.maintenance`: not available');
    expect(cookies).not.toContain('`sp.cookies`: not available');
    expect(cookies).not.toContain('\n## PHP\n');
    expect(cookies).not.toContain('load_dotenv(');
    expect(cookies).toContain('stagepass dev');
    expect(cookies).toContain('npm run dev');
    const cookiesWorkflow = cookies.split('## Local workflow')[1].split('## Types')[0];
    expect(cookiesWorkflow).not.toContain('api/');
    expect(cookiesWorkflow).not.toContain('.php/');

    const all = buildStagepassGuide(guideCtx({ modules: ['all'], php: true, phpBoilerplate: true }));
    expect(all).toContain('if (sp.inject)');
    expect(all).toContain('if (sp.cookies)');
    expect(all).toContain('if (sp.maintenance');
    expect(all).not.toContain('not available');
    expect(all).toContain('\n## PHP\n');
    expect(all).toContain('load_dotenv(string $path): void');
    const phpWorkflow = all.split('## Local workflow')[1].split('## Types')[0];
    expect(phpWorkflow).toContain('api/');
    expect(phpWorkflow).toContain('.php/');
    expect(phpWorkflow).toContain('.php/rate-limit/');
  });

  it('tells the agent the boilerplate is missing instead of listing helpers', () => {
    const guide = buildStagepassGuide(guideCtx({ php: true, phpBoilerplate: false }));
    expect(guide).toContain('api/lib/');
    expect(guide).toContain('Do not rebuild');
    expect(guide).not.toContain('load_dotenv(');
    expect(guide).not.toContain('action_catalog(array');
  });

  it('names only helpers that exist in the PHP templates, with the real signature', () => {
    const guide = buildStagepassGuide(guideCtx({ php: true, phpBoilerplate: true, modules: ['all'] }));
    const section = guide.split('\n## PHP\n')[1];
    const signatures = [...section.matchAll(/^- `([^`]+)`/gm)].map((match) => match[1]);
    const functions = signatures.filter((sig) => sig.includes('('));
    expect(functions.length).toBeGreaterThan(20);
    const required = [
      'load_dotenv',
      'env_string',
      'env_int',
      'env_list',
      'load_config',
      'private_dir',
      'request_method',
      'request_origin',
      'client_ip',
      'respond_success',
      'respond_fail',
      'respond_error',
      'origin_is_allowed',
      'apply_cors_headers',
      'honeypot_is_filled',
      'rate_limit_allows',
      'rate_limit_storage_available',
      'validate_required',
      'validate_email',
      'validate_max_length',
      'load_handler',
      'action_catalog',
      'parse_input',
      'input_string',
    ];
    for (const name of required) {
      expect(functions.some((sig) => sig.startsWith(`${name}(`))).toBe(true);
    }
    expect(section).toContain('ValidationException');
    expect(section).toContain('TRUSTED_PROXIES');
    expect(section).toContain('TRUSTED_PROXY_HEADER');
    expect(section).toContain('php-private/');
    expect(section).toContain('api/actions/newsletter.php');
    expect(section).toContain('CURLOPT_TIMEOUT');
    expect(section).toContain('error_log');
    expect(section).toContain('**MUST**');
    expect(section).toContain('**NEVER**');

    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../templates/project');
    const sources = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(abs);
        else if (entry.name.endsWith('.php')) sources.push(fs.readFileSync(abs, 'utf8'));
      }
    };
    walk(root);
    const php = sources.join('\n');
    for (const sig of functions) {
      expect(php, sig).toContain(sig);
    }
    expect(php).toContain('class ValidationException');
  });
});

describe('AGENTS.stagepass.md hash', () => {
  const desired = () => renderStagepassAgentsFile(buildStagepassGuide(guideCtx()));

  it('round-trips a managed file and notices a hand edit', () => {
    const file = desired();
    expect(file.startsWith('<!-- stagepass:managed cli=')).toBe(true);
    expect(file).toContain('Do not edit this file by hand');
    expect(inspectStagepassAgents(file).status).toBe('managed');
    expect(decideStagepassAgentsUpdate({ existing: file, desired: file, assumeYes: false, interactive: false }).action).toBe(
      'current'
    );
    const edited = `${file}hand edited\n`;
    expect(inspectStagepassAgents(edited).status).toBe('edited');
    expect(
      decideStagepassAgentsUpdate({ existing: edited, desired: file, assumeYes: false, interactive: false }).action
    ).toBe('hint');
    expect(
      decideStagepassAgentsUpdate({ existing: edited, desired: file, assumeYes: true, interactive: false }).action
    ).toBe('update');
    expect(
      decideStagepassAgentsUpdate({ existing: '# notes\n', desired: file, assumeYes: false, interactive: true }).action
    ).toBe('ask');
    expect(decideStagepassAgentsUpdate({ existing: null, desired: file, assumeYes: false, interactive: false }).action).toBe(
      'create'
    );
  });

  it('treats CRLF as the same managed file', () => {
    const file = desired();
    const crlf = file.replace(/\n/g, '\r\n');
    expect(inspectStagepassAgents(crlf).status).toBe('managed');
    expect(
      decideStagepassAgentsUpdate({ existing: crlf, desired: file, assumeYes: false, interactive: false }).action
    ).toBe('current');
  });
});

describe('legacy agents prose and cursor migration', () => {
  it('detects old scaffold headings outside the markers only', () => {
    const outside = `# Mine\n\n## Stagepass feature set\n\n${BLOCK_BEGIN}\napi\n${BLOCK_END}\n`;
    expect(hasLegacyAgentsProse(outside)).toBe(true);
    expect(hasLegacyAgentsProse(`# Mine\n\n${buildAgentsPointerBlock()}\n`)).toBe(false);
    expect(hasLegacyAgentsProse(`${BLOCK_BEGIN}\n## Stagepass feature set\n`)).toBe(false);
  });

  it('rewrites the old generated frontmatter and leaves a custom one', () => {
    const old = `---\ndescription: Stagepass runtime API (sp) for this Webflow project\nglobs: src/**\nalwaysApply: false\n---\n\n${BLOCK_BEGIN}\nold\n${BLOCK_END}\nTail\n`;
    const next = migrateCursorRuleContent(old);
    expect(next).toContain('alwaysApply: true');
    expect(next).not.toContain('globs:');
    expect(next.endsWith('Tail\n')).toBe(true);
    expect(migrateCursorRuleContent('---\ndescription: Mine\nalwaysApply: false\n---\n')).toBe(
      '---\ndescription: Mine\nalwaysApply: false\n---\n'
    );
  });
});
