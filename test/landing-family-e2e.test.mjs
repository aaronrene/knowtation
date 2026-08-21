import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexPath = join(root, 'web', 'index.html');

function serveIndex() {
  const html = readFileSync(indexPath);
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

describe('landing family page (e2e)', () => {
  it('serves the landing HTML with family markers and no AgentCeption', async () => {
    const { server, url } = await serveIndex();
    try {
      const res = await fetch(url);
      assert.equal(res.status, 200);
      const body = await res.text();
      assert.match(body, /Structured memory for humans and agents/);
      assert.match(body, /class="hero-value-fold-triangle"/);
      assert.match(body, /class="hero-value-fold-chevron"/);
      assert.match(body, /Ourware/);
      assert.match(body, /https:\/\/ourware\.org/);
      assert.match(body, /scool\.ing/);
      assert.match(body, /theBRAIN/);
      assert.match(body, /class="family-presence-band"/);
      assert.match(body, /class="brain-grow-show"/);
      assert.match(body, /Many Ways to Grow/);
      assert.match(body, /src="\/assets\/thebrain-show\/privacy-local-desk\.webp"/);
      assert.match(body, /Overseer Kit/);
      assert.match(body, /class="footer-ourware-social"/);
      assert.equal(/agentception/i.test(body), false);
      assert.equal(/parentier/i.test(body), false);
    } finally {
      server.close();
    }
  });
});
