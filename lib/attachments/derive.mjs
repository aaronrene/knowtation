/**
 * Vault media/** walk for attachment derivation (Phase 2F-b-b).
 *
 * Extends mcp/resources/listing.mjs semantics to the full media tree with all
 * supported attachment extensions (image, video, audio, document).
 *
 * @see docs/ATTACHMENT-STORE-CONTRACT-2F-b.md §3.1
 */

import fs from 'fs';
import path from 'path';
import {
  IMAGE_EXT_MIME,
  VIDEO_EXT_MIME,
  AUDIO_EXT_MIME,
  DOC_EXT_MIME,
} from '../media-url-extract.mjs';

/** @type {Record<string, string>} */
const EXT_TO_MIME = {
  ...IMAGE_EXT_MIME,
  ...VIDEO_EXT_MIME,
  ...AUDIO_EXT_MIME,
  ...DOC_EXT_MIME,
};

export const ALL_MEDIA_EXTENSIONS = Object.keys(EXT_TO_MIME);

/**
 * @typedef {Object} VaultMediaFile
 * @property {string} relPath - vault-relative path under media/ (e.g. media/photos/x.png)
 * @property {number} byteSize
 * @property {string} mtimeIso
 * @property {string} ext
 */

/**
 * Walk all files under vault `media/**` matching known attachment extensions.
 *
 * @param {string} vaultPath - absolute vault root
 * @param {string} [mediaSubdir='media'] - vault-relative media root
 * @returns {VaultMediaFile[]}
 */
export function walkAllMediaFiles(vaultPath, mediaSubdir = 'media') {
  const relRoot = mediaSubdir.replace(/\\/g, '/').replace(/\/$/, '') || 'media';
  const dir = path.join(vaultPath, relRoot);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return [];
  }

  /** @type {VaultMediaFile[]} */
  const files = [];

  /**
   * @param {string} absDir
   * @param {string} prefix - path under media/ (may be empty)
   */
  const walk = (absDir, prefix) => {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(absDir, entry.name);
      const relUnderMedia = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, relUnderMedia);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        if (!ALL_MEDIA_EXTENSIONS.includes(ext)) continue;
        let stat;
        try {
          stat = fs.statSync(full);
        } catch {
          continue;
        }
        const vaultRel = `${relRoot}/${relUnderMedia}`.replace(/\\/g, '/');
        files.push({
          relPath: vaultRel,
          byteSize: stat.size,
          mtimeIso: stat.mtime.toISOString(),
          ext,
        });
      }
    }
  };

  walk(dir, '');
  files.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return files;
}

/**
 * @param {string} ext - extension without dot
 * @returns {{ mimeClass: 'image'|'video'|'audio'|'document'|'unknown', mimeType: string|null }}
 */
export function mimeFromExtension(ext) {
  const lower = ext.toLowerCase();
  if (lower in IMAGE_EXT_MIME) {
    return { mimeClass: 'image', mimeType: IMAGE_EXT_MIME[lower] };
  }
  if (lower in VIDEO_EXT_MIME) {
    return { mimeClass: 'video', mimeType: VIDEO_EXT_MIME[lower] };
  }
  if (lower in AUDIO_EXT_MIME) {
    return { mimeClass: 'audio', mimeType: AUDIO_EXT_MIME[lower] };
  }
  if (lower in DOC_EXT_MIME) {
    return { mimeClass: 'document', mimeType: DOC_EXT_MIME[lower] };
  }
  return { mimeClass: 'unknown', mimeType: null };
}
