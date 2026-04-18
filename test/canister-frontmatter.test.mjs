import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCanisterFrontmatter, titleFromCanisterFrontmatter } from '../lib/canister-frontmatter.mjs';

describe('canister frontmatter parsing', () => {
  it('reads title from object frontmatter', () => {
    assert.equal(titleFromCanisterFrontmatter({ title: '  A  ', project: 'x' }), 'A');
  });

  it('reads title from normal JSON string', () => {
    const s = JSON.stringify({ title: 'Parity', source: 'hub' });
    assert.equal(titleFromCanisterFrontmatter(s), 'Parity');
  });

  it('reads title from escaped-inner-json string (Motoko-style)', () => {
    const s = '{\\"source\\":\\"hub\\",\\"title\\":\\"Provenance parity.\\"}';
    assert.equal(titleFromCanisterFrontmatter(s), 'Provenance parity.');
    const o = parseCanisterFrontmatter(s);
    assert.equal(o?.source, 'hub');
  });

  it('returns null when missing', () => {
    assert.equal(titleFromCanisterFrontmatter('{}'), null);
    assert.equal(titleFromCanisterFrontmatter(null), null);
  });
});
