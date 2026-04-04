/**
 * Tests for hub/gateway/parse-multipart.mjs — minimal multipart/form-data file parser.
 * Used by the gateway to extract image uploads without forwarding binary bodies to another Lambda.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseMultipartFile } from '../hub/gateway/parse-multipart.mjs';

/**
 * Build a minimal multipart/form-data body containing one file field.
 */
function buildMultipart(boundary, filename, contentType, data) {
  const parts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="image"; filename="${filename}"\r\n`,
    `Content-Type: ${contentType}\r\n`,
    `\r\n`,
  ];
  const header = Buffer.from(parts.join(''), 'binary');
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'binary');
  return Buffer.concat([header, data, footer]);
}

describe('parseMultipartFile', () => {
  it('extracts file buffer from a well-formed multipart body', () => {
    const boundary = 'TestBoundary1234';
    const payload = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x01, 0x02]);
    const body = buildMultipart(boundary, 'photo.jpg', 'image/jpeg', payload);
    const result = parseMultipartFile(body, boundary);
    assert.ok(result, 'should return a result');
    assert.strictEqual(result.filename, 'photo.jpg');
    assert.strictEqual(result.contentType, 'image/jpeg');
    assert.deepStrictEqual(result.data, payload);
  });

  it('returns null for a body with no file parts', () => {
    const boundary = 'NoBoundary';
    // A text field (no filename) — should be ignored
    const body = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="text"\r\n\r\nhello\r\n--${boundary}--\r\n`,
      'binary',
    );
    const result = parseMultipartFile(body, boundary);
    assert.strictEqual(result, null);
  });

  it('returns null for empty body', () => {
    assert.strictEqual(parseMultipartFile(Buffer.alloc(0), 'boundary'), null);
  });

  it('handles PNG payload correctly', () => {
    const boundary = 'PngBoundary';
    const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const body = buildMultipart(boundary, 'image.png', 'image/png', pngHeader);
    const result = parseMultipartFile(body, boundary);
    assert.ok(result);
    assert.strictEqual(result.filename, 'image.png');
    assert.deepStrictEqual(result.data, pngHeader);
  });

  it('handles filename with spaces and special chars', () => {
    const boundary = 'SpaceBoundary';
    const data = Buffer.from([0xFF, 0xD8, 0xFF]);
    const body = buildMultipart(boundary, 'my photo (1).jpg', 'image/jpeg', data);
    const result = parseMultipartFile(body, boundary);
    assert.ok(result);
    assert.strictEqual(result.filename, 'my photo (1).jpg');
  });

  it('defaults content-type to application/octet-stream when missing', () => {
    const boundary = 'NoCtBoundary';
    const data = Buffer.from([0xFF, 0xD8, 0xFF]);
    const parts = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="image"; filename="photo.jpg"\r\n`,
      `\r\n`,
    ];
    const header = Buffer.from(parts.join(''), 'binary');
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'binary');
    const body = Buffer.concat([header, data, footer]);
    const result = parseMultipartFile(body, boundary);
    assert.ok(result);
    assert.strictEqual(result.contentType, 'application/octet-stream');
  });
});
