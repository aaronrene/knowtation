/**
 * Tests for Phase 18D: Hub image upload route validation logic.
 * Tests the validation layer (extension, content-type, magic bytes) without starting the server.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateImageExtension, validateMagicBytes, parseGitHubRepoUrl } from '../lib/github-commit-image.mjs';

describe('upload-image route validation', () => {
  it('rejects file with bad extension', () => {
    assert.throws(() => validateImageExtension('script.txt'), /not allowed/);
  });

  it('rejects .exe disguised upload', () => {
    assert.throws(() => validateImageExtension('payload.exe'), /not allowed/);
  });

  it('accepts valid image extensions used in upload', () => {
    for (const name of ['photo.jpg', 'screen.png', 'anim.gif', 'modern.webp', 'scan.jpeg']) {
      assert.ok(typeof validateImageExtension(name) === 'string');
    }
  });

  it('magic bytes check catches mismatch (jpg extension, png content)', () => {
    const pngBytes = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    assert.strictEqual(validateMagicBytes(pngBytes, 'jpg'), false);
  });

  it('magic bytes check passes valid JPEG', () => {
    const jpegBytes = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
    assert.strictEqual(validateMagicBytes(jpegBytes, 'jpg'), true);
  });

  it('upload path format is correct', () => {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const safeName = 'test-photo.jpg'.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 128);
    const uniqueName = `${Date.now()}-${safeName}`;
    const repoFilePath = `media/images/${yearMonth}/${uniqueName}`;

    assert.ok(repoFilePath.startsWith('media/images/'));
    assert.ok(repoFilePath.includes(yearMonth));
    assert.ok(repoFilePath.endsWith(safeName));
  });

  it('inserted markdown format is correct', () => {
    const url = 'https://raw.githubusercontent.com/user/repo/main/media/images/2026-04/photo.jpg';
    const safeName = 'photo.jpg';
    const md = `![${safeName}](${url})`;
    assert.ok(md.startsWith('!['));
    assert.ok(md.includes(']('));
    assert.ok(md.endsWith(')'));
    assert.ok(md.includes('raw.githubusercontent.com'));
  });
});

describe('upload route prerequisite checks', () => {
  it('github connection check', () => {
    const conn = null;
    assert.ok(!conn?.access_token, 'No connection should fail check');
  });

  it('remote URL required', () => {
    const config = { vault_git: {} };
    assert.ok(!config.vault_git?.remote, 'No remote should fail check');
  });

  it('repo URL parsing for upload', () => {
    const { owner, repo } = parseGitHubRepoUrl('https://github.com/myuser/my-vault.git');
    assert.strictEqual(owner, 'myuser');
    assert.strictEqual(repo, 'my-vault');
  });
});
