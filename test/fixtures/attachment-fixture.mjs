/**
 * Shared temp vault fixtures for attachment store tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { deriveAttachmentId, normalizeUrlForId } from '../../lib/attachments/attachment-store.mjs';

/** Valid Mist blob id per SPEC §2.4 / MIST_ID_RE. */
export const FIXTURE_MIST_ID = '3J98t1WpEZ73';

/**
 * @param {string} tmpRoot
 * @returns {{ vaultPath: string, dataDir: string, vaultId: string, fileId: string, mistId: string, urlId: string }}
 */
export function buildAttachmentFixtureVault(tmpRoot) {
  const vaultPath = path.join(tmpRoot, 'vault');
  const dataDir = path.join(tmpRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(vaultPath, 'media'), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, 'projects', 'demo'), { recursive: true });

  fs.writeFileSync(path.join(vaultPath, 'media', 'sample.png'), Buffer.from('89504e470d0a1a0a', 'hex'));

  fs.writeFileSync(
    path.join(vaultPath, 'notes', 'mist-note.md'),
    `---
title: Mist Note
attachments:
  - ${FIXTURE_MIST_ID}
---
# Body
`,
  );

  fs.writeFileSync(
    path.join(vaultPath, 'notes', 'url-note.md'),
    `# URL Note

![diagram](https://cdn.example.com/assets/diagram.png)
`,
  );

  fs.writeFileSync(
    path.join(vaultPath, 'projects', 'demo', 'project-photo.md'),
    `---
scope: project
---
Project note with ![x](https://project.example.org/img.png)
`,
  );

  const fileId = deriveAttachmentId('file', 'file:media/sample.png');
  const mistId = deriveAttachmentId('mist', `mist:${FIXTURE_MIST_ID}`);
  const urlId = deriveAttachmentId(
    'url',
    `url:notes/url-note.md|${normalizeUrlForId('https://cdn.example.com/assets/diagram.png')}`,
  );

  return { vaultPath, dataDir, vaultId: 'default', fileId, mistId, urlId };
}
