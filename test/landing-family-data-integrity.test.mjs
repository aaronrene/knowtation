import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(join(root, 'web', 'index.html'), 'utf8');

function hrefsMatching(re) {
  const out = [];
  const reGlobal = new RegExp(`href="([^"]+)"`, 'g');
  let m;
  while ((m = reGlobal.exec(indexHtml))) {
    if (re.test(m[1])) out.push(m[1]);
  }
  return out;
}

describe('landing family URLs (data-integrity)', () => {
  it('uses the canonical Parentier, scool.ing, and Overseer Kit hrefs', () => {
    const parentier = hrefsMatching(/parentier/);
    assert.deepEqual([...new Set(parentier)], ['https://parentier.org']);
    const scooling = hrefsMatching(/scool/);
    assert.deepEqual([...new Set(scooling)], ['https://scool.ing']);
    const kit = hrefsMatching(/overseer-kit/);
    assert.deepEqual([...new Set(kit)], ['https://github.com/aaronrene/overseer-kit']);
  });

  it('does not point at AgentCeption, school.ing, or http family hosts', () => {
    assert.equal(hrefsMatching(/agentception/i).length, 0);
    assert.equal(hrefsMatching(/school\.ing/i).length, 0);
    assert.equal(hrefsMatching(/^http:\/\/(parentier\.org|scool\.ing)/).length, 0);
  });
});
