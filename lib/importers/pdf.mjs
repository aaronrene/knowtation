/**
 * Import a PDF file into a vault note (plain text extracted via unpdf / PDF.js).
 */

import '../shims/promise-try.mjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { extractText, getDocumentProxy } from 'unpdf';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';

/**
 * Stable id from file bytes (hex, 32 chars).
 * @param {Buffer} buf
 */
function sourceIdFromPdfBytes(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
}

/**
 * @param {string} inputPath
 */
function titleFromPdfFilename(inputPath) {
  const base = path.basename(inputPath, path.extname(inputPath));
  const cleaned = base.replace(/[-_]+/g, ' ').trim();
  return cleaned || 'Imported PDF';
}

/**
 * @param {string} text
 */
function normalizeExtractedText(text) {
  let t = String(text || '').replace(/\r\n/g, '\n');
  t = t.replace(/\u00a0/g, ' ');
  t = t.replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

/**
 * @param {string} input - Path to a .pdf file
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
export async function importPdf(input, ctx) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) throw new Error('PDF path is required');

  const { vaultPath, outputBase, project, tags, dryRun, onProgress } = ctx;
  if (onProgress) await onProgress({ progress: 0, total: 1, message: 'Reading PDF…' });

  const absInput = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
  if (!fs.existsSync(absInput)) {
    throw new Error(`Input not found: ${input}`);
  }
  if (!fs.statSync(absInput).isFile()) {
    throw new Error(`PDF import requires a single .pdf file (not a directory): ${input}`);
  }
  if (!absInput.toLowerCase().endsWith('.pdf')) {
    throw new Error(`PDF import requires a .pdf file; got: ${path.basename(absInput)}`);
  }

  const buf = fs.readFileSync(absInput);
  const source_id = sourceIdFromPdfBytes(buf);
  const short = source_id.slice(0, 12);
  const outputRel = path.join(outputBase, 'imports', 'pdf', `${short}.md`).replace(/\\/g, '/');

  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  const bodyText = normalizeExtractedText(text);
  if (!bodyText) {
    throw new Error('Could not extract text from this PDF (empty or image-only)');
  }

  const now = new Date().toISOString().slice(0, 10);
  const baseName = path.basename(absInput);
  const title = titleFromPdfFilename(absInput);

  const body =
    bodyText +
    '\n\n---\n\n' +
    `_Imported from PDF:_ \`${baseName}\` · ${totalPages} page(s).\n`;

  const merged = {
    title,
    date: now,
    source: 'pdf-import',
    source_id,
    pdf_file: baseName,
    pdf_pages: totalPages,
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
