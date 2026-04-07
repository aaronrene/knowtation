import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(join(root, 'web', 'index.html'), 'utf8');
const hubHtml = readFileSync(join(root, 'web', 'hub', 'index.html'), 'utf8');

describe('landing footer and favicon', () => {
  it('links Discord community invite above tagline', () => {
    const discordIdx = indexHtml.indexOf('https://discord.gg/NrtzhZtrED');
    const taglineIdx = indexHtml.indexOf('Your notes, your data, your context.');
    assert.ok(discordIdx !== -1 && taglineIdx !== -1 && discordIdx < taglineIdx);
    assert.match(indexHtml, /<strong>Join the community<\/strong>/);
    assert.match(indexHtml, /class="footer-discord-link"/);
  });

  it('uses PNG favicon on landing and hub', () => {
    assert.ok(indexHtml.includes('href="/assets/favicon.png"'));
    assert.ok(hubHtml.includes('href="/assets/favicon.png"'));
    assert.ok(existsSync(join(root, 'web', 'assets', 'favicon.png')));
  });

  it('includes YouTube and X footer icons before tagline', () => {
    const yt = indexHtml.indexOf('https://www.youtube.com/@Knowtation');
    const x = indexHtml.indexOf('https://x.com/Knowtation1111');
    const taglineIdx = indexHtml.indexOf('Your notes, your data, your context.');
    assert.ok(yt !== -1 && yt < taglineIdx);
    assert.ok(x !== -1 && x < taglineIdx);
    assert.match(indexHtml, /class="footer-social-icons"/);
  });

  it('places Discord, YouTube, and X beside the theme toggle in the header', () => {
    assert.match(indexHtml, /class="landing-header-start"/);
    assert.match(indexHtml, /class="landing-header-social"/);
    const start = indexHtml.indexOf('class="landing-header-start"');
    const themeBtn = indexHtml.indexOf('id="theme-toggle"');
    const social = indexHtml.indexOf('class="landing-header-social"');
    assert.ok(start !== -1 && themeBtn > start && social > themeBtn);
    assert.ok(indexHtml.includes('aria-label="Knowtation on YouTube"', indexHtml.indexOf('landing-header-social')));
  });
});
