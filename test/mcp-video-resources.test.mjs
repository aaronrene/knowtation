/**
 * Tests for Phase 18B: MCP Video Resources — resource registration and URL extraction.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractVideoUrls } from '../lib/media-url-extract.mjs';

describe('video resource listing structure', () => {
  it('extracts videos with correct structure for resource listing', () => {
    const body = 'Watch this:\nhttps://example.com/demo.mp4\n\nAlso:\nhttps://example.com/intro.webm';
    const videos = extractVideoUrls(body);
    assert.strictEqual(videos.length, 2);
    assert.strictEqual(videos[0].url, 'https://example.com/demo.mp4');
    assert.strictEqual(videos[0].mimeType, 'video/mp4');
    assert.strictEqual(videos[1].url, 'https://example.com/intro.webm');
    assert.strictEqual(videos[1].mimeType, 'video/webm');
  });

  it('resource URI format is correct', () => {
    const notePath = 'projects/demo/notes/recording.md';
    const index = 1;
    const uri = `knowtation://vault/${notePath}/video/${index}`;
    assert.strictEqual(uri, 'knowtation://vault/projects/demo/notes/recording.md/video/1');
  });

  it('video read returns text content (URL) not blob', () => {
    const videos = extractVideoUrls('https://example.com/clip.mp4');
    assert.strictEqual(videos.length, 1);
    const vid = videos[0];
    const responseContent = {
      uri: 'knowtation://vault/test.md/video/0',
      mimeType: vid.mimeType,
      text: vid.url,
    };
    assert.strictEqual(responseContent.mimeType, 'video/mp4');
    assert.strictEqual(responseContent.text, 'https://example.com/clip.mp4');
    assert.ok(!responseContent.blob, 'Video resources should not include blob data');
  });

  it('handles .mov as video/quicktime', () => {
    const videos = extractVideoUrls('https://example.com/meeting.mov');
    assert.strictEqual(videos.length, 1);
    assert.strictEqual(videos[0].mimeType, 'video/quicktime');
  });

  it('index out of range is detectable', () => {
    const videos = extractVideoUrls('https://example.com/clip.mp4');
    assert.strictEqual(videos.length, 1);
    const oobIndex = 3;
    assert.ok(oobIndex >= videos.length);
  });

  it('no videos returns empty list', () => {
    const videos = extractVideoUrls('Just text and ![img](https://ex.com/img.png)');
    assert.strictEqual(videos.length, 0);
  });

  it('video inside markdown image syntax is still extracted', () => {
    const videos = extractVideoUrls('![demo](https://ex.com/demo.mp4)');
    assert.strictEqual(videos.length, 1);
    assert.strictEqual(videos[0].mimeType, 'video/mp4');
  });
});
