/**
 * Transcription: audio/video → text. Phase 7.
 * Provider: OpenAI Whisper (OPENAI_API_KEY required).
 * Optional: ffmpeg transcodes files over 25MB when enabled and ffmpeg is available.
 */

import fs from 'fs';
import path from 'path';
import { readTranscriptionYaml } from './config.mjs';
import { getRepoRoot } from './repo-root.mjs';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

/** OpenAI transcription endpoint rejects files over this size (bytes). See API docs; matches observed 413 errors. */
export const WHISPER_MAX_FILE_BYTES = 25 * 1024 * 1024;

const FFMPEG_HINT =
  'Install ffmpeg (https://ffmpeg.org/download.html) and ensure it is on PATH, or set FFMPEG_PATH, so Knowtation can compress oversized files automatically. Or export a smaller MP3/M4A, use a shorter clip, or import an existing transcript as Markdown.';

/** Supported extensions for Whisper (mp3, mp4, mpeg, mpga, m4a, wav, webm) */
const SUPPORTED_EXT = new Set(['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm']);

/**
 * @param {boolean} transcodeEnabled
 * @param {number} sizeBytes
 * @returns {Error}
 */
function oversizeError(transcodeEnabled, sizeBytes) {
  const mb = (sizeBytes / (1024 * 1024)).toFixed(1);
  const base = `File is ${mb}MB; OpenAI Whisper accepts at most 25MB per request.`;
  if (transcodeEnabled) {
    return new Error(`${base} ${FFMPEG_HINT}`);
  }
  return new Error(
    `${base} Automatic compression is disabled (transcription.transcode_oversized: false or KNOWTATION_TRANSCODE_OVERSIZED=0). Export a smaller MP3/M4A, use a shorter clip, or import an existing transcript as Markdown.`
  );
}

/**
 * @param {{ transcodeOversized?: boolean }} options
 */
function resolveTranscodeOversized(options) {
  if (options.transcodeOversized === false) return false;
  if (options.transcodeOversized === true) return true;
  const ev = process.env.KNOWTATION_TRANSCODE_OVERSIZED;
  if (ev === '0' || ev === 'false') return false;
  if (ev === '1' || ev === 'true') return true;
  try {
    const y = readTranscriptionYaml(getRepoRoot());
    return y.transcode_oversized !== false;
  } catch (_) {
    return true;
  }
}

/**
 * Transcribe an audio or video file to text.
 * @param {string} filePath - Absolute or cwd-relative path to audio/video file
 * @param {{ apiKey?: string, model?: string, transcodeOversized?: boolean }} options
 * @returns {Promise<{ text: string, transcoded?: boolean }>}
 */
export async function transcribe(filePath, options = {}) {
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = path.extname(absPath).toLowerCase();
  if (!SUPPORTED_EXT.has(ext)) {
    throw new Error(
      `Unsupported format: ${ext}. Use mp3, mp4, mpeg, mpga, m4a, wav, or webm.`
    );
  }

  const st = fs.statSync(absPath);
  const transcodeEnabled = resolveTranscodeOversized(options);

  let pathForUpload = absPath;
  let transcoded = false;
  /** @type {(() => void) | null} */
  let cleanupTemp = null;

  try {
    if (st.size > WHISPER_MAX_FILE_BYTES) {
      if (!transcodeEnabled) {
        throw oversizeError(false, st.size);
      }
      const { transcodeUnderWhisperLimit } = await import('./ffmpeg-whisper-transcode.mjs');
      const result = await transcodeUnderWhisperLimit(absPath, WHISPER_MAX_FILE_BYTES);
      if (!result) {
        throw oversizeError(true, st.size);
      }
      pathForUpload = result.path;
      transcoded = true;
      cleanupTemp = result.cleanup;
      const st2 = fs.statSync(pathForUpload);
      if (st2.size > WHISPER_MAX_FILE_BYTES) {
        throw new Error(
          `After compression the file is still over 25MB. Split the recording or reduce length. ${FFMPEG_HINT}`
        );
      }
    }

    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY is required for transcription. Set it in the environment or config.'
      );
    }

    let model = options.model;
    if (model == null || model === '') {
      try {
        model = readTranscriptionYaml(getRepoRoot()).model || 'whisper-1';
      } catch (_) {
        model = 'whisper-1';
      }
    }

    const blob = new Blob([fs.readFileSync(pathForUpload)]);
    const form = new FormData();
    form.append('file', blob, path.basename(pathForUpload));
    form.append('model', model);

    const res = await fetch(WHISPER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Transcription failed: ${res.status} ${res.statusText} - ${err}`);
    }

    const data = await res.json();
    const text = data.text?.trim() ?? '';
    return transcoded ? { text, transcoded: true } : { text };
  } finally {
    if (typeof cleanupTemp === 'function') {
      try {
        cleanupTemp();
      } catch (_) {}
    }
  }
}
