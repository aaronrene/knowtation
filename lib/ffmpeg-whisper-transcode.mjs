/**
 * Transcode oversized media to a smaller M4A/AAC file for OpenAI Whisper (25 MB limit).
 * Requires ffmpeg on PATH or FFMPEG_PATH. Used only when input exceeds WHISPER_MAX_FILE_BYTES.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { randomBytes } from 'crypto';

const FFMPEG_TIMEOUT_MS = 10 * 60 * 1000;

export function resolveFfmpegBinary() {
  const fromEnv = process.env.FFMPEG_PATH;
  if (fromEnv && String(fromEnv).trim() && fs.existsSync(fromEnv)) {
    return path.resolve(fromEnv);
  }
  return 'ffmpeg';
}

export function probeFfmpegAvailable(bin) {
  return new Promise((resolve) => {
    const child = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-version'], {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

function runFfmpeg(bin, inputAbs, outputAbs, bitrate) {
  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-nostdin',
      '-y',
      '-i',
      inputAbs,
      '-vn',
      '-map_metadata',
      '-1',
      '-c:a',
      'aac',
      '-b:a',
      bitrate,
      '-ac',
      '1',
      '-ar',
      '16000',
      outputAbs,
    ];
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let errBuf = '';
    child.stderr?.on('data', (c) => {
      errBuf += c.toString();
    });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (_) {}
      reject(new Error(`ffmpeg timed out after ${FFMPEG_TIMEOUT_MS / 1000}s`));
    }, FFMPEG_TIMEOUT_MS);

    const finish = (err) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };

    child.on('error', (e) => finish(e));
    child.on('close', (code) => {
      if (code === 0) finish();
      else {
        const msg = errBuf.trim() || `exit code ${code}`;
        finish(new Error(`ffmpeg failed: ${msg.slice(0, 500)}`));
      }
    });
  });
}

/**
 * @param {string} inputAbs
 * @param {number} maxBytes
 * @returns {Promise<{ path: string, cleanup: () => void } | null>}
 */
export async function transcodeUnderWhisperLimit(inputAbs, maxBytes) {
  const bin = resolveFfmpegBinary();
  const available = await probeFfmpegAvailable(bin);
  if (!available) return null;

  const base = path.join(os.tmpdir(), `kn-whisper-${randomBytes(8).toString('hex')}`);
  const bitrates = ['64k', '48k', '32k', '24k'];
  let lastErr = null;

  for (const br of bitrates) {
    const out = `${base}-aac-${br}.m4a`;
    try {
      await runFfmpeg(bin, inputAbs, out, br);
    } catch (e) {
      lastErr = e;
      try {
        if (fs.existsSync(out)) fs.unlinkSync(out);
      } catch (_) {}
      continue;
    }
    const st = fs.statSync(out);
    if (st.size > 0 && st.size <= maxBytes) {
      const pathOk = out;
      return {
        path: pathOk,
        cleanup: () => {
          try {
            if (fs.existsSync(pathOk)) fs.unlinkSync(pathOk);
          } catch (_) {}
        },
      };
    }
    try {
      fs.unlinkSync(out);
    } catch (_) {}
  }

  throw lastErr || new Error('Could not compress audio under the 25MB Whisper limit');
}
