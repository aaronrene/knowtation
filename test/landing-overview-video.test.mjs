import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = readFileSync(join(root, 'web', 'index.html'), 'utf8');

describe('landing overview YouTube embed', () => {
  it('places the overview section after the deploy headline and before spotlight cards', () => {
    const deploy = indexHtml.indexOf('decentralized Internet Computer canisters');
    const videoSec = indexHtml.indexOf('class="landing-overview-video wide"');
    const spotlight = indexHtml.indexOf('class="spotlight-pair wide"');
    assert.ok(deploy !== -1 && videoSec > deploy && spotlight > videoSec);
  });

  it('embeds the overview video without playlist on iframe (avoids embed errors); rel=0 for same-channel suggestions', () => {
    assert.ok(indexHtml.includes('youtube.com/embed/LPHBkyZmvVo'));
    const embedIdx = indexHtml.indexOf('youtube.com/embed/LPHBkyZmvVo');
    const iframeEnd = indexHtml.indexOf('></iframe>', embedIdx);
    const iframeSlice = indexHtml.slice(embedIdx, iframeEnd === -1 ? embedIdx + 400 : iframeEnd);
    assert.ok(!iframeSlice.includes('list=UUW-qQC8z_QcBz5QfDi2zapw'), 'playlist on iframe can make player show unavailable');
    assert.ok(indexHtml.includes('rel=0'));
    assert.ok(indexHtml.includes('modestbranding=1'));
  });

  it('links the channel strip to the overview watch URL with the same uploads list', () => {
    assert.match(
      indexHtml,
      /href="https:\/\/www\.youtube\.com\/watch\?v=LPHBkyZmvVo[^"]*list=UUW-qQC8z_QcBz5QfDi2zapw"/
    );
  });
});
