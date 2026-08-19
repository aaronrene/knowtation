import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = join(root, 'web', 'index.html');

describe('landing family scan (performance)', () => {
  it('reads and scans family markers in under 50ms', () => {
    const t0 = performance.now();
    const html = readFileSync(indexPath, 'utf8');
    const ok =
      html.includes('Parentier') &&
      html.includes('scool.ing') &&
      html.includes('Overseer Kit') &&
      !/agentception/i.test(html);
    const elapsed = performance.now() - t0;
    assert.equal(ok, true);
    assert.ok(elapsed < 50, `scan took ${elapsed}ms`);
  });
});
