#!/usr/bin/env node
/**
 * File-based capture plugin. Writes content to vault inbox per CAPTURE-CONTRACT.
 * Use from cron, scripts, or piping.
 *
 * Usage:
 *   echo "Meeting notes" | node scripts/capture-file.mjs --source file --source-id meeting-001
 *   node scripts/capture-file.mjs --file /path/to/note.md --source file --project myproject
 *
 * Options:
 *   --source <id>     Interface id (default: file)
 *   --source-id <id>  External id for dedup; uses inbox/{source}_{id}.md (idempotent overwrite)
 *   --project <slug>  Write to projects/<slug>/inbox/ instead of global inbox
 *   --tags <tags>     Comma-separated tags for frontmatter
 *   --file <path>     Read body from file; otherwise stdin
 *
 * Config: config/local.yaml or env KNOWTATION_VAULT_PATH.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../lib/config.mjs';
import { writeNote } from '../lib/write.mjs';
import { normalizeSlug } from '../lib/vault.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { source: 'file', sourceId: null, project: null, tags: null, file: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      opts.source = args[++i];
    } else if (args[i] === '--source-id' && args[i + 1]) {
      opts.sourceId = args[++i];
    } else if (args[i] === '--project' && args[i + 1]) {
      opts.project = args[++i];
    } else if (args[i] === '--tags' && args[i + 1]) {
      opts.tags = args[++i];
    } else if (args[i] === '--file' && args[i + 1]) {
      opts.file = args[++i];
    }
  }
  return opts;
}

/**
 * Make source_id safe for filename: alphanumeric, hyphen, underscore only.
 * @param {string} id
 * @returns {string}
 */
function sanitizeForFilename(id) {
  if (typeof id !== 'string') return '';
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'unknown';
}

function main() {
  const opts = parseArgs();
  let body;
  if (opts.file) {
    const abs = path.isAbsolute(opts.file) ? opts.file : path.resolve(process.cwd(), opts.file);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      console.error(`capture-file: file not found: ${opts.file}`);
      process.exit(2);
    }
    body = fs.readFileSync(abs, 'utf8');
  } else {
    body = fs.readFileSync(0, 'utf8');
  }

  const config = loadConfig(projectRoot);
  const now = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const sourceSlug = normalizeSlug(opts.source) || 'file';
  const filename = opts.sourceId
    ? `${sourceSlug}_${sanitizeForFilename(opts.sourceId)}.md`
    : `${sourceSlug}_${Date.now()}.md`;

  const relativePath = opts.project
    ? `projects/${normalizeSlug(opts.project)}/inbox/${filename}`
    : `inbox/${filename}`;

  const frontmatter = {
    source: opts.source,
    date: now,
    ...(opts.sourceId && { source_id: opts.sourceId }),
    ...(opts.project && { project: normalizeSlug(opts.project) }),
    ...(opts.tags && { tags: opts.tags }),
  };

  try {
    const result = writeNote(config.vault_path, relativePath, {
      body: body.trimEnd(),
      frontmatter,
    });
    console.log(`Captured: ${result.path}`);
    process.exit(0);
  } catch (e) {
    console.error('capture-file:', e.message);
    process.exit(2);
  }
}

main();
