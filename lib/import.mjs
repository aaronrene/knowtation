/**
 * Import from external sources into vault. Phase 6.
 * Each importer produces vault notes with SPEC §1-2 frontmatter.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './config.mjs';
import { writeNote } from './write.mjs';
import { normalizeSlug } from './vault.mjs';
import { IMPORT_SOURCE_TYPES, isValidImportSourceType } from './import-source-types.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

/** @typedef {{
 *   project?: string,
 *   outputDir?: string,
 *   tags?: string[],
 *   dryRun?: boolean,
 *   vaultPath?: string,
 *   onProgress?: (p: { progress: number, total?: number, message?: string }) => void | Promise<void>
 * }} ImportOptions */

/**
 * Run import for a source type.
 * @param {string} sourceType - markdown, chatgpt-export, claude-export, mif, mem0-export, audio, video, etc.
 * @param {string} input - Path to file, folder, or ZIP
 * @param {ImportOptions} options
 * @returns {Promise<{ imported: { path: string, source_id?: string }[], count: number }>}
 */
export async function runImport(sourceType, input, options = {}) {
  if (!isValidImportSourceType(sourceType)) {
    throw new Error(
      `Unknown source type: ${sourceType}. Valid: ${IMPORT_SOURCE_TYPES.join(', ')}.`
    );
  }
  /** Hosted bridge passes vaultPath (temp dir); skip loadConfig so Netlify is not tied to repo config/local.yaml. */
  let vaultPath = options.vaultPath;
  if (!vaultPath) {
    const config = loadConfig(projectRoot);
    vaultPath = config.vault_path;
  }
  const project = options.project ? normalizeSlug(options.project) : null;
  const outputBase = resolveOutputDir(vaultPath, options.outputDir, project);
  const tags = options.tags || [];
  const dryRun = options.dryRun === true;

  const ctx = {
    vaultPath,
    outputBase,
    project,
    tags: Array.isArray(tags) ? tags : String(tags).split(',').map((t) => t.trim()).filter(Boolean),
    dryRun,
    onProgress: options.onProgress,
  };
  const importers = {
    markdown: () => import('./importers/markdown.mjs').then((m) => m.importMarkdown(input, ctx)),
    'chatgpt-export': () => import('./importers/chatgpt.mjs').then((m) => m.importChatGPT(input, ctx)),
    'claude-export': () => import('./importers/claude.mjs').then((m) => m.importClaude(input, ctx)),
    mif: () => import('./importers/mif.mjs').then((m) => m.importMIF(input, ctx)),
    'mem0-export': () => import('./importers/mem0.mjs').then((m) => m.importMem0(input, ctx)),
    audio: () => import('./importers/audio.mjs').then((m) => m.importAudio(input, ctx)),
    video: () => import('./importers/audio.mjs').then((m) => m.importVideo(input, ctx)),
    notion: () => import('./importers/notion.mjs').then((m) => m.importNotion(input, ctx)),
    'jira-export': () => import('./importers/jira.mjs').then((m) => m.importJira(input, ctx)),
    notebooklm: () => import('./importers/notebooklm.mjs').then((m) => m.importNotebookLM(input, ctx)),
    gdrive: () => import('./importers/gdrive.mjs').then((m) => m.importGDrive(input, ctx)),
    'linear-export': () => import('./importers/linear.mjs').then((m) => m.importLinear(input, ctx)),
  };

  const fn = importers[sourceType];
  if (!fn) {
    throw new Error(`No importer registered for source type: ${sourceType}`);
  }

  return fn();
}

/**
 * Resolve output directory: options.outputDir (vault-relative), or inbox/projects/<project>/inbox
 * @param {string} vaultPath
 * @param {string|undefined} outputDir - vault-relative
 * @param {string|null} project
 * @returns {string} vault-relative path
 */
function resolveOutputDir(vaultPath, outputDir, project) {
  if (outputDir) {
    const normalized = outputDir.replace(/\\/g, '/').replace(/\/$/, '');
    return normalized || 'inbox';
  }
  return project ? `projects/${project}/inbox` : 'inbox';
}
