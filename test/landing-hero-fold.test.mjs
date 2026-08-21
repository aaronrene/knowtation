import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(join(root, 'web', 'index.html'), 'utf8');

const foldCss = indexHtml.slice(
  indexHtml.indexOf('/* Hero fold:'),
  indexHtml.indexOf('footer {')
);

describe('structured-memory hero fold', () => {
  it('does not draw a bordered elevated box around the fold', () => {
    assert.match(foldCss, /\.hero-value-fold\s*\{[^}]*border:\s*none/s);
    assert.match(foldCss, /\.hero-value-fold\s*\{[^}]*background:\s*transparent/s);
    assert.doesNotMatch(foldCss, /\.hero-value-fold\s*\{[^}]*border:\s*1px solid/s);
  });

  it('places a larger bright-blue chevron beside the heading', () => {
    assert.match(indexHtml, /class="hero-value-fold-chevron"/);
    assert.match(indexHtml, /\.hero-value-fold-chevron\s*\{[^}]*font-size:\s*2\.35rem/s);
    assert.match(indexHtml, /\.hero-value-fold-chevron\s*\{[^}]*color:\s*#4da3ff/s);
  });

  it('paints Ourware ecosystem links in bright cyan, including visited', () => {
    assert.match(
      indexHtml,
      /\.ecosystem-vision-lead a:visited[\s\S]*?color:\s*#7dd3fc/
    );
  });

  it('draws three progressively shorter lines under the heading', () => {
    assert.match(indexHtml, /class="hero-value-fold-triangle"/);
    assert.match(indexHtml, /\.hero-value-fold-triangle span:nth-child\(1\) \{ width: 8\.25rem; \}/);
    assert.match(indexHtml, /\.hero-value-fold-triangle span:nth-child\(2\) \{ width: 5\.15rem; \}/);
    assert.match(indexHtml, /\.hero-value-fold-triangle span:nth-child\(3\) \{ width: 2\.35rem; \}/);
  });
});
