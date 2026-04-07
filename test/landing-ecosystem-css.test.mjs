import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(join(root, 'web', 'index.html'), 'utf8');

describe('landing page ecosystem vision section CSS', () => {
  it('uses text-shadow on the Ecosystem visions title (tight glyph glow)', () => {
    assert.match(
      indexHtml,
      /\.ecosystem-vision-heading-wrap \.flow-intro-title\s*\{[^}]*text-shadow/s
    );
  });

  it('does not use a wide ::before blob on the heading wrap', () => {
    assert.ok(!indexHtml.includes('.ecosystem-vision-heading-wrap::before'));
  });

  it('applies a section-level radial gradient behind content', () => {
    assert.match(indexHtml, /\.ecosystem-vision-section::before/s);
    assert.match(indexHtml, /\.ecosystem-vision-section::before\s*\{[^}]*radial-gradient/s);
  });

  it('does not add a boxed glow pseudo behind Future Facing Architecture', () => {
    assert.ok(!indexHtml.includes('.ecosystem-architecture-title::before'));
  });
});
