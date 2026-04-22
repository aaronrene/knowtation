/**
 * Import a .docx file into a vault note (Markdown via mammoth).
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';

/**
 * Stable id from file bytes (hex, 32 chars).
 * @param {Buffer} buf
 */
function sourceIdFromDocxBytes(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
}

/**
 * @param {string} inputPath
 */
function titleFromDocxFilename(inputPath) {
  const base = path.basename(inputPath, path.extname(inputPath));
  const cleaned = base.replace(/[-_]+/g, ' ').trim();
  return cleaned || 'Imported DOCX';
}

/**
 * @param {string} md
 */
function normalizeMarkdownBody(md) {
  let t = String(md || '').replace(/\r\n/g, '\n');
  t = t.replace(/\u00a0/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

/**
 * @param {string} input - Path to a .docx file
 * @param {{
 *   vaultPath: string,
 *   outputBase: string,
 *   project?: string | null,
 *   tags: string[],
 *   dryRun: boolean,
 *   onProgress?: (p: { progress: number, total?: number, message?: string }) => void | Promise<void>
 * }} ctx
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function importDocx(input, ctx) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) throw new Error('DOCX path is required');

  const { vaultPath, outputBase, project, tags, dryRun, onProgress } = ctx;
  if (onProgress) await onProgress({ progress: 0, total: 1, message: 'Reading DOCX…' });

  const absInput = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  if (!fs.existsSync(absInput)) {
    throw new Error(`Input not found: ${input}`);
  }
  if (!fs.statSync(absInput).isFile()) {
    throw new Error(`DOCX import requires a single .docx file (not a directory): ${input}`);
  }
  if (!absInput.toLowerCase().endsWith('.docx')) {
    throw new Error(`DOCX import requires a .docx file; got: ${path.basename(absInput)}`);
  }

  const buf = fs.readFileSync(absInput);
  const source_id = sourceIdFromDocxBytes(buf);
  const short = source_id.slice(0, 12);
  const outputRel = path.join(outputBase, 'imports', 'docx', `${short}.md`).replace(/\\/g, '/');

  let result;
  try {
    result = await mammoth.convertToMarkdown({ buffer: buf });
  } catch (e) {
    const msg = e && typeof e.message === 'string' ? e.message : String(e);
    throw new Error(`Could not read this DOCX (corrupt or not a Word document): ${msg}`);
  }

  const bodyMd = normalizeMarkdownBody(result.value);
  if (!bodyMd) {
    throw new Error('Could not convert this DOCX to usable text (empty document)');
  }

  const now = new Date().toISOString().slice(0, 10);
  const baseName = path.basename(absInput);
  const title = titleFromDocxFilename(absInput);

  let body =
    bodyMd +
    '\n\n---\n\n' +
    `_Imported from DOCX:_ \`${baseName}\`.\n`;

  if (result.messages && result.messages.length > 0) {
    const lines = result.messages
      .map((m) => (m && typeof m.message === 'string' ? m.message.trim() : ''))
      .filter(Boolean);
    if (lines.length) {
      body += '\n_Conversion notes:_\n\n' + lines.map((l) => `- ${l}`).join('\n') + '\n';
    }
  }

  const merged = {
    title,
    date: now,
    source: 'docx-import',
    source_id,
    docx_file: baseName,
    ...(project && { project: normalizeSlug(project) }),
    ...(tags.length && { tags }),
  };
  if (typeof merged.tags === 'string') merged.tags = tags;
  else if (Array.isArray(merged.tags)) merged.tags = [...new Set([...merged.tags, ...tags])];
  else merged.tags = tags;

  if (!dryRun) {
    writeNote(vaultPath, outputRel, {
      body,
      frontmatter: Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined && v !== null && v !== '')),
    });
  }

  if (onProgress) await onProgress({ progress: 1, total: 1, message: 'Done' });

  return { imported: [{ path: outputRel, source_id }], count: 1 };
}
