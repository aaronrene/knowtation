/**
 * Tests for lib/media-url-extract.mjs — image and video URL extraction from markdown.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractImageUrls, extractVideoUrls, MAX_URLS_PER_NOTE } from '../lib/media-url-extract.mjs';

describe('extractImageUrls', () => {
  it('extracts a basic markdown image', () => {
    const body = 'Some text\n![my alt](https://example.com/img.png)\nmore text';
    const result = extractImageUrls(body);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].alt, 'my alt');
    assert.strictEqual(result[0].url, 'https://example.com/img.png');
    assert.strictEqual(result[0].mimeType, 'image/png');
  });

  it('extracts multiple images', () => {
    const body = [
      '![a](https://ex.com/a.png)',
      '![b](https://ex.com/b.jpg)',
      '![c](https://ex.com/c.gif)',
    ].join('\n');
    const result = extractImageUrls(body);
    assert.strictEqual(result.length, 3);
    assert.strictEqual(result[0].mimeType, 'image/png');
    assert.strictEqual(result[1].mimeType, 'image/jpeg');
    assert.strictEqual(result[2].mimeType, 'image/gif');
  });

  it('deduplicates same URL referenced twice', () => {
    const body = '![a](https://ex.com/img.png)\n![b](https://ex.com/img.png)';
    const result = extractImageUrls(body);
    assert.strictEqual(result.length, 1);
  });

  it('preserves query strings but detects extension correctly', () => {
    const body = '![](https://ex.com/img.png?token=abc&size=large)';
    const result = extractImageUrls(body);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].mimeType, 'image/png');
    assert.ok(result[0].url.includes('?token=abc'));
  });

  it('handles .jpg and .jpeg as image/jpeg', () => {
    const body = '![](https://ex.com/a.jpg)\n![](https://ex.com/b.jpeg)';
    const result = extractImageUrls(body);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].mimeType, 'image/jpeg');
    assert.strictEqual(result[1].mimeType, 'image/jpeg');
  });

  it('handles .webp as image/webp', () => {
    const body = '![](https://ex.com/photo.webp)';
    const result = extractImageUrls(body);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].mimeType, 'image/webp');
  });

  it('returns empty array when no images', () => {
    const body = 'Just plain text\nwith no images at all.';
    const result = extractImageUrls(body);
    assert.strictEqual(result.length, 0);
  });

  it('extracts bare image URL on its own line', () => {
    const body = 'Text before\nhttps://example.com/photo.jpg\nText after';
    const result = extractImageUrls(body);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].url, 'https://example.com/photo.jpg');
    assert.strictEqual(result[0].alt, '');
  });

  it('caps at MAX_URLS_PER_NOTE', () => {
    const lines = [];
    for (let i = 0; i < 60; i++) {
      lines.push(`![img${i}](https://ex.com/img${i}.png)`);
    }
    const result = extractImageUrls(lines.join('\n'));
    assert.strictEqual(result.length, MAX_URLS_PER_NOTE);
  });

  it('ignores data: URIs', () => {
    const body = '![](data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==)';
    const result = extractImageUrls(body);
    assert.strictEqual(result.length, 0);
  });

  it('does not extract video extensions as images', () => {
    const body = '![](https://ex.com/clip.mp4)';
    const result = extractImageUrls(body);
    assert.strictEqual(result.length, 0);
  });

  it('returns empty for null/undefined input', () => {
    assert.deepStrictEqual(extractImageUrls(null), []);
    assert.deepStrictEqual(extractImageUrls(undefined), []);
    assert.deepStrictEqual(extractImageUrls(''), []);
  });

  it('handles URLs with fragment identifiers', () => {
    const body = '![](https://ex.com/img.png#section)';
    const result = extractImageUrls(body);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].mimeType, 'image/png');
  });

  it('does not extract non-image bare URLs', () => {
    const body = 'https://example.com/page.html\nhttps://example.com/file.pdf';
    const result = extractImageUrls(body);
    assert.strictEqual(result.length, 0);
  });
});

describe('extractVideoUrls', () => {
  it('extracts .mp4 URL', () => {
    const body = 'Check this out\nhttps://ex.com/clip.mp4\nnice';
    const result = extractVideoUrls(body);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].url, 'https://ex.com/clip.mp4');
    assert.strictEqual(result[0].mimeType, 'video/mp4');
  });

  it('extracts .webm URL', () => {
    const body = 'https://ex.com/clip.webm';
    const result = extractVideoUrls(body);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].mimeType, 'video/webm');
  });

  it('extracts .mov URL', () => {
    const body = 'https://ex.com/clip.mov';
    const result = extractVideoUrls(body);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].mimeType, 'video/quicktime');
  });

  it('returns empty when no video URLs', () => {
    const body = 'Just text and ![](https://ex.com/img.png)';
    const result = extractVideoUrls(body);
    assert.strictEqual(result.length, 0);
  });

  it('extracts video URL inside image markdown syntax', () => {
    const body = '![demo](https://ex.com/clip.mp4)';
    const result = extractVideoUrls(body);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].url, 'https://ex.com/clip.mp4');
  });

  it('deduplicates video URLs', () => {
    const body = 'https://ex.com/clip.mp4\nhttps://ex.com/clip.mp4';
    const result = extractVideoUrls(body);
    assert.strictEqual(result.length, 1);
  });

  it('returns empty for null/undefined', () => {
    assert.deepStrictEqual(extractVideoUrls(null), []);
    assert.deepStrictEqual(extractVideoUrls(undefined), []);
    assert.deepStrictEqual(extractVideoUrls(''), []);
  });

  it('handles video URL with query string', () => {
    const body = 'https://ex.com/clip.mp4?token=xyz';
    const result = extractVideoUrls(body);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].mimeType, 'video/mp4');
    assert.ok(result[0].url.includes('?token=xyz'));
  });
});

describe('mixed content', () => {
  it('separates images and videos correctly', () => {
    const body = [
      '![photo](https://ex.com/photo.jpg)',
      'https://ex.com/demo.mp4',
      '![diagram](https://ex.com/diagram.png)',
      'https://ex.com/screen.webm',
    ].join('\n');
    const images = extractImageUrls(body);
    const videos = extractVideoUrls(body);
    assert.strictEqual(images.length, 2);
    assert.strictEqual(videos.length, 2);
    assert.strictEqual(images[0].mimeType, 'image/jpeg');
    assert.strictEqual(images[1].mimeType, 'image/png');
    assert.strictEqual(videos[0].mimeType, 'video/mp4');
    assert.strictEqual(videos[1].mimeType, 'video/webm');
  });
});
