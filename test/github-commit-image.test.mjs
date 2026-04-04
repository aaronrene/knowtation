/**
 * Tests for lib/github-commit-image.mjs — repo URL parsing, file validation, magic bytes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseGitHubRepoUrl,
  validateImageExtension,
  validateMagicBytes,
  ALLOWED_EXTENSIONS,
} from '../lib/github-commit-image.mjs';

describe('parseGitHubRepoUrl', () => {
  it('parses https URL with .git suffix', () => {
    const result = parseGitHubRepoUrl('https://github.com/user/repo.git');
    assert.deepStrictEqual(result, { owner: 'user', repo: 'repo' });
  });

  it('parses https URL without .git suffix', () => {
    const result = parseGitHubRepoUrl('https://github.com/user/repo');
    assert.deepStrictEqual(result, { owner: 'user', repo: 'repo' });
  });

  it('parses URL with trailing slash', () => {
    const result = parseGitHubRepoUrl('https://github.com/user/repo/');
    assert.deepStrictEqual(result, { owner: 'user', repo: 'repo' });
  });

  it('handles mixed case', () => {
    const result = parseGitHubRepoUrl('https://GitHub.com/Owner/Repo.git');
    assert.strictEqual(result.owner, 'Owner');
    assert.strictEqual(result.repo, 'Repo');
  });

  it('throws for non-GitHub URL', () => {
    assert.throws(
      () => parseGitHubRepoUrl('https://gitlab.com/user/repo'),
      /Cannot parse/,
    );
  });

  it('throws for empty string', () => {
    assert.throws(() => parseGitHubRepoUrl(''), /required/);
  });

  it('throws for null', () => {
    assert.throws(() => parseGitHubRepoUrl(null), /required/);
  });

  it('parses SSH-style URL', () => {
    const result = parseGitHubRepoUrl('git@github.com:user/repo.git');
    assert.deepStrictEqual(result, { owner: 'user', repo: 'repo' });
  });

  it('parses short owner/repo slug (format stored by the bridge)', () => {
    const result = parseGitHubRepoUrl('aaronrene/knowtation-vault-hosted');
    assert.deepStrictEqual(result, { owner: 'aaronrene', repo: 'knowtation-vault-hosted' });
  });

  it('parses short owner/repo.git slug', () => {
    const result = parseGitHubRepoUrl('user/my-vault.git');
    assert.deepStrictEqual(result, { owner: 'user', repo: 'my-vault' });
  });
});

describe('validateImageExtension', () => {
  it('accepts .jpg', () => {
    assert.strictEqual(validateImageExtension('photo.jpg'), 'jpg');
  });

  it('accepts .jpeg', () => {
    assert.strictEqual(validateImageExtension('photo.jpeg'), 'jpeg');
  });

  it('accepts .png', () => {
    assert.strictEqual(validateImageExtension('img.png'), 'png');
  });

  it('accepts .gif', () => {
    assert.strictEqual(validateImageExtension('anim.gif'), 'gif');
  });

  it('accepts .webp', () => {
    assert.strictEqual(validateImageExtension('photo.webp'), 'webp');
  });

  it('rejects .exe', () => {
    assert.throws(() => validateImageExtension('malware.exe'), /not allowed/);
  });

  it('rejects .html', () => {
    assert.throws(() => validateImageExtension('page.html'), /not allowed/);
  });

  it('rejects .svg', () => {
    assert.throws(() => validateImageExtension('icon.svg'), /not allowed/);
  });

  it('rejects .pdf', () => {
    assert.throws(() => validateImageExtension('doc.pdf'), /not allowed/);
  });

  it('throws for empty filename', () => {
    assert.throws(() => validateImageExtension(''), /required/);
  });

  it('handles uppercase extensions', () => {
    assert.strictEqual(validateImageExtension('PHOTO.JPG'), 'jpg');
  });
});

describe('validateMagicBytes', () => {
  it('validates JPEG magic bytes', () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00]);
    assert.strictEqual(validateMagicBytes(buf, 'jpg'), true);
    assert.strictEqual(validateMagicBytes(buf, 'jpeg'), true);
  });

  it('validates PNG magic bytes', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    assert.strictEqual(validateMagicBytes(buf, 'png'), true);
  });

  it('validates GIF87a magic bytes', () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0x00, 0x00]);
    assert.strictEqual(validateMagicBytes(buf, 'gif'), true);
  });

  it('validates GIF89a magic bytes', () => {
    const buf = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00, 0x00]);
    assert.strictEqual(validateMagicBytes(buf, 'gif'), true);
  });

  it('validates WebP magic bytes (RIFF...WEBP)', () => {
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46,
      0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ]);
    assert.strictEqual(validateMagicBytes(buf, 'webp'), true);
  });

  it('rejects JPEG extension with PNG magic bytes', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    assert.strictEqual(validateMagicBytes(buf, 'jpg'), false);
  });

  it('rejects PNG extension with JPEG magic bytes', () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00]);
    assert.strictEqual(validateMagicBytes(buf, 'png'), false);
  });

  it('rejects empty buffer', () => {
    assert.strictEqual(validateMagicBytes(Buffer.alloc(0), 'jpg'), false);
  });

  it('rejects null buffer', () => {
    assert.strictEqual(validateMagicBytes(null, 'jpg'), false);
  });

  it('rejects buffer too short', () => {
    const buf = Buffer.from([0xFF, 0xD8]);
    assert.strictEqual(validateMagicBytes(buf, 'jpg'), false);
  });

  it('rejects unknown extension', () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]);
    assert.strictEqual(validateMagicBytes(buf, 'bmp'), false);
  });

  it('rejects WebP without WEBP marker', () => {
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ]);
    assert.strictEqual(validateMagicBytes(buf, 'webp'), false);
  });
});

describe('ALLOWED_EXTENSIONS', () => {
  it('contains expected set', () => {
    assert.ok(ALLOWED_EXTENSIONS.has('jpg'));
    assert.ok(ALLOWED_EXTENSIONS.has('jpeg'));
    assert.ok(ALLOWED_EXTENSIONS.has('png'));
    assert.ok(ALLOWED_EXTENSIONS.has('gif'));
    assert.ok(ALLOWED_EXTENSIONS.has('webp'));
    assert.ok(!ALLOWED_EXTENSIONS.has('svg'));
    assert.ok(!ALLOWED_EXTENSIONS.has('bmp'));
    assert.ok(!ALLOWED_EXTENSIONS.has('tiff'));
  });
});
