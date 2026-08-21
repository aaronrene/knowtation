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
  it('uses the canonical Ourware, scool.ing, and Overseer Kit hrefs', () => {
    const ourware = hrefsMatching(/ourware\.org/);
    assert.deepEqual([...new Set(ourware)], ['https://ourware.org']);
    const scooling = hrefsMatching(/scool/);
    assert.deepEqual([...new Set(scooling)], ['https://scool.ing']);
    const kit = hrefsMatching(/overseer-kit/);
    assert.deepEqual([...new Set(kit)], ['https://github.com/aaronrene/overseer-kit']);
  });

  it('uses the canonical Ourware social profile URLs', () => {
    assert.deepEqual(
      [...new Set(hrefsMatching(/facebook\.com/))],
      ['https://www.facebook.com/profile.php?id=61593821631787']
    );
    assert.deepEqual(
      [...new Set(hrefsMatching(/linkedin\.com/))],
      ['https://www.linkedin.com/company/143378951']
    );
    assert.ok(
      hrefsMatching(/youtube\.com\/channel\/UC85lDAayTYjkqPFOyDaORWA/).includes(
        'https://www.youtube.com/channel/UC85lDAayTYjkqPFOyDaORWA'
      )
    );
    assert.ok(hrefsMatching(/^https:\/\/x\.com\/ourware$/).includes('https://x.com/ourware'));
  });

  it('does not point at Parentier, AgentCeption, school.ing, or http family hosts', () => {
    assert.equal(hrefsMatching(/parentier/i).length, 0);
    assert.equal(hrefsMatching(/agentception/i).length, 0);
    assert.equal(hrefsMatching(/school\.ing/i).length, 0);
    assert.equal(hrefsMatching(/^http:\/\/(ourware\.org|scool\.ing)/).length, 0);
  });
});
