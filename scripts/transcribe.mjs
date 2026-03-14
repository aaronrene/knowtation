#!/usr/bin/env node
import '../lib/load-env.mjs';

/**
 * Standalone transcription script. Transcribes audio/video to stdout or writes to vault.
 *
 * Usage:
 *   node scripts/transcribe.mjs <audio-or-video-path>          # print transcript to stdout
 *   node scripts/transcribe.mjs <path> --write [output-path]   # write vault note
 *
 * Requires OPENAI_API_KEY. Config: config/local.yaml.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { transcribe } from '../lib/transcribe.mjs';
import { loadConfig } from '../lib/config.mjs';
import { writeNote } from '../lib/write.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

async function main() {
  const args = process.argv.slice(2);
  const input = args[0];
  const writeIdx = args.indexOf('--write');
  const doWrite = writeIdx !== -1;
  const outputPath = doWrite && args[writeIdx + 1] ? args[writeIdx + 1] : null;

  if (!input) {
    console.error('Usage: node scripts/transcribe.mjs <audio-or-video-path> [--write [output-path]]');
    process.exit(1);
  }

  try {
    const text = await transcribe(input);
    if (doWrite) {
      const config = loadConfig(projectRoot);
      const baseName = path.basename(input, path.extname(input));
      const relPath = outputPath || `media/audio/${baseName}.md`;
      const now = new Date().toISOString().slice(0, 10);
      writeNote(config.vault_path, relPath, {
        body: text || '(No speech detected)',
        frontmatter: { source: 'audio', source_id: baseName, date: now, title: baseName },
      });
      console.log(`Written: ${relPath}`);
    } else {
      process.stdout.write(text || '(No speech detected)\n');
    }
    process.exit(0);
  } catch (e) {
    console.error('transcribe:', e.message);
    process.exit(2);
  }
}

main();
