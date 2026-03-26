/**
 * Transcription: audio/video → text. Phase 7.
 * Provider: OpenAI Whisper (OPENAI_API_KEY required).
 */

import fs from 'fs';
import path from 'path';

const WHISPER_URL = 'https://api.openai.com/v1/audio/transcriptions';

/** OpenAI transcription endpoint rejects files over this size (bytes). See API docs; matches observed 413 errors. */
export const WHISPER_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Supported extensions for Whisper (mp3, mp4, mpeg, mpga, m4a, wav, webm) */
const SUPPORTED_EXT = new Set(['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm']);

/**
 * Transcribe an audio or video file to text.
 * @param {string} filePath - Absolute path to audio/video file
 * @param {{ apiKey?: string, model?: string }} options - Override API key or model
 * @returns {Promise<string>} Transcript text
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
  if (st.size > WHISPER_MAX_FILE_BYTES) {
    const mb = (st.size / (1024 * 1024)).toFixed(1);
    throw new Error(
      `File is ${mb}MB; OpenAI Whisper accepts at most 25MB per request. Use a shorter clip, stronger compression, export a smaller MP3/M4A, or import an existing transcript as Markdown.`
    );
  }

  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required for transcription. Set it in the environment or config.'
    );
  }

  const model = options.model ?? 'whisper-1';

  const blob = new Blob([fs.readFileSync(absPath)]);
  const form = new FormData();
  form.append('file', blob, path.basename(absPath));
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
  return data.text?.trim() ?? '';
}
