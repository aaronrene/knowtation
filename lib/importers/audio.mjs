/**
 * Audio importer. Phase 7 (transcription) not yet implemented.
 * For now: create a placeholder note; user runs transcription separately.
 */

import fs from 'fs';
import path from 'path';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';

/**
 * @param {string} input - Path to audio file
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function importAudio(input, ctx) {
  return importMedia(input, ctx, 'audio');
}

/**
 * @param {string} input - Path to video file
 * @param {{ vaultPath: string, outputBase: string, project?: string, tags: string[], dryRun: boolean }} ctx
 */
export async function importVideo(input, ctx) {
  return importMedia(input, ctx, 'video');
}

async function importMedia(input, ctx, sourceType) {
  const { vaultPath, outputBase, project, tags, dryRun } = ctx;
  const absInput = path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
  if (!fs.existsSync(absInput) || !fs.statSync(absInput).isFile()) {
    throw new Error(`${sourceType} file not found: ${input}. Transcription pipeline (Phase 7) not yet implemented. Run transcribe manually and use markdown import.`);
  }

  const baseName = path.basename(absInput, path.extname(absInput));
  const sourceId = baseName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const now = new Date().toISOString().slice(0, 10);
  const outputRel = path.join(outputBase, `${sourceType}_${sourceId}.md`).replace(/\\/g, '/');

  const frontmatter = {
    source: sourceType,
    source_id: sourceId,
    date: now,
    title: baseName,
    ...(project && { project: normalizeSlug(project) }),
    ...(tags.length && { tags }),
  };

  const body = `<!-- Transcription not yet run. Phase 7 will add transcription pipeline. For now, transcribe with Whisper/Ollama and paste transcript here, or use markdown import. -->\n\nSource file: ${path.basename(absInput)}`;

  if (!dryRun) writeNote(vaultPath, outputRel, { body, frontmatter });
  return { imported: [{ path: outputRel, source_id: sourceId }], count: 1 };
}
