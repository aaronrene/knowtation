import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(join(root, 'web', 'index.html'), 'utf8');

describe('landing family links (security)', () => {
  it('opens family outbound links in a new tab with noopener noreferrer', () => {
    const familyHrefs = [
      'https://parentier.org',
      'https://scool.ing',
      'https://the-brain.space',
      'https://github.com/aaronrene/overseer-kit',
    ];
    for (const href of familyHrefs) {
      const re = new RegExp(
        `href="${href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"([^>]*)>`,
        'g'
      );
      const matches = [...indexHtml.matchAll(re)];
      assert.ok(matches.length > 0, `missing ${href}`);
      for (const m of matches) {
        const attrs = m[1];
        assert.match(attrs, /target="_blank"/);
        assert.match(attrs, /rel="[^"]*noopener[^"]*noreferrer[^"]*"/);
      }
    }
  });

  it('does not introduce javascript: or data: family hrefs', () => {
    assert.equal(/href="javascript:/i.test(indexHtml), false);
    assert.equal(/href="data:/i.test(indexHtml), false);
  });
});
