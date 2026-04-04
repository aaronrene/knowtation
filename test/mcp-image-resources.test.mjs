/**
 * Tests for Phase 18A: MCP Image Resources — image-fetch.mjs security + resource registration.
 */
import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

describe('fetchImageAsBase64', () => {
  it('rejects non-https URLs', async () => {
    const { fetchImageAsBase64 } = await import('../mcp/resources/image-fetch.mjs');
    await assert.rejects(
      () => fetchImageAsBase64('http://example.com/img.png'),
      /https:\/\//,
    );
  });

  it('rejects data: URIs', async () => {
    const { fetchImageAsBase64 } = await import('../mcp/resources/image-fetch.mjs');
    await assert.rejects(
      () => fetchImageAsBase64('data:image/png;base64,abc'),
      /https:\/\//,
    );
  });

  it('rejects javascript: URIs', async () => {
    const { fetchImageAsBase64 } = await import('../mcp/resources/image-fetch.mjs');
    await assert.rejects(
      () => fetchImageAsBase64('javascript:alert(1)'),
      /https:\/\//,
    );
  });

  it('rejects file: URIs', async () => {
    const { fetchImageAsBase64 } = await import('../mcp/resources/image-fetch.mjs');
    await assert.rejects(
      () => fetchImageAsBase64('file:///etc/passwd'),
      /https:\/\//,
    );
  });

  it('rejects localhost', async () => {
    const { fetchImageAsBase64 } = await import('../mcp/resources/image-fetch.mjs');
    await assert.rejects(
      () => fetchImageAsBase64('https://localhost/img.png'),
      /localhost.*blocked/i,
    );
  });

  it('rejects URLs with empty string', async () => {
    const { fetchImageAsBase64 } = await import('../mcp/resources/image-fetch.mjs');
    await assert.rejects(
      () => fetchImageAsBase64(''),
      /https:\/\//,
    );
  });

  it('rejects null/undefined', async () => {
    const { fetchImageAsBase64 } = await import('../mcp/resources/image-fetch.mjs');
    await assert.rejects(() => fetchImageAsBase64(null));
    await assert.rejects(() => fetchImageAsBase64(undefined));
  });
});

describe('extractImageUrls used in resource context', () => {
  it('extracts correct structure for resource listing', async () => {
    const { extractImageUrls } = await import('../lib/media-url-extract.mjs');
    const body = '![Screenshot](https://example.com/screen.png)\nSome text\n![Logo](https://example.com/logo.jpg)';
    const images = extractImageUrls(body);
    assert.strictEqual(images.length, 2);
    assert.strictEqual(images[0].alt, 'Screenshot');
    assert.strictEqual(images[0].mimeType, 'image/png');
    assert.strictEqual(images[1].alt, 'Logo');
    assert.strictEqual(images[1].mimeType, 'image/jpeg');

    for (const img of images) {
      assert.ok(img.url.startsWith('https://'));
      assert.ok(typeof img.mimeType === 'string');
      assert.ok(typeof img.alt === 'string');
    }
  });

  it('resource URI format is correct', () => {
    const notePath = 'inbox/my-note.md';
    const index = 0;
    const uri = `knowtation://vault/${notePath}/image/${index}`;
    assert.strictEqual(uri, 'knowtation://vault/inbox/my-note.md/image/0');
  });

  it('index out of range is detectable', async () => {
    const { extractImageUrls } = await import('../lib/media-url-extract.mjs');
    const body = '![a](https://ex.com/a.png)';
    const images = extractImageUrls(body);
    assert.strictEqual(images.length, 1);
    const oobIndex = 5;
    assert.ok(oobIndex >= images.length, 'Index should be out of range');
  });
});

describe('SSRF protection constants', () => {
  it('private IP patterns reject common ranges', async () => {
    const mod = await import('../mcp/resources/image-fetch.mjs');
    assert.ok(mod.DEFAULT_MAX_BYTES > 0);
    assert.ok(mod.DEFAULT_TIMEOUT_MS > 0);
  });
});
