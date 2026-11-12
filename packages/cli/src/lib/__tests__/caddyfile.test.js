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
    expect(block).toContain(
      '# stagepass-options: allowAllOrigins=false php=true origins=example.com'
    );
    expect(block).toContain(`@blocked path_regexp blocked ${BLOCKED_PATH_REGEXP}`);
    expect(block).toContain('respond 404');
    expect(block).toContain('Access-Control-Allow-Private-Network true');
    expect(block).toContain('>Vary Origin');
    expect(block).toContain('>Access-Control-Allow-Origin "{http.request.header.Origin}"');
    expect(block).toContain('match status 2xx');
    expect(block).not.toContain(
      'header @cors_origin Access-Control-Allow-Origin "{http.request.header.Origin}"'
    );
    expect(block).not.toContain('webflow\\.io');
    expect(block).not.toContain('webflow\\.com');
    expect(block).toContain('example\\.com');
    expect(block).toContain('localhost');
    expect(block).not.toContain('header Access-Control-Allow-Origin *');
    expect(block).toContain('root * "/Users/dev/Sites/app"');
    expect(block).toContain('php_fastcgi 127.0.0.1:9000');
    expect(block).toContain('@cors_preflight');
    expect(block).toContain('Access-Control-Allow-Methods "GET, HEAD, POST, OPTIONS"');
    expect(block).toContain('# START: app.sp');
    expect(block).toContain('# END: app.sp');
  });

  it('omits php_fastcgi when php is false', () => {
    const block = renderSiteBlock('static.sp', '/Users/dev/Sites/static', {
      allowAllOrigins: false,
      origins: [],
      php: false,
    });
    expect(block).toContain('php=false');
    expect(block).not.toContain('php_fastcgi');
    expect(block).toContain('file_server');
  });

  it('keeps php_fastcgi when php is omitted (legacy default)', () => {
    const block = renderSiteBlock('legacy.sp', '/Users/dev/Sites/legacy', {
      allowAllOrigins: false,
      origins: [],
    });
    expect(block).toContain('php=true');
    expect(block).toContain('php_fastcgi 127.0.0.1:9000');
  });

  it('renders allow-all-origins block', () => {
    const block = renderSiteBlock('open.sp', '/Users/dev/Sites/open', {
      allowAllOrigins: true,
    });
    expect(block).toContain('allowAllOrigins=true');
    expect(block).toContain('php=true');
    expect(block).toContain('header Access-Control-Allow-Origin *');
    expect(block).toContain('>Access-Control-Allow-Origin *');
    expect(block).toContain('match status 2xx');
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

  it('omits live-reload proxy without a valid devPort', () => {
    const block = renderSiteBlock('app.sp', '/Users/dev/Sites/app', {
      allowAllOrigins: false,
      origins: [],
      php: false,
    });
    expect(block).not.toContain('/__stagepass/live');
    expect(block).not.toContain('reverse_proxy');
    expect(block).not.toContain('devPort=');
  });

  it('inserts reverse_proxy for a valid devPort before file_server', () => {
    const block = renderSiteBlock('app.sp', '/Users/dev/Sites/app', {
      allowAllOrigins: false,
      origins: ['example.com'],
      php: false,
      devPort: 34567,
    });
    expect(block).toContain('devPort=34567');
    expect(block).toContain('handle /__stagepass/live');
    expect(block).toContain('reverse_proxy 127.0.0.1:34567');
    expect(block).toContain('flush_interval -1');
    const liveIdx = block.indexOf('handle /__stagepass/live');
    const fileIdx = block.indexOf('file_server');
    expect(liveIdx).toBeGreaterThan(-1);
    expect(fileIdx).toBeGreaterThan(liveIdx);
    expect(block).toContain('>Access-Control-Allow-Origin "{http.request.header.Origin}"');
    expect(block).toContain('match status 2xx');
    expect(block).not.toContain('\n\n\n    handle {');
    const asV2 = block.replace('stagepass-block: v3', 'stagepass-block: v2');
    expect(migrateLegacyContent(asV2).content.trim()).toBe(block.trim());
  });

  it('rejects invalid devPort before writing Caddyfile text', () => {
    expect(() =>
      renderSiteBlock('app.sp', '/Users/dev/Sites/app', { devPort: 80 })
    ).toThrow(/devPort/);
    expect(() =>
      renderSiteBlock('app.sp', '/Users/dev/Sites/app', { devPort: 70000 })
    ).toThrow(/devPort/);
    expect(() =>
      renderSiteBlock('app.sp', '/Users/dev/Sites/app', { devPort: 3000.5 })
    ).toThrow(/devPort/);
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
    expect(migrated.upgraded).toEqual([]);
  });

  it('cli-php: rewrites a v2 block to the current marker and keeps options', () => {
    const old = `# START: app.sp
# stagepass-block: v2
# stagepass-options: allowAllOrigins=false php=false origins=example.com devPort=34567
app.sp {
    tls internal
    root * "/Users/dev/Sites/app"
    file_server
    header @cors_origin Access-Control-Allow-Origin "{http.request.header.Origin}"
    header @cors_origin Vary Origin
}
# END: app.sp
`;
    const migrated = migrateLegacyContent(`${old}\n`);
    expect(migrated.changed).toBe(true);
    expect(migrated.migrated).toEqual([]);
    expect(migrated.upgraded).toEqual([
      { domain: 'app.sp', root: '/Users/dev/Sites/app' },
    ]);
    expect(migrated.content).toContain(`# stagepass-block: ${BLOCK_VERSION}`);
    expect(migrated.content).toContain(
      'allowAllOrigins=false php=false origins=example.com devPort=34567'
    );
    expect(migrated.content).toContain('>Access-Control-Allow-Origin');
    expect(migrated.content).not.toContain('allowAllOrigins=true');
    expect(migrated.content).not.toContain('php_fastcgi');
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
  it('cli-php: hidden segments 404 .php, .env, and api/.env and still allow action.php', () => {
    const body = BLOCKED_PATH_REGEXP.replace(/^\(\?i\)/, '');
    const re = new RegExp(body, 'i');
    expect(re.test('/.php/config.php')).toBe(true);
    expect(re.test('/.env')).toBe(true);
    expect(re.test('/api/.env')).toBe(true);
    expect(re.test('/api/action.php')).toBe(false);
    const block = renderSiteBlock('app.sp', '/tmp/app', { php: true });
    expect(block).toContain('php_fastcgi 127.0.0.1:9000');
    expect(block).toContain(BLOCKED_PATH_REGEXP);
  });

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
