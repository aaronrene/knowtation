/**
 * Audio/video importer. Transcribes via OpenAI Whisper, writes vault note. Phase 7.
 */

import fs from 'fs';
import path from 'path';
import { transcribe } from '../transcribe.mjs';
import { writeNote } from '../write.mjs';
import { normalizeSlug } from '../vault.mjs';

/** Extensions Whisper supports */
const SUPPORTED = new Set(['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm']);

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
    throw new Error(`${sourceType} file not found: ${input}`);
  }

  const ext = path.extname(absInput).toLowerCase();
  if (!SUPPORTED.has(ext)) {
    throw new Error(
      `Unsupported format: ${ext}. Use mp3, mp4, mpeg, mpga, m4a, wav, or webm. Transcription requires OpenAI Whisper (OPENAI_API_KEY).`
    );
  }

  const baseName = path.basename(absInput, ext);
  const sourceId = baseName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const now = new Date().toISOString().slice(0, 10);
  const outputRel = path.join(outputBase, `${sourceType}_${sourceId}.md`).replace(/\\/g, '/');

  let transcript = '';
  if (dryRun) {
    transcript = `(dry-run: would transcribe ${path.basename(absInput)} via OpenAI Whisper)`;
  } else {
    const { text, transcoded } = await transcribe(absInput);
    transcript = text;
    if (transcoded) {
      transcript =
        '> *Transcoded for Whisper (ffmpeg) before upload.*\n\n' +
        (transcript || '');
    }
  }
  const body = transcript || `(No speech detected in ${path.basename(absInput)})`;

  const frontmatter = {
    source: sourceType,
    source_id: sourceId,
    date: now,
    title: baseName,
    ...(project && { project: normalizeSlug(project) }),
    ...(tags.length && { tags }),
  };

  if (!dryRun) {
    writeNote(vaultPath, outputRel, { body, frontmatter });
  }
  return { imported: [{ path: outputRel, source_id: sourceId }], count: 1 };
}
