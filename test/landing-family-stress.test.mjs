import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = join(root, 'web', 'index.html');

describe('landing family copy (stress)', () => {
  it('keeps family invariants across repeated full-file reads', () => {
    for (let i = 0; i < 250; i += 1) {
      const html = readFileSync(indexPath, 'utf8');
      assert.equal(/agentception/i.test(html), false);
      assert.equal(/parentier/i.test(html), false);
      assert.ok(html.includes('https://ourware.org'));
      assert.ok(html.includes('https://x.com/ourware'));
      assert.ok(html.includes('scool.ing'));
      assert.ok(html.includes('Overseer Kit'));
      assert.ok(html.includes('class="hero-value-fold-triangle"'));
      const triStart = html.indexOf('class="hero-value-fold-triangle"');
      const triangle = html.slice(triStart, triStart + 280);
      assert.equal((triangle.match(/<span><\/span>/g) || []).length, 3);
    }
  });
});
