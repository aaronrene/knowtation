import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(join(root, 'web', 'index.html'), 'utf8');

const hubPath = 'href="/hub/"';
const selfHostAnchor =
  'href="https://github.com/aaronrene/knowtation/blob/main/docs/TWO-PATHS-HOSTED-AND-SELF-HOSTED.md#quick-start-self-hosted"';

describe('landing Band B (Phase 2 easy start)', () => {
  it('places Band B after the GitHub badge and before deploy headlines', () => {
    const badge = indexHtml.indexOf('class="badge-wrap"');
    const bandB = indexHtml.indexOf('class="band-b-path wide"');
    const deploy = indexHtml.indexOf('class="deploy-headlines wide"');
    assert.ok(badge !== -1 && bandB !== -1 && deploy !== -1);
    assert.ok(badge < bandB && bandB < deploy);
  });

  it('includes hero-equivalent Hub and self-host quick start links inside Band B', () => {
    const bandB = indexHtml.indexOf('class="band-b-path wide"');
    const deploy = indexHtml.indexOf('class="deploy-headlines wide"');
    const slice = indexHtml.slice(bandB, deploy);
    const hubInBand = slice.indexOf(hubPath);
    const selfHostInBand = slice.indexOf(selfHostAnchor);
    assert.ok(hubInBand !== -1, 'Hosted Hub link missing in Band B');
    assert.ok(selfHostInBand !== -1, 'Self-host quick start link missing in Band B');
  });

  it('exposes a semantic heading and three step titles', () => {
    assert.match(indexHtml, /id="band-b-heading"/);
    assert.match(indexHtml, />1<\/span>Note \/ import</);
    assert.match(indexHtml, />2<\/span>MCP</);
    assert.match(indexHtml, />3<\/span>Self-host \/ power</);
  });

  it('meta description mentions proposals and human approval', () => {
    assert.match(
      indexHtml,
      /<meta name="description" content="[^"]*proposals need human approval[^"]*">/
    );
  });
});
