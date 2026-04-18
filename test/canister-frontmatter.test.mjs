import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayTitleFromHostedNote,
  parseCanisterFrontmatter,
  titleFromCanisterFrontmatter,
  titleFromMarkdownBody,
  titleFromPathStem,
} from '../lib/canister-frontmatter.mjs';

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

  it('titleFromMarkdownBody reads first ATX heading', () => {
    assert.equal(titleFromMarkdownBody('# Hello world\n\nMore'), 'Hello world');
    assert.equal(titleFromMarkdownBody('  ## Not used\n# Real'), 'Real');
  });

  it('titleFromPathStem uses filename', () => {
    assert.equal(titleFromPathStem('inbox/FINAL-PRE-LAUNCH.md'), 'FINAL PRE LAUNCH');
  });

  it('displayTitleFromHostedNote prefers frontmatter then body then path', () => {
    assert.equal(
      displayTitleFromHostedNote({
        path: 'x/y.md',
        frontmatter: '{}',
        body: '# From body\n',
      }),
      'From body'
    );
    assert.equal(
      displayTitleFromHostedNote({
        path: 'projects/foo/PARITY-PLAN.md',
        frontmatter: '{}',
        body: 'no heading',
      }),
      'PARITY PLAN'
    );
  });
});
