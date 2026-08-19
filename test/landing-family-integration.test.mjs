import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(join(root, 'web', 'index.html'), 'utf8');

const ecosystemStart = indexHtml.indexOf('id="ecosystem-vision-heading"');
const ecosystemEnd = indexHtml.indexOf('id="structured-memory-main"');
const ecosystem = indexHtml.slice(ecosystemStart, ecosystemEnd);
const footer = indexHtml.slice(indexHtml.lastIndexOf('<footer>'));

describe('landing family placement (integration)', () => {
  it('opens ecosystem vision with Parentier and the Knowtation brain role', () => {
    assert.ok(ecosystemStart !== -1 && ecosystemEnd > ecosystemStart);
    assert.match(ecosystem, /ecosystem-vision-lead/);
    const leadStart = ecosystem.indexOf('class="ecosystem-vision-lead"');
    const lead = ecosystem.slice(leadStart, ecosystem.indexOf('</p>', leadStart));
    assert.match(lead, /Parentier/);
    assert.match(lead, /https:\/\/parentier\.org/);
    assert.match(lead, /brain/i);
    assert.ok(lead.indexOf('Parentier') < lead.toLowerCase().indexOf('brain'));
  });

  it('puts scool.ing in the architecture flow and Overseer Kit in technical details', () => {
    assert.match(ecosystem, /ecosystem-flow-node">scool\.ing/);
    assert.doesNotMatch(ecosystem, /ecosystem-flow-node">AgentCeption/);
    const details = ecosystem.slice(ecosystem.indexOf('Technical details and links'));
    assert.match(details, /<strong>Overseer Kit<\/strong>/);
    assert.match(details, /https:\/\/github\.com\/aaronrene\/overseer-kit/);
    assert.match(details, /<strong>scool\.ing<\/strong>/);
    assert.match(details, /https:\/\/scool\.ing/);
  });

  it('does not put the family presence band under the Ecosystem visions title', () => {
    const heading = ecosystem.indexOf('Ecosystem visions');
    const lead = ecosystem.indexOf('class="ecosystem-vision-lead"');
    const between = ecosystem.slice(heading, lead);
    assert.ok(heading !== -1 && lead > heading);
    assert.doesNotMatch(between, /family-presence-band/);
  });

  it('places a black family presence section after Ecosystem visions with theBRAIN image', () => {
    const ecoClose = indexHtml.indexOf('</section>', indexHtml.indexOf('id="ecosystem-vision-heading"'));
    const band = indexHtml.indexOf('class="family-presence-band"');
    const memory = indexHtml.indexOf('id="structured-memory-main"');
    assert.ok(ecoClose !== -1 && band > ecoClose && memory > band);
    const bandHtml = indexHtml.slice(band, memory);
    assert.match(bandHtml, /class="brain-grow-show"/);
    assert.match(bandHtml, /Many Ways to Grow/);
    assert.equal((bandHtml.match(/class="brain-grow-show__slide[^"]*"/g) || []).length, 10);
    assert.equal((bandHtml.match(/class="brain-grow-show__dot"/g) || []).length, 10);
    assert.match(bandHtml, /Private at the desk/);
    assert.match(bandHtml, /src="\/assets\/thebrain-show\/privacy-local-desk\.webp"/);
    assert.match(bandHtml, /scool\.ing/);
    assert.match(bandHtml, /control panel/);
    assert.match(bandHtml, /theBRAIN/);
    assert.match(bandHtml, /spaces and presence/);
    assert.match(bandHtml, /Parentier/);
    assert.doesNotMatch(bandHtml, /\bschooling\b/i);
    const showDir = join(root, 'web', 'assets', 'thebrain-show');
    const expected = [
      'models-lineup-sensors.webp',
      'tech-exploded-dual-cam.webp',
      'privacy-local-desk.webp',
      'models-movable-vision-coverage.webp',
      'tech-sensor-addons.webp',
      'privacy-team-posture.webp',
      'tech-exploded-internals.webp',
      'usecase-adult-second-brain.webp',
      'models-brain-pro-max-omni.webp',
      'privacy-shared-room.webp',
    ];
    for (const name of expected) {
      assert.ok(existsSync(join(showDir, name)), name);
    }
    assert.match(bandHtml, /scool\.ing/);
    assert.match(bandHtml, /control panel/);
    assert.match(bandHtml, /theBRAIN/);
    assert.match(bandHtml, /spaces and presence/);
    assert.match(bandHtml, /Parentier/);
    assert.doesNotMatch(bandHtml, /\bschooling\b/i);
    assert.ok(existsSync(join(root, 'web', 'assets', 'thebrain.webp')));
  });

  it('closes the page with a white Parentier family line, rings mark, after footer links', () => {
    const familyIdx = footer.indexOf('class="footer-family"');
    const linksIdx = footer.indexOf('class="footer-links"');
    assert.ok(familyIdx !== -1 && linksIdx !== -1 && familyIdx > linksIdx);
    assert.match(footer, /class="footer-family-link"/);
    assert.match(footer, /class="parentier-mark"/);
    assert.match(footer, /Parentier/);
    assert.match(indexHtml, /footer \.footer-family-link[\s\S]*?color:\s*#ffffff/);
  });
});
