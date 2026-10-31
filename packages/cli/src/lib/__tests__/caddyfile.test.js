import { describe, it, expect } from 'vitest';
import {
  renderSiteBlock,
  parseBlocks,
  migrateLegacyContent,
  upsertBlock,
  removeBlock,
  extractRootFromBlock,
  BLOCK_VERSION,
  BLOCKED_PATH_REGEXP,
} from '../caddyfile.js';

const LEGACY_BLOCK = `# START: demo.sp
demo.sp {
    @options method OPTIONS
    handle @options {
        header Access-Control-Allow-Origin *
        header Access-Control-Allow-Methods *
        header Access-Control-Allow-Headers *
        header Access-Control-Max-Age 86400
        respond 204
    }

    root * "/Users/dev/Sites/demo"
    php_fastcgi 127.0.0.1:9000
    file_server
    tls internal
    header Access-Control-Allow-Origin *
    header Access-Control-Allow-Methods *
    header Access-Control-Allow-Headers *
}
# END: demo.sp`;

describe('renderSiteBlock', () => {
  it('renders default allowlist block with version marker and path blocks', () => {
    const block = renderSiteBlock('app.sp', '/Users/dev/Sites/app', {
      allowAllOrigins: false,
      origins: ['example.com'],
    });

    expect(block).toContain(`# stagepass-block: ${BLOCK_VERSION}`);
    expect(block).toContain('# stagepass-options: allowAllOrigins=false origins=example.com');
    expect(block).toContain(`@blocked path_regexp blocked ${BLOCKED_PATH_REGEXP}`);
    expect(block).toContain('respond 404');
    expect(block).toContain('Access-Control-Allow-Private-Network true');
    expect(block).toContain('Vary Origin');
    expect(block).toContain('webflow\\.io');
    expect(block).toContain('example\\.com');
    expect(block).not.toContain('header Access-Control-Allow-Origin *');
    expect(block).toContain('root * "/Users/dev/Sites/app"');
    expect(block).toContain('php_fastcgi 127.0.0.1:9000');
    expect(block).toContain('@cors_preflight');
    expect(block).toContain('Access-Control-Allow-Methods "GET, HEAD, POST, OPTIONS"');
    expect(block).toContain('# START: app.sp');
    expect(block).toContain('# END: app.sp');
  });

  it('renders allow-all-origins block', () => {
    const block = renderSiteBlock('open.sp', '/Users/dev/Sites/open', {
      allowAllOrigins: true,
    });
    expect(block).toContain('allowAllOrigins=true');
    expect(block).toContain('header Access-Control-Allow-Origin *');
    expect(block).toContain('@blocked path_regexp');
    expect(block).not.toContain('@cors_origin');
  });

  it('escapes quotes and backslashes in root paths', () => {
    const block = renderSiteBlock(
      'q.sp',
      '/Users/dev/Sites/My "Cool" App',
      {}
    );
    expect(block).toContain('root * "/Users/dev/Sites/My \\"Cool\\" App"');
  });
});

describe('parseBlocks / migrateLegacyContent', () => {
  it('parses legacy blocks and migrates with allowAllOrigins', () => {
    const foreign = '# hand-written global stuff\n';
    const content = `${foreign}\n${LEGACY_BLOCK}\n`;
    const parsed = parseBlocks(content);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].isLegacy).toBe(true);
    expect(parsed[0].root).toBe('/Users/dev/Sites/demo');

    const migrated = migrateLegacyContent(content);
    expect(migrated.changed).toBe(true);
    expect(migrated.migrated).toEqual([
      { domain: 'demo.sp', root: '/Users/dev/Sites/demo' },
    ]);
    expect(migrated.content).toContain('hand-written global stuff');
    expect(migrated.content).toContain(`# stagepass-block: ${BLOCK_VERSION}`);
    expect(migrated.content).toContain('allowAllOrigins=true');
    expect(migrated.content).toContain('@blocked path_regexp');

    const again = migrateLegacyContent(migrated.content);
    expect(again.changed).toBe(false);
    expect(again.content).toBe(migrated.content);
  });

  it('leaves unparsable legacy blocks alone', () => {
    const broken = `# START: broken.sp
broken.sp {
    # no root directive
    file_server
}
# END: broken.sp
`;
    const result = migrateLegacyContent(broken);
    expect(result.changed).toBe(false);
    expect(result.skipped).toHaveLength(1);
    expect(result.content).toContain('broken.sp');
  });

  it('extractRootFromBlock handles escaped quotes', () => {
    expect(
      extractRootFromBlock('root * "/tmp/My \\"App\\""')
    ).toBe('/tmp/My "App"');
  });
});

describe('upsertBlock / removeBlock', () => {
  it('upserts and removes while preserving foreign content', () => {
    let content = '# keep me\n';
    const block = renderSiteBlock('x.sp', '/Users/dev/Sites/x', {});
    content = upsertBlock(content, 'x.sp', block);
    expect(content).toContain('keep me');
    expect(content).toContain('x.sp');

    const updated = renderSiteBlock('x.sp', '/Users/dev/Sites/x2', {
      origins: ['a.example.com'],
    });
    content = upsertBlock(content, 'x.sp', updated);
    expect(content).toContain('/Users/dev/Sites/x2');
    expect(content).not.toContain('/Users/dev/Sites/x"');
    expect(content).toContain('keep me');

    const removed = removeBlock(content, 'x.sp');
    expect(removed.removed).toBe(true);
    expect(removed.content).toContain('keep me');
    expect(removed.content).not.toContain('# START: x.sp');
  });
});
