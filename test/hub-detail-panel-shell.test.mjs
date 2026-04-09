/**
 * Ensures the Hub detail drawer shell includes bottom close and footer hint (UX contract).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, '..', 'web', 'hub', 'index.html');

describe('hub detail panel shell', () => {
  it('index.html includes bottom close, footer hint, and detail panel', () => {
    const html = fs.readFileSync(indexPath, 'utf8');
    assert.match(html, /data-hub-detail-close/);
    assert.match(html, /detail-footer-hint/);
    assert.match(html, /class="[^"]*detail-footer/);
    assert.ok(html.includes('id="detail-panel"') && html.includes('id="detail-body"'));
  });
});
