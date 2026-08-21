import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(join(root, 'web', 'index.html'), 'utf8');

describe('landing family copy (unit)', () => {
  it('does not mention AgentCeption on the public landing page', () => {
    assert.equal(/agentception/i.test(indexHtml), false);
  });

  it('names Ourware, scool.ing, theBRAIN, and Overseer Kit', () => {
    assert.match(indexHtml, /Ourware/);
    assert.match(indexHtml, /scool\.ing/);
    assert.match(indexHtml, /theBRAIN/);
    assert.match(indexHtml, /Overseer Kit/);
  });

  it('does not retain Parentier branding on the public landing page', () => {
    assert.equal(/parentier/i.test(indexHtml), false);
  });

  it('avoids Parent Here, parent company, schooling, and school.ing labels', () => {
    assert.equal(/parent here/i.test(indexHtml), false);
    assert.equal(/parent company/i.test(indexHtml), false);
    assert.equal(/\bschooling\b/i.test(indexHtml), false);
    assert.equal(/school\.ing/i.test(indexHtml), false);
  });
});
