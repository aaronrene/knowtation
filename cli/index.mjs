#!/usr/bin/env node
import '../lib/load-env.mjs';

/**
 * Knowtation CLI — single entry point for search, get-note, list-notes, index, etc.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
import { loadConfig } from '../lib/config.mjs';
import { readNote, resolveVaultRelativePath, noteFileExistsInVault, normalizeMetadataFacets } from '../lib/vault.mjs';
import { buildNoteOutline } from '../lib/note-outline.mjs';
import { buildDocumentTree } from '../lib/document-tree.mjs';
import { readSectionSource } from '../lib/section-source-note.mjs';
import { noteStateIdFromHubNoteJson, absentNoteStateId } from '../lib/note-state-id.mjs';
import { runListNotes as runListNotesOp } from '../lib/list-notes.mjs';
import { exitWithError } from '../lib/errors.mjs';
import { IMPORT_SOURCE_TYPES, IMPORT_SOURCE_TYPES_HELP } from '../lib/import-source-types.mjs';

const args = process.argv.slice(2);
const subcommand = args[0];
const useJson = args.includes('--json');

const help = `
knowtation — personal knowledge and content system (know + notation)

Usage:
  knowtation <command> [options]

Commands:
  search <query>     Semantic search over vault (default), or --keyword for literal text. Use --project, --tag, --folder, --limit. --json for machine output.
  get-note <path>   Return full content of one note by path. Use --body-only, --frontmatter-only, --json.
  get-note-outline <path>  Return a derived Markdown heading outline for one note. Requires --json.
  get-document-tree <path> Return a derived Markdown heading tree for one note. Requires --json.
  get-metadata-facets <path> Return bounded body-free metadata facets for one note. Requires --json.
  get-section-source <path> Return body-free SectionSource metadata for one note. Requires --json.
  list-notes        List notes. Use --folder, --project, --tag, --limit, --offset, --fields, --count-only, --json.
  index             Re-run indexer: vault → chunk → embed → vector store (Qdrant or sqlite-vec).
  write <path>      Create or overwrite a note. Use --stdin for body, --frontmatter k=v, --append.
  export <path|query> <output>  Export note(s) to dir/file. Use --format, --project. Provenance and AIR per spec.
  import <source-type> <input>   Ingest from ChatGPT, Claude, Mem0, etc. See docs/IMPORT-SOURCES.md.
  memory <action>                Memory layer commands: query, list, store, search, clear, export, stats. Requires memory.enabled.
  hub status                    Check Hub reachability (use --hub <url>). Requires Hub API.
  doctor                        Local vault + optional Hub API checks (token discipline per docs/TOKEN-SAVINGS.md). Options: --json, --hub <url>.
  propose <path>                Create a proposal from local vault note (body/frontmatter) on the Hub. Options: --hub, --intent, --vault (X-Vault-Id), --external-ref, --labels a,b, --source agent|human|import, --base-state-id, --no-fetch-base.
  vault sync                    Commit and push vault to Git (when vault.git.enabled and remote set). See config.
  mcp                           Start MCP server (stdio transport). For Cursor/Claude Desktop.
  daemon <action>               Background consolidation daemon: start [--background], stop, status, log.

Options (global):
  --help, -h        Show this help or command-specific help.
  --json            Output JSON for piping to other tools.

Config: config/local.yaml or env (KNOWTATION_VAULT_PATH). Full spec: docs/SPEC.md.
`;

function getOpt(name, type = 'string') {
  const i = args.indexOf('--' + name);
  if (i === -1 || !args[i + 1]) return null;
  const v = args[i + 1];
  return type === 'number' ? parseInt(v, 10) : v;
}

function hasOpt(name) {
  return args.includes('--' + name);
}

function runGetNote() {
  const pathArg = args.find((a, i) => i >= 1 && !a.startsWith('--'));
  if (!pathArg) {
    exitWithError('knowtation get-note: provide a note path.', 1, useJson);
  }
  const bodyOnly = hasOpt('body-only');
  const frontmatterOnly = hasOpt('frontmatter-only');
  if (bodyOnly && frontmatterOnly) {
    exitWithError('knowtation get-note: use only one of --body-only or --frontmatter-only.', 1, useJson);
  }

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }

  try {
    resolveVaultRelativePath(config.vault_path, pathArg);
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }

  let note;
  try {
    note = readNote(config.vault_path, pathArg);
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }

  if (useJson) {
    if (bodyOnly) {
      console.log(JSON.stringify({ path: note.path, body: note.body }));
    } else if (frontmatterOnly) {
      console.log(JSON.stringify({ path: note.path, frontmatter: note.frontmatter }));
    } else {
      console.log(JSON.stringify({ path: note.path, frontmatter: note.frontmatter, body: note.body }));
    }
  } else {
    if (bodyOnly) {
      process.stdout.write(note.body + (note.body ? '\n' : ''));
    } else if (frontmatterOnly) {
      console.log(JSON.stringify(note.frontmatter, null, 2));
    } else {
      console.log('---');
      console.log(yaml.dump(note.frontmatter).trimEnd());
      console.log('---');
      if (note.body) console.log(note.body);
    }
  }
  process.exit(0);
}

function runGetNoteOutline() {
  const pathArg = args.find((a, i) => i >= 1 && !a.startsWith('--'));
  if (!pathArg) {
    exitWithError('knowtation get-note-outline: provide a note path.', 1, useJson);
  }
  if (!useJson) {
    exitWithError('knowtation get-note-outline: --json is required in this MVP.', 1, useJson);
  }

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }

  try {
    resolveVaultRelativePath(config.vault_path, pathArg);
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }

  let note;
  try {
    note = readNote(config.vault_path, pathArg);
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }

  try {
    console.log(JSON.stringify(buildNoteOutline(note)));
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }
  process.exit(0);
}

function runGetDocumentTree() {
  const pathArg = args.find((a, i) => i >= 1 && !a.startsWith('--'));
  if (!pathArg) {
    exitWithError('knowtation get-document-tree: provide a note path.', 1, useJson);
  }
  if (!useJson) {
    exitWithError('knowtation get-document-tree: --json is required in this MVP.', 1, useJson);
  }

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }

  try {
    resolveVaultRelativePath(config.vault_path, pathArg);
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }

  let note;
  try {
    note = readNote(config.vault_path, pathArg);
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }

  try {
    console.log(JSON.stringify(buildDocumentTree(note)));
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }
  process.exit(0);
}

function runGetMetadataFacets() {
  const pathArg = args.find((a, i) => i >= 1 && !a.startsWith('--'));
  if (!pathArg) {
    exitWithError('knowtation get-metadata-facets: provide a note path.', 1, useJson);
  }
  if (!useJson) {
    exitWithError('knowtation get-metadata-facets: --json is required.', 1, useJson);
  }

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }

  try {
    resolveVaultRelativePath(config.vault_path, pathArg);
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }

  let note;
  try {
    note = readNote(config.vault_path, pathArg);
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }

  try {
    console.log(JSON.stringify(normalizeMetadataFacets(note.path, note.frontmatter)));
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }
  process.exit(0);
}

function runGetSectionSource() {
  const pathArgs = args.filter((a, i) => i >= 1 && !a.startsWith('--'));
  const pathArg = pathArgs[0];
  if (!pathArg) {
    exitWithError('knowtation get-section-source: provide a note path.', 1, useJson);
  }
  if (pathArgs.length > 1) {
    exitWithError('knowtation get-section-source: provide exactly one note path.', 1, useJson);
  }
  if (!useJson) {
    exitWithError('knowtation get-section-source: --json is required.', 1, useJson);
  }

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }

  try {
    console.log(JSON.stringify(readSectionSource(config.vault_path, pathArg)));
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }
  process.exit(0);
}

function runListNotes() {
  const folder = getOpt('folder');
  const project = getOpt('project');
  const tag = getOpt('tag');
  const since = getOpt('since');
  const until = getOpt('until');
  const chain = getOpt('chain');
  const entity = getOpt('entity');
  const episode = getOpt('episode');
  let limit = getOpt('limit', 'number') ?? 20;
  let offset = getOpt('offset', 'number') ?? 0;
  if (typeof limit === 'number' && (limit < 0 || limit > 100)) {
    exitWithError('knowtation list-notes: --limit must be between 0 and 100.', 1, useJson);
  }
  if (typeof offset === 'number' && offset < 0) {
    exitWithError('knowtation list-notes: --offset must be non-negative.', 1, useJson);
  }
  limit = Math.min(100, Math.max(0, limit ?? 20));
  offset = Math.max(0, offset ?? 0);
  const order = getOpt('order') || 'date';
  const fields = getOpt('fields') || 'path+metadata';
  const countOnly = hasOpt('count-only');

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }

  const out = runListNotesOp(config, {
    folder: folder ?? undefined,
    project: project ?? undefined,
    tag: tag ?? undefined,
    since: since ?? undefined,
    until: until ?? undefined,
    chain: chain ?? undefined,
    entity: entity ?? undefined,
    episode: episode ?? undefined,
    limit,
    offset,
    order,
    fields,
    countOnly,
  });

  if (countOnly) {
    if (useJson) {
      console.log(JSON.stringify({ total: out.total }));
    } else {
      console.log(out.total);
    }
    process.exit(0);
  }

  if (useJson) {
    console.log(JSON.stringify({ notes: out.notes, total: out.total }));
  } else {
    for (const n of out.notes) {
      const meta = [n.project, n.tags?.join?.(', ') ?? (n.tags || []).join(', '), n.date].filter(Boolean).join(' | ');
      console.log(n.path + (meta ? `  ${meta}` : ''));
    }
  }
  process.exit(0);
}

async function main() {
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(help.trim());
    process.exit(0);
  }

  if (subcommand === 'get-note') {
    if (hasOpt('help') || hasOpt('h')) {
      console.log('knowtation get-note <path>\n  Options: --json, --body-only, --frontmatter-only');
      process.exit(0);
    }
    runGetNote();
  }

  if (subcommand === 'get-note-outline') {
    if (hasOpt('help') || hasOpt('h')) {
      console.log('knowtation get-note-outline <path>\n  Options: --json (required)');
      process.exit(0);
    }
    runGetNoteOutline();
  }

  if (subcommand === 'get-document-tree') {
    if (hasOpt('help') || hasOpt('h')) {
      console.log('knowtation get-document-tree <path>\n  Options: --json (required)');
      process.exit(0);
    }
    runGetDocumentTree();
  }

  if (subcommand === 'get-metadata-facets') {
    if (hasOpt('help') || hasOpt('h')) {
      console.log('knowtation get-metadata-facets <path>\n  Options: --json (required)');
      process.exit(0);
    }
    runGetMetadataFacets();
  }

  if (subcommand === 'get-section-source') {
    if (hasOpt('help') || hasOpt('h')) {
      console.log('knowtation get-section-source <path>\n  Options: --json (required)');
      process.exit(0);
    }
    runGetSectionSource();
  }

  if (subcommand === 'list-notes') {
    if (hasOpt('help') || hasOpt('h')) {
      console.log('knowtation list-notes\n  Options: --folder, --project, --tag, --since, --until, --chain, --entity, --episode, --limit, --offset, --order date|date-asc, --fields path|path+metadata|full, --count-only, --json');
      process.exit(0);
    }
    runListNotes();
  }

  if (subcommand === 'search') {
    if (hasOpt('help') || hasOpt('h')) {
      console.log('knowtation search <query>\n  Options: --keyword (substring/token search), --match phrase|all-terms (with --keyword), --folder, --project, --tag, --since, --until, --chain, --entity, --episode, --content-scope all|notes|approval_logs, --order date|date-asc, --limit, --fields path|path+snippet|full, --snippet-chars <n>, --count-only, --json');
      process.exit(0);
    }
    const query = args.slice(1).filter((a) => !a.startsWith('--')).join(' ').trim();
    if (!query) {
      exitWithError('knowtation search: provide a query string.', 1, useJson);
    }
    const folder = getOpt('folder');
    const project = getOpt('project');
    const tag = getOpt('tag');
    const since = getOpt('since');
    const until = getOpt('until');
    const chain = getOpt('chain');
    const entity = getOpt('entity');
    const episode = getOpt('episode');
    const order = getOpt('order');
    let limit = getOpt('limit', 'number') ?? 10;
    if (typeof limit === 'number' && (limit < 0 || limit > 100)) {
      exitWithError('knowtation search: --limit must be between 0 and 100.', 1, useJson);
    }
    limit = Math.min(100, Math.max(0, limit ?? 10));
    const fields = getOpt('fields') || 'path+snippet';
    const snippetChars = getOpt('snippet-chars', 'number');
    const countOnly = hasOpt('count-only');
    const useKeyword = hasOpt('keyword');
    const matchRaw = getOpt('match');
    const contentScope = getOpt('content-scope');
    const validFields = ['path', 'path+snippet', 'full'];
    if (fields && !validFields.includes(fields)) {
      exitWithError(`knowtation search: --fields must be one of ${validFields.join(', ')}.`, 1, useJson);
    }
    if (matchRaw && !useKeyword) {
      exitWithError('knowtation search: --match is only valid with --keyword.', 1, useJson);
    }
    let match = 'phrase';
    if (matchRaw) {
      if (matchRaw === 'all-terms' || matchRaw === 'all_terms') match = 'all_terms';
      else if (matchRaw === 'phrase') match = 'phrase';
      else exitWithError('knowtation search: --match must be phrase or all-terms.', 1, useJson);
    }
    const validScopes = ['all', 'notes', 'approval_logs'];
    if (contentScope && !validScopes.includes(contentScope)) {
      exitWithError(`knowtation search: --content-scope must be one of ${validScopes.join(', ')}.`, 1, useJson);
    }
    (async () => {
      try {
        const config = loadConfig();
        const baseOpts = {
          folder: folder ?? undefined,
          project: project ?? undefined,
          tag: tag ?? undefined,
          since: since ?? undefined,
          until: until ?? undefined,
          chain: chain ?? undefined,
          entity: entity ?? undefined,
          episode: episode ?? undefined,
          order: order ?? undefined,
          limit,
          fields: fields || 'path+snippet',
          snippetChars: snippetChars ?? 300,
          countOnly,
          content_scope: contentScope === 'all' ? undefined : contentScope ?? undefined,
        };
        let out;
        if (useKeyword) {
          const { runKeywordSearch } = await import('../lib/keyword-search.mjs');
          out = await runKeywordSearch(query, { ...baseOpts, match }, config);
        } else {
          const { runSearch } = await import('../lib/search.mjs');
          out = await runSearch(query, baseOpts, config);
        }
        if (config.memory?.enabled) {
          try {
            const { createMemoryManager } = await import('../lib/memory.mjs');
            const mm = createMemoryManager(config);
            if (mm.shouldCapture('search')) {
              mm.store('search', {
                query: out.query,
                mode: useKeyword ? 'keyword' : 'semantic',
                paths: (out.results || []).map((r) => r.path),
                count: out.count ?? (out.results || []).length,
              });
            }
          } catch (_) {}
        }
        if (useJson) {
          console.log(JSON.stringify(out));
        } else {
          if (out.count !== undefined) {
            console.log(out.count);
          } else {
            const list = out.results || [];
            for (const r of list) {
              const meta = [r.project, r.tags?.join(', ')].filter(Boolean).join(' | ');
              const line = r.snippet != null ? `${r.path}\t${r.snippet}` : r.path;
              console.log(line + (meta ? `  ${meta}` : ''));
            }
          }
        }
        process.exit(0);
      } catch (e) {
        exitWithError(e.message || String(e), 2, useJson);
      }
    })();
    return;
  }

  if (subcommand === 'index') {
    if (hasOpt('help') || hasOpt('h')) {
      console.log('knowtation index\n  Re-run indexer: vault → chunk → embed → vector store. Reads config; exit 0 on success, 2 on failure.');
      process.exit(0);
    }
    const { runIndex } = await import('../lib/indexer.mjs');
    try {
      const t0 = Date.now();
      const result = await runIndex();
      const config = loadConfig();
      if (config.memory?.enabled) {
        try {
          const { createMemoryManager } = await import('../lib/memory.mjs');
          const mm = createMemoryManager(config);
          if (mm.shouldCapture('index')) {
            mm.store('index', {
              notes_processed: result.notesProcessed,
              chunks_indexed: result.chunksIndexed,
              duration_ms: Date.now() - t0,
            });
          }
        } catch (_) {}
      }
      if (useJson) {
        console.log(JSON.stringify({ ok: true, notesProcessed: result.notesProcessed, chunksIndexed: result.chunksIndexed }));
      }
      process.exit(0);
    } catch (e) {
      exitWithError(e.message, 2, useJson);
    }
  }

  if (subcommand === 'write') {
    if (hasOpt('help') || hasOpt('h')) {
      console.log('knowtation write <path> [content]\n  Options: --stdin (body from stdin), --frontmatter k=v [k2=v2 ...], --append, --json');
      process.exit(0);
    }
    const pathArg = args.find((a, i) => i >= 1 && !a.startsWith('--'));
    if (!pathArg) {
      exitWithError('knowtation write: provide a note path.', 1, useJson);
    }
    const stdin = hasOpt('stdin');
    const append = hasOpt('append');
    const frontmatterPairs = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--frontmatter' && args[i + 1]) {
        let j = i + 1;
        while (j < args.length && !args[j].startsWith('--') && args[j].includes('=')) {
          frontmatterPairs.push(args[j]);
          j++;
        }
        break;
      }
    }
    const frontmatterOverrides = {};
    for (const p of frontmatterPairs) {
      const eq = p.indexOf('=');
      if (eq > 0) {
        frontmatterOverrides[p.slice(0, eq).trim()] = p.slice(eq + 1).trim();
      }
    }
    let body;
    if (stdin) {
      body = fs.readFileSync(0, 'utf8');
    } else {
      const contentArg = args[args.indexOf(pathArg) + 1];
      body = contentArg && !contentArg.startsWith('--') ? contentArg : undefined;
    }
    let config;
    try {
      config = loadConfig();
    } catch (e) {
      exitWithError(e.message, 2, useJson);
    }
    (async () => {
      try {
        const { writeNote } = await import('../lib/write.mjs');
        const result = await writeNote(config.vault_path, pathArg, {
          body,
          frontmatter: Object.keys(frontmatterOverrides).length ? frontmatterOverrides : undefined,
          append,
          config,
        });
        try {
          const { maybeAutoSync } = await import('../lib/vault-git-sync.mjs');
          maybeAutoSync(config);
        } catch (_) {}
        if (config.memory?.enabled) {
          try {
            const { createMemoryManager } = await import('../lib/memory.mjs');
            const mm = createMemoryManager(config);
            if (mm.shouldCapture('write')) {
              mm.store('write', {
                path: result.path,
                action: append ? 'append' : 'create',
                air_id: result.air_id || undefined,
              });
            }
          } catch (_) {}
        }
        if (useJson) {
          console.log(JSON.stringify(result));
        } else {
          console.log(`Written: ${result.path}`);
        }
        process.exit(0);
      } catch (e) {
        exitWithError(e.message, 2, useJson);
      }
    })();
    return;
  }

  if (subcommand === 'export') {
    if (hasOpt('help') || hasOpt('h')) {
      console.log('knowtation export <path-or-query> <output-dir-or-file>\n  Options: --format md|html, --project <slug>, --json');
      process.exit(0);
    }
    const pathOrQuery = args[1];
    const output = args[2];
    if (!pathOrQuery || !output) {
      exitWithError('knowtation export: provide <path-or-query> and <output-dir-or-file>.', 1, useJson);
    }
    const format = getOpt('format') || 'md';
    const project = getOpt('project');
    if (format && !['md', 'html'].includes(format)) {
      exitWithError('knowtation export: --format must be md or html.', 1, useJson);
    }
    let config;
    try {
      config = loadConfig();
    } catch (e) {
      exitWithError(e.message, 2, useJson);
    }
    (async () => {
      try {
        const { exportNotes } = await import('../lib/export.mjs');
        const { attestBeforeExport } = await import('../lib/air.mjs');
        let paths = [];
        const looksLikePath = !pathOrQuery.includes(' ') && (pathOrQuery.endsWith('.md') || pathOrQuery.includes('/'));
        if (looksLikePath) {
          try {
            resolveVaultRelativePath(config.vault_path, pathOrQuery);
            paths = [pathOrQuery];
          } catch (_) {
            // Fall through: treat as query
          }
        }
        if (paths.length === 0) {
          const { runSearch } = await import('../lib/search.mjs');
          const result = await runSearch(pathOrQuery, {
            limit: 50,
            project: project ?? undefined,
            fields: 'path',
          });
          paths = (result.results || []).map((r) => r.path).filter(Boolean);
        }
        if (!paths.length) {
          exitWithError('knowtation export: no notes found for path or query.', 2, useJson);
        }
        if (config.air?.enabled) {
          await attestBeforeExport(config, paths);
        }
        const result = exportNotes(config.vault_path, paths, output, { format });
        if (config.memory?.enabled) {
          try {
            const { createMemoryManager } = await import('../lib/memory.mjs');
            const mm = createMemoryManager(config);
            if (mm.shouldCapture('export')) {
              mm.store('export', { provenance: result.provenance, exported: result.exported, format });
            }
          } catch (_) {}
        }
        if (useJson) {
          console.log(JSON.stringify({ exported: result.exported, provenance: result.provenance }));
        } else {
          for (const e of result.exported) {
            console.log(`${e.path} → ${e.output}`);
          }
          if (result.provenance) console.log(result.provenance);
        }
        process.exit(0);
      } catch (e) {
        exitWithError(e.message, 2, useJson);
      }
    })();
    return;
  }

  if (subcommand === 'import') {
    if (hasOpt('help') || hasOpt('h')) {
      console.log(
        `knowtation import <source-type> <input>\n  Options: --project, --output-dir, --tags t1,t2, --dry-run, --json, --sheets-range 'A1 range' (google-sheets only), --url-mode auto|bookmark|extract (url only)\n  Source types: ${IMPORT_SOURCE_TYPES_HELP}`
      );
      process.exit(0);
    }
    const sourceType = args[1];
    const input = args[2];
    if (!sourceType) {
      exitWithError('knowtation import: provide <source-type> and <input>. See docs/IMPORT-SOURCES.md.', 1, useJson);
    }
    if (sourceType !== 'google-sheets' && !input) {
      exitWithError('knowtation import: provide <source-type> and <input>. See docs/IMPORT-SOURCES.md.', 1, useJson);
    }
    if (sourceType === 'google-sheets' && !input) {
      exitWithError(
        'knowtation import google-sheets: provide the spreadsheet id as <input> (the id from the Google Sheets URL).',
        1,
        useJson,
      );
    }
    if (!IMPORT_SOURCE_TYPES.includes(sourceType)) {
      exitWithError(`Unknown source-type "${sourceType}". Valid: ${IMPORT_SOURCE_TYPES_HELP}.`, 1, useJson);
    }
    (async () => {
      try {
        const config = loadConfig();
        const { runImport } = await import('../lib/import.mjs');
        const project = getOpt('project');
        const outputDir = getOpt('output-dir');
        const tagsOpt = getOpt('tags');
        const tags = tagsOpt ? tagsOpt.split(',').map((t) => t.trim()).filter(Boolean) : [];
        const dryRun = hasOpt('dry-run');
        let memoryManager;
        if (config.memory?.enabled && !dryRun) {
          try {
            const { createMemoryManager } = await import('../lib/memory.mjs');
            memoryManager = createMemoryManager(config);
          } catch (_) {}
        }

        const urlModeRaw = getOpt('url-mode');
        let urlMode;
        if (urlModeRaw) {
          const v = String(urlModeRaw).trim().toLowerCase();
          if (v !== 'auto' && v !== 'bookmark' && v !== 'extract') {
            exitWithError(`Invalid --url-mode "${urlModeRaw}". Use auto, bookmark, or extract.`, 1, useJson);
          }
          urlMode = v;
        }
        if (urlModeRaw && sourceType !== 'url') {
          exitWithError('--url-mode is only valid when source-type is url.', 1, useJson);
        }
        const sheetsRangeRaw = getOpt('sheets-range');
        if (sheetsRangeRaw && sourceType !== 'google-sheets') {
          exitWithError('--sheets-range is only valid when source-type is google-sheets.', 1, useJson);
        }

        const importOpts = {
          project: project ?? undefined,
          outputDir: outputDir ?? undefined,
          tags,
          dryRun,
          ...(sourceType === 'url' && urlMode ? { urlMode } : {}),
          ...(sourceType === 'google-sheets' && sheetsRangeRaw
            ? { sheetsRange: String(sheetsRangeRaw).trim() }
            : {}),
        };
        if (memoryManager && sourceType === 'mem0-export' && memoryManager.shouldCapture('capture')) {
          importOpts.onMemoryEvent = (data) => {
            try { memoryManager.store('capture', data); } catch (_) {}
          };
        }

        const result = await runImport(sourceType, input, importOpts);
        if (memoryManager) {
          try {
            if (memoryManager.shouldCapture('import')) {
              memoryManager.store('import', {
                source_type: sourceType,
                count: result.count ?? 0,
                paths: (result.imported || []).map((r) => r.path).slice(0, 50),
                project: project ?? undefined,
              });
            }
          } catch (_) {}
        }
        if (useJson) {
          console.log(JSON.stringify({ imported: result.imported, count: result.count }));
        } else {
          for (const r of result.imported) {
            console.log(r.path);
          }
          if (result.count === 0) {
            console.log('No notes imported.');
          } else {
            console.log(`Imported ${result.count} note(s).`);
          }
        }
        process.exit(0);
      } catch (e) {
        exitWithError(e.message, 2, useJson);
      }
    })();
    return;
  }

  if (subcommand === 'mcp') {
    if (hasOpt('help') || hasOpt('h')) {
      console.log(
        'knowtation mcp\n  Start MCP server (default: stdio for Cursor / Claude Desktop).\n  Streamable HTTP: MCP_TRANSPORT=http or KNOWTATION_MCP_TRANSPORT=http (see docs/MCP-PHASE-D.md).\n  Requires config/local.yaml and KNOWTATION_VAULT_PATH.'
      );
      process.exit(0);
    }
    const serverMod = await import('../mcp/server.mjs');
    return;
  }

  if (subcommand === 'memory') {
    const action = args[1];
    if (hasOpt('help') || hasOpt('h')) {
      console.log(`knowtation memory <action>
  Actions:
    query <key>              Read latest value for an event type (e.g. search, export, write, import, index, propose, user).
    list                     List recent memory events. --type, --topic, --since, --until, --limit (default 20), --json.
    store <key> <value>      Store a user-defined memory entry. Value is JSON string or --stdin.
    search <query>           Semantic search over memory (requires vector or mem0 provider). --limit, --json.
    clear                    Clear memory. --type, --before <date>, --confirm required. --json.
    export                   Export memory log. --format jsonl|mif, --since, --until, --type. Output to stdout.
    stats                    Show memory statistics. --json.
    index                    Print lightweight pointer index (markdown). --json returns structured object.
    consolidate              Run LLM-powered memory consolidation. --dry-run, --passes consolidate,verify,discover, --lookback-hours <n>. --json.

  Options: --json`);
      process.exit(0);
    }
    const validActions = ['query', 'list', 'store', 'search', 'clear', 'export', 'stats', 'index', 'consolidate'];
    if (!action || !validActions.includes(action)) {
      exitWithError(`knowtation memory: use "memory <action>". Actions: ${validActions.join(', ')}.`, 1, useJson);
    }
    let config;
    try {
      config = loadConfig();
    } catch (e) {
      exitWithError(e.message, 2, useJson);
    }
    if (!config.memory?.enabled) {
      exitWithError('knowtation memory: memory layer not enabled. Set memory.enabled in config.', 2, useJson);
    }
    (async () => {
      try {
        const { createMemoryManager } = await import('../lib/memory.mjs');
        const { MEMORY_EVENT_TYPES } = await import('../lib/memory-event.mjs');
        const scopeOpt = getOpt('scope') === 'global' ? 'global' : undefined;
        const mm = createMemoryManager(config, 'default', scopeOpt ? { scope: scopeOpt } : {});

        if (action === 'query') {
          const keyArg = args[2];
          if (!keyArg) {
            exitWithError('knowtation memory query: provide a key (event type).', 1, useJson);
          }
          const key = keyArg.replace(/\s+/g, '_');
          const latest = mm.getLatest(key);
          if (!latest) {
            if (useJson) console.log(JSON.stringify({ key, value: null }));
            else console.log('(no value)');
          } else {
            const { id: _id, vault_id: _vid, ...display } = latest;
            if (useJson) console.log(JSON.stringify({ key, value: display }));
            else console.log(JSON.stringify(display, null, 2));
          }
          process.exit(0);
        }

        if (action === 'list') {
          const type = getOpt('type');
          const topic = getOpt('topic');
          const since = getOpt('since');
          const until = getOpt('until');
          const limit = getOpt('limit', 'number') ?? 20;
          const events = mm.list({ type: type ?? undefined, topic: topic ?? undefined, since: since ?? undefined, until: until ?? undefined, limit });
          if (useJson) {
            console.log(JSON.stringify({ events, count: events.length }));
          } else {
            if (events.length === 0) console.log('(no events)');
            for (const e of events) {
              const summary = JSON.stringify(e.data).slice(0, 120);
              console.log(`${e.ts}  ${e.type}  ${summary}`);
            }
          }
          process.exit(0);
        }

        if (action === 'store') {
          const keyArg = args[2];
          if (!keyArg) {
            exitWithError('knowtation memory store: provide a key.', 1, useJson);
          }
          let valueRaw;
          if (hasOpt('stdin')) {
            valueRaw = fs.readFileSync(0, 'utf8').trim();
          } else {
            valueRaw = args[3];
          }
          if (!valueRaw) {
            exitWithError('knowtation memory store: provide a value (JSON string) or --stdin.', 1, useJson);
          }
          let value;
          try {
            value = JSON.parse(valueRaw);
          } catch (_) {
            value = { text: valueRaw };
          }
          const result = mm.store('user', { key: keyArg, ...value });
          if (useJson) console.log(JSON.stringify(result));
          else console.log(`Stored: ${result.id}`);
          process.exit(0);
        }

        if (action === 'search') {
          const query = args.slice(2).filter((a) => !a.startsWith('--')).join(' ').trim();
          if (!query) {
            exitWithError('knowtation memory search: provide a query string.', 1, useJson);
          }
          if (!mm.supportsSearch()) {
            exitWithError('knowtation memory search: semantic search requires memory.provider: vector or mem0.', 2, useJson);
          }
          const limit = getOpt('limit', 'number') ?? 10;
          const results = mm.search(query, { limit });
          if (useJson) {
            console.log(JSON.stringify({ results, count: results.length }));
          } else {
            if (results.length === 0) console.log('(no results)');
            for (const r of results) {
              console.log(`${r.ts}  ${r.type}  ${JSON.stringify(r.data).slice(0, 120)}`);
            }
          }
          process.exit(0);
        }

        if (action === 'clear') {
          if (!hasOpt('confirm')) {
            exitWithError('knowtation memory clear: use --confirm to confirm deletion.', 1, useJson);
          }
          const type = getOpt('type');
          const before = getOpt('before');
          const result = mm.clear({ type: type ?? undefined, before: before ?? undefined });
          if (useJson) console.log(JSON.stringify(result));
          else console.log(`Cleared ${result.cleared} event(s).`);
          process.exit(0);
        }

        if (action === 'export') {
          const format = getOpt('format') || 'jsonl';
          if (!['jsonl', 'mif'].includes(format)) {
            exitWithError('knowtation memory export: --format must be jsonl or mif.', 1, useJson);
          }
          const type = getOpt('type');
          const since = getOpt('since');
          const until = getOpt('until');
          const events = mm.list({ type: type ?? undefined, since: since ?? undefined, until: until ?? undefined, limit: 10000 });
          if (format === 'jsonl') {
            for (const e of events) {
              console.log(JSON.stringify(e));
            }
          } else {
            for (const e of events) {
              console.log(`---`);
              console.log(`id: ${e.id}`);
              console.log(`type: ${e.type}`);
              console.log(`ts: ${e.ts}`);
              console.log(`vault_id: ${e.vault_id}`);
              console.log(`---`);
              console.log(JSON.stringify(e.data, null, 2));
              console.log('');
            }
          }
          process.exit(0);
        }

        if (action === 'summarize') {
          const since = getOpt('since') || new Date(Date.now() - 86_400_000).toISOString();
          const maxTokens = getOpt('max-tokens', 'number') ?? 512;
          const dryRun = hasOpt('dry-run');
          try {
            const { generateSessionSummary } = await import('../lib/memory-session-summary.mjs');
            const result = await generateSessionSummary(config, { since, maxTokens, dryRun });
            if (useJson) {
              console.log(JSON.stringify(result));
            } else {
              console.log(result.summary);
              if (result.id) console.log(`\nStored as: ${result.id}`);
              console.log(`Events summarized: ${result.event_count}`);
            }
          } catch (e) {
            exitWithError(`Session summary failed: ${e.message}`, 2, useJson);
          }
          process.exit(0);
        }

        if (action === 'consolidate') {
          const dryRun = hasOpt('dry-run');
          const passesRaw = getOpt('passes', 'string');
          const passes = passesRaw
            ? passesRaw.split(',').map((s) => s.trim()).filter(Boolean)
            : undefined;
          const lookbackHours = getOpt('lookback-hours', 'number') ?? undefined;
          try {
            const { consolidateMemory } = await import('../lib/memory-consolidate.mjs');
            const result = await consolidateMemory(config, { dryRun, passes, lookbackHours });
            if (useJson) {
              console.log(JSON.stringify(result));
            } else if (result.dry_run) {
              console.log(`[dry-run] Would process ${result.total_events} events across ${result.topics.length} topics.`);
              for (const t of result.topics) {
                console.log(`[dry-run] Topic "${t.topic}": ${t.event_count} events → ${t.dry_run_estimate || 'estimated facts'}`);
              }
              if (result.verify) {
                console.log(`[dry-run] Verify pass: would check paths in events (no writes).`);
              }
              if (result.discover) {
                console.log(`[dry-run] Discover pass: would analyze ${result.discover.topic_count} topic(s) for cross-topic insights (no writes).`);
              }
            } else if (result.topics.length === 0 && !result.verify && !result.discover) {
              console.log('No events to consolidate.');
            } else {
              if (result.topics.length > 0) {
                console.log(`Consolidated ${result.total_events} events across ${result.topics.length} topics.`);
                for (const t of result.topics) {
                  if (t.error) {
                    console.log(`  ${t.topic}: error — ${t.error}`);
                  } else {
                    console.log(`  ${t.topic}: ${t.facts.length} facts written${t.id ? ` (${t.id})` : ''}`);
                  }
                }
                console.log('Index regenerated.');
              }
              if (result.verify) {
                const v = result.verify;
                console.log(`Verify pass: checked ${v.checked_count} events — ${v.verified_paths.length} verified, ${v.stale_paths.length} stale.`);
                if (v.stale_paths.length > 0) {
                  for (const p of v.stale_paths) console.log(`  stale: ${p}`);
                }
              }
              if (result.discover) {
                const d = result.discover;
                console.log(`Discover pass: ${d.connections.length} connection(s), ${d.contradictions.length} contradiction(s), ${d.open_questions.length} open question(s) across ${d.topic_count} topic(s).`);
              }
            }
          } catch (e) {
            exitWithError(`Consolidation failed: ${e.message}`, 2, useJson);
          }
          process.exit(0);
        }

        if (action === 'index') {
          const idx = mm.generateIndex({ force: true });
          if (useJson) {
            console.log(JSON.stringify(idx));
          } else {
            console.log(idx.markdown);
          }
          process.exit(0);
        }

        if (action === 'stats') {
          const stats = mm.stats();
          if (useJson) {
            console.log(JSON.stringify(stats));
          } else {
            console.log(`Total events: ${stats.total}`);
            console.log(`Storage: ${stats.size_bytes} bytes`);
            if (stats.oldest) console.log(`Oldest: ${stats.oldest}`);
            if (stats.newest) console.log(`Newest: ${stats.newest}`);
            if (Object.keys(stats.counts_by_type).length > 0) {
              console.log('Counts by type:');
              for (const [t, c] of Object.entries(stats.counts_by_type)) {
                console.log(`  ${t}: ${c}`);
              }
            }
          }
          process.exit(0);
        }
      } catch (e) {
        exitWithError(e.message, 2, useJson);
      }
    })();
    return;
  }

  if (subcommand === 'doctor') {
    if (hasOpt('help') || hasOpt('h')) {
      console.log(
        'knowtation doctor\n  Checks local vault config (disk vault) and optional Hub API (KNOWTATION_HUB_*).\n  Explains vault vs terminal token discipline per docs/TOKEN-SAVINGS.md.\n  Options: --json, --hub <url> (override KNOWTATION_HUB_URL for probes only).'
      );
      process.exit(0);
    }
    const hubUrlOpt = getOpt('hub');
    const { runDoctor } = await import('./doctor.mjs');
    const code = await runDoctor({ useJson, hubUrlOpt });
    process.exit(code);
  }

  if (subcommand === 'hub') {
    const action = args[1];
    if (action !== 'status') {
      exitWithError('knowtation hub: use "hub status". Option: --hub <url>.', 1, useJson);
    }
    const hubUrl = getOpt('hub') || process.env.KNOWTATION_HUB_URL || 'http://localhost:3333';
    const base = hubUrl.replace(/\/$/, '');
    (async () => {
      try {
        const res = await fetch(base + '/health', { method: 'GET' });
        const data = await res.json().catch(() => ({}));
        if (useJson) {
          console.log(JSON.stringify({ ok: res.ok, status: res.status, url: base }));
        } else {
          console.log(res.ok ? `Hub at ${base} is up.` : `Hub at ${base} returned ${res.status}.`);
        }
        process.exit(res.ok ? 0 : 2);
      } catch (e) {
        exitWithError('Hub unreachable: ' + e.message, 2, useJson);
      }
    })();
    return;
  }

  if (subcommand === 'vault') {
    const vaultSub = args[1];
    if (vaultSub === 'sync') {
      if (hasOpt('help') || hasOpt('h')) {
        console.log('knowtation vault sync\n  Commits and pushes the vault to the configured Git remote.\n  Requires config: vault.git.enabled=true and vault.git.remote=<url>.');
        process.exit(0);
      }
      let config;
      try {
        config = loadConfig();
      } catch (e) {
        exitWithError(e.message, 2, useJson);
      }
      (async () => {
        try {
          const { runVaultSync } = await import('../lib/vault-git-sync.mjs');
          const result = runVaultSync(config);
          if (useJson) console.log(JSON.stringify(result));
          else console.log(result.message === 'Synced' ? 'Vault synced to remote.' : result.message);
          process.exit(0);
        } catch (e) {
          exitWithError('knowtation vault sync: ' + (e.message || 'git failed'), 1, useJson);
        }
      })();
      return;
    }
    exitWithError('knowtation vault: unknown subcommand. Use vault sync.', 1, useJson);
  }

  if (subcommand === 'propose') {
    const pathArg = args[1];
    if (!pathArg || pathArg.startsWith('--')) {
      exitWithError('knowtation propose: provide a vault-relative note path (e.g. inbox/note.md).', 1, useJson);
    }
    const hubUrl = getOpt('hub') || process.env.KNOWTATION_HUB_URL;
    if (!hubUrl) {
      exitWithError('knowtation propose: set --hub <url> or KNOWTATION_HUB_URL.', 1, useJson);
    }
    let config;
    try {
      config = loadConfig();
    } catch (e) {
      exitWithError(e.message, 2, useJson);
    }
    try {
      resolveVaultRelativePath(config.vault_path, pathArg);
    } catch (e) {
      exitWithError(e.message, 2, useJson);
    }
    const intent = getOpt('intent') || '';
    const token = process.env.KNOWTATION_HUB_TOKEN;
    if (!token) {
      exitWithError('knowtation propose: set KNOWTATION_HUB_TOKEN (JWT from Hub login).', 2, useJson);
    }
    const base = hubUrl.replace(/\/$/, '');
    const vaultHdr = getOpt('vault') || process.env.KNOWTATION_HUB_VAULT_ID;
    const labelsRaw = getOpt('labels');
    const labels = labelsRaw
      ? labelsRaw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
    const source = getOpt('source') || undefined;
    const externalRef = getOpt('external-ref') || undefined;
    const baseStateOverride = getOpt('base-state-id');
    const skipFetchBase = hasOpt('no-fetch-base');

    let bodyText = '';
    let frontmatter = {};
    if (noteFileExistsInVault(config.vault_path, pathArg)) {
      const n = readNote(config.vault_path, pathArg);
      bodyText = n.body;
      frontmatter = n.frontmatter;
    }

    (async () => {
      try {
        const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
        if (vaultHdr) headers['X-Vault-Id'] = vaultHdr;

        let baseStateId = baseStateOverride && String(baseStateOverride).trim() ? String(baseStateOverride).trim() : '';
        if (!baseStateId && !skipFetchBase) {
          const encPath = pathArg.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
          const gres = await fetch(`${base}/api/v1/notes/${encPath}`, { method: 'GET', headers });
          if (gres.status === 404) {
            baseStateId = absentNoteStateId();
          } else if (gres.ok) {
            const noteJson = await gres.json();
            baseStateId = noteStateIdFromHubNoteJson(noteJson);
          }
        }

        const payload = {
          path: pathArg.replace(/\\/g, '/'),
          body: bodyText,
          frontmatter,
          intent: intent || undefined,
          external_ref: externalRef || undefined,
          labels,
          source,
        };
        if (baseStateId) payload.base_state_id = baseStateId;

        const res = await fetch(base + '/api/v1/proposals', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          exitWithError(data.error || res.statusText, 2, useJson);
          return;
        }
        try {
          const config2 = loadConfig();
          if (config2.memory?.enabled) {
            const { createMemoryManager } = await import('../lib/memory.mjs');
            const mm = createMemoryManager(config2);
            if (mm.shouldCapture('propose')) {
              mm.store('propose', {
                proposal_id: data.proposal_id,
                path: data.path || pathArg,
                intent: intent || undefined,
                base_state_id: baseStateId || undefined,
              });
            }
          }
        } catch (_) {}
        if (useJson) console.log(JSON.stringify(data));
        else console.log('Proposal created:', data.proposal_id, data.path);
        process.exit(0);
      } catch (e) {
        exitWithError(e.message, 2, useJson);
      }
    })();
    return;
  }

  if (subcommand === 'flow') {
    const flowAction = args[1];
    if (hasOpt('help') || hasOpt('h') || !flowAction) {
      console.log(`knowtation flow <action>
  Actions (v0 read surface):
    list [--scope personal|project|org] [--tag <t>] [--limit <n>] [--json]
    get <flow_id> [--version <semver>] [--json]
    project <flow_id> --harness <harness> [--version <semver>] [--out <path>] [--check] [--json]

  Authoring (gated by FLOW_AUTHORING_WRITES; default off):
    propose <bundle.json> [--intent <text>] [--base-version <semver>] [--base-state-id <flowst1_…>] [--json]
    import <bundle.json> [--intent <text>] [--external-ref <ref>] [--source-vault-hint <hint>] [--json]

  External-agent grants (gated by FLOW_EXTERNAL_AGENT_ENABLED; default off):
    grant mint <flow_id> --flow-version <semver> --tools <id>[,<id>…] [--ttl-seconds <n>] [--actor-label <label>] [--json]
    grant revoke <grant_id> [--json]
    grant list [--flow-id <id>] [--json]

  Run execution (gated by FLOW_RUN_WRITES_ENABLED / FLOW_AUTOMATABLE_EXECUTION_ENABLED; default off):
    run start <flow_id> --flow-version <semver> [--task-ref <id>] [--external-ref <ref>] [--json]
    run get <run_id> [--json]
    run list [--flow-id <id>] [--json]
    run advance <run_id> --step-id <id> --to-status <status> [--skip-reason <enum>] [--json]
    run evidence <run_id> --step-id <id> --evidence-ref <ref> --pointer-kind <kind> [--json]
    run execute <run_id> --step-id <id> --consent-id <id> [--model-lane <lane>] [--dry-run] [--json]
    run consent <run_id> --lanes <lane>[,<lane>…] --cost-cap <n> [--ttl-seconds <n>] [--json]
    run submit-review <run_id> --intent <text> [--json]

  Capture flywheel (gated by FLOW_CAPTURE_DETECTION_ENABLED / FLOW_CAPTURE_WRITES_ENABLED; default off):
    capture observe <signals.json> [--include-low-confidence] [--json]
    capture list [--scope personal|project|org] [--include-low-confidence] [--limit <n>] [--json]
    capture propose <candidate_id> --confirmed-scope <scope> --intent <text> [--scope-widen-acknowledged] [--allow-low-confidence] [--force-new-flow] [--merge-into-flow-id <id>] [--json]
    capture dismiss <candidate_id> --intent <text> [--json]

  Reserved (not wired in v0): export

  Options: --json (exact Hub JSON)`);
      process.exit(0);
    }

    const gatedActions = ['export'];
    if (gatedActions.includes(flowAction)) {
      exitWithError(`knowtation flow ${flowAction}: not available in v0 (gated).`, 1, useJson);
    }

    let config;
    try {
      config = loadConfig();
    } catch (e) {
      exitWithError(e.message, 2, useJson);
    }

    const vaultId = getOpt('vault') || 'default';
    const cliScopes = Array.isArray(config.flow?.visible_scopes) ? config.flow.visible_scopes : undefined;

    const flowExitWithError = (message, codeStr, exitCode = 1) => {
      if (useJson) {
        process.stderr.write(JSON.stringify({ error: message, code: codeStr }) + '\n');
      } else {
        console.error(message);
      }
      process.exit(exitCode);
    };

    if (flowAction === 'list') {
      const limitOpt = getOpt('limit', 'number');
      const { handleFlowListRequest } = await import('../lib/flow/flow-handlers.mjs');
      const result = handleFlowListRequest({
        dataDir: config.data_dir,
        vaultId,
        cliScopes,
        scope: getOpt('scope') ?? undefined,
        tag: getOpt('tag') ?? undefined,
        limit: limitOpt ?? undefined,
      });
      if (!result.ok) {
        flowExitWithError(result.error, result.code);
      }
      if (useJson) {
        console.log(JSON.stringify(result.payload));
      } else {
        const rows = result.payload.flows;
        if (rows.length === 0) {
          console.log('(no flows)');
        } else {
          for (const f of rows) {
            console.log(`${f.flow_id}  ${f.version}  [${f.scope}]  ${f.title}  (${f.step_count} steps)`);
          }
        }
        if (result.payload.truncated) {
          console.log('(truncated)');
        }
      }
      process.exit(0);
    }

    if (flowAction === 'get') {
      const flowId = args.find((a, i) => i >= 2 && !a.startsWith('--'));
      if (!flowId) {
        flowExitWithError('knowtation flow get: provide a flow_id.', 'BAD_REQUEST');
      }
      const { handleFlowGetRequest } = await import('../lib/flow/flow-handlers.mjs');
      const result = handleFlowGetRequest({
        dataDir: config.data_dir,
        vaultId,
        flowId,
        cliScopes,
        version: getOpt('version') ?? undefined,
      });
      if (!result.ok) {
        flowExitWithError(result.error, result.code);
      }
      if (useJson) {
        console.log(JSON.stringify(result.payload));
      } else {
        const { flow, steps } = result.payload;
        console.log(`${flow.flow_id}  ${flow.version}  [${flow.scope}]`);
        console.log(flow.title);
        console.log(flow.summary);
        console.log(`Steps (${steps.length}):`);
        for (const s of steps) {
          console.log(`  ${s.ordinal}. ${s.owned_job}`);
        }
      }
      process.exit(0);
    }

    if (flowAction === 'project') {
      const flowId = args.find((a, i) => i >= 2 && !a.startsWith('--'));
      const harness = getOpt('harness');
      if (!flowId) {
        flowExitWithError('knowtation flow project: provide a flow_id.', 'BAD_REQUEST');
      }
      if (!harness) {
        flowExitWithError('knowtation flow project: --harness is required.', 'BAD_REQUEST');
      }
      const checkMode = hasOpt('check');
      const outPath = getOpt('out') ?? undefined;
      const { handleFlowProjectRequest } = await import('../lib/flow/flow-handlers.mjs');
      const { detectDrift, defaultProjectionOutPath } = await import('../lib/flow/projection-generator.mjs');
      const result = handleFlowProjectRequest({
        dataDir: config.data_dir,
        vaultId,
        flowId,
        harness,
        cliScopes,
        version: getOpt('version') ?? undefined,
      });
      if (!result.ok) {
        flowExitWithError(result.error, result.code, result.status === 403 ? 1 : 1);
      }

      const artifactPath = outPath || defaultProjectionOutPath(flowId, harness);
      if (checkMode) {
        if (!artifactPath) {
          flowExitWithError('knowtation flow project --check: provide --out or use an active harness.', 'BAD_REQUEST');
        }
        const fs = await import('node:fs');
        let onDisk = '';
        try {
          onDisk = fs.readFileSync(artifactPath, 'utf8');
        } catch {
          onDisk = '';
        }
        const drift = detectDrift(onDisk, result.payload.projection.rendered);
        const stale = result.payload.staleness.stale === true;
        if (useJson) {
          console.log(
            JSON.stringify({
              check: true,
              drift,
              stale,
              staleness: result.payload.staleness,
              generator: result.payload.generator,
            }),
          );
        } else {
          console.log(`drift: ${drift.drift} (${drift.reason})`);
          console.log(`stale: ${stale}`);
          if (stale) {
            console.log(
              `versions: projection ${result.payload.staleness.projection_version} < latest ${result.payload.staleness.latest_version}`,
            );
          }
        }
        if (drift.drift || stale) {
          process.exit(1);
        }
        process.exit(0);
      }

      if (outPath && artifactPath) {
        const fs = await import('node:fs');
        const pathMod = await import('node:path');
        const dir = pathMod.dirname(artifactPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(artifactPath, result.payload.projection.rendered, 'utf8');
      }

      if (useJson) {
        console.log(JSON.stringify(result.payload));
      } else {
        console.log(result.payload.projection.rendered);
        const { staleness, projection } = result.payload;
        console.error('');
        console.error(`staleness: ${staleness.stale ? 'stale' : 'fresh'} (${staleness.projection_version} vs latest ${staleness.latest_version})`);
        if (projection.fidelity?.dropped_fields?.length) {
          console.error(`dropped fields: ${projection.fidelity.dropped_fields.join(', ')}`);
        }
        if (projection.fidelity?.notes) {
          console.error(`fidelity: ${projection.fidelity.notes}`);
        }
        if (outPath) {
          console.error(`wrote: ${artifactPath}`);
        }
      }
      process.exit(0);
    }

    if (flowAction === 'propose' || flowAction === 'import') {
      const bundlePath = args.find((a, i) => i >= 2 && !a.startsWith('--'));
      if (!bundlePath) {
        flowExitWithError(`knowtation flow ${flowAction}: provide a bundle.json path.`, 'BAD_REQUEST');
      }
      const fsMod = await import('node:fs');
      let bundle;
      try {
        bundle = JSON.parse(fsMod.readFileSync(bundlePath, 'utf8'));
      } catch (e) {
        flowExitWithError(`knowtation flow ${flowAction}: cannot read bundle (${e.message}).`, 'BAD_REQUEST');
      }
      const intent = getOpt('intent') || (bundle && typeof bundle === 'object' ? bundle.intent : undefined);
      const { handleFlowProposeRequest } = await import('../lib/flow/flow-authoring.mjs');
      const { createProposal } = await import('../hub/proposals-store.mjs');

      let result;
      if (flowAction === 'import') {
        result = handleFlowProposeRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          kind: 'import',
          bundle: { flow: bundle?.flow, steps: bundle?.steps },
          intent,
          externalRef: getOpt('external-ref') || (bundle && bundle.external_ref) || undefined,
          sourceVaultHint: getOpt('source-vault-hint') || (bundle && bundle.source_vault_hint) || undefined,
          createProposal,
        });
      } else {
        const baseVersion = getOpt('base-version') || (bundle && bundle.base_version) || undefined;
        const baseStateId = getOpt('base-state-id') || (bundle && bundle.base_state_id) || undefined;
        result = handleFlowProposeRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          kind: baseVersion ? 'edit' : 'new',
          flow: bundle?.flow,
          steps: bundle?.steps,
          intent,
          flowId: bundle?.flow?.flow_id,
          baseVersion,
          baseStateId,
          createProposal,
        });
      }

      if (!result.ok) {
        flowExitWithError(result.error, result.code);
      }
      if (useJson) {
        console.log(JSON.stringify(result.payload));
      } else {
        const p = result.payload;
        console.log(`proposed ${p.flow_id} → ${p.proposal_id} [${p.scope}] (status: ${p.status})`);
        console.log(`review queue: ${p.review_queue}  auto_approvable: ${p.auto_approvable}`);
      }
      process.exit(0);
    }

    if (flowAction === 'run') {
      const runSub = args[2];
      if (!runSub || hasOpt('help') || hasOpt('h')) {
        console.log('knowtation flow run start|get|list|advance|evidence|execute|consent|submit-review — see knowtation flow --help');
        process.exit(0);
      }

      const {
        handleFlowRunStartRequest,
        handleFlowRunGetRequest,
        handleFlowRunListRequest,
        handleFlowRunAdvanceRequest,
        handleFlowRunEvidenceRequest,
        handleFlowRunExecuteAutomatableRequest,
        handleFlowRunSubmitReviewRequest,
        handleFlowExecutionConsentMintRequest,
      } = await import('../lib/flow/flow-execution.mjs');
      const { createProposal } = await import('../hub/proposals-store.mjs');

      if (runSub === 'start') {
        const flowId = args.find((a, i) => i >= 3 && !a.startsWith('--'));
        const flowVersion = getOpt('flow-version');
        if (!flowId || !flowVersion) {
          flowExitWithError('knowtation flow run start: provide flow_id and --flow-version.', 'BAD_REQUEST');
        }
        const result = handleFlowRunStartRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          flowId,
          flowVersion,
          taskRef: getOpt('task-ref') ?? undefined,
          externalRef: getOpt('external-ref') ?? undefined,
          harness: 'cli',
        });
        if (!result.ok) {
          flowExitWithError(result.error, result.code);
        }
        if (useJson) {
          console.log(JSON.stringify(result.payload));
        } else {
          console.log(`started run ${result.payload.run.run_id} for ${flowId}@${flowVersion}`);
        }
        process.exit(0);
      }

      if (runSub === 'get') {
        const runId = args.find((a, i) => i >= 3 && !a.startsWith('--'));
        if (!runId) {
          flowExitWithError('knowtation flow run get: provide run_id.', 'BAD_REQUEST');
        }
        const result = handleFlowRunGetRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          runId,
        });
        if (!result.ok) {
          flowExitWithError(result.error, result.code);
        }
        if (useJson) {
          console.log(JSON.stringify(result.payload));
        } else {
          console.log(JSON.stringify(result.payload.run, null, 2));
        }
        process.exit(0);
      }

      if (runSub === 'list') {
        const result = handleFlowRunListRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          flowId: getOpt('flow-id') ?? undefined,
        });
        if (!result.ok) {
          flowExitWithError(result.error, result.code);
        }
        if (useJson) {
          console.log(JSON.stringify(result.payload));
        } else {
          for (const run of result.payload.runs) {
            console.log(`${run.run_id}  ${run.flow_id}@${run.flow_version}  [${run.status}]`);
          }
        }
        process.exit(0);
      }

      if (runSub === 'advance') {
        const runId = args.find((a, i) => i >= 3 && !a.startsWith('--'));
        const stepId = getOpt('step-id');
        const toStatus = getOpt('to-status');
        if (!runId || !stepId || !toStatus) {
          flowExitWithError(
            'knowtation flow run advance: provide run_id, --step-id, and --to-status.',
            'BAD_REQUEST',
          );
        }
        const result = handleFlowRunAdvanceRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          runId,
          stepId,
          toStatus,
          skipReason: getOpt('skip-reason') ?? undefined,
        });
        if (!result.ok) {
          flowExitWithError(result.error, result.code);
        }
        if (useJson) {
          console.log(JSON.stringify(result.payload));
        } else {
          console.log(`advanced ${stepId} → ${toStatus}`);
        }
        process.exit(0);
      }

      if (runSub === 'evidence') {
        const runId = args.find((a, i) => i >= 3 && !a.startsWith('--'));
        const stepId = getOpt('step-id');
        const evidenceRef = getOpt('evidence-ref');
        const pointerKind = getOpt('pointer-kind');
        if (!runId || !stepId || !evidenceRef || !pointerKind) {
          flowExitWithError(
            'knowtation flow run evidence: provide run_id, --step-id, --evidence-ref, --pointer-kind.',
            'BAD_REQUEST',
          );
        }
        const result = handleFlowRunEvidenceRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          runId,
          stepId,
          evidenceRef,
          pointerKind,
        });
        if (!result.ok) {
          flowExitWithError(result.error, result.code);
        }
        if (useJson) {
          console.log(JSON.stringify(result.payload));
        } else {
          console.log(`evidence recorded on ${stepId}`);
        }
        process.exit(0);
      }

      if (runSub === 'execute') {
        const runId = args.find((a, i) => i >= 3 && !a.startsWith('--'));
        const stepId = getOpt('step-id');
        const consentId = getOpt('consent-id');
        if (!runId || !stepId || !consentId) {
          flowExitWithError(
            'knowtation flow run execute: provide run_id, --step-id, and --consent-id.',
            'BAD_REQUEST',
          );
        }
        const result = handleFlowRunExecuteAutomatableRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          runId,
          stepId,
          consentId,
          modelLane: getOpt('model-lane') ?? undefined,
          dryRun: hasOpt('dry-run'),
        });
        if (!result.ok) {
          flowExitWithError(result.error, result.code);
        }
        if (useJson) {
          console.log(JSON.stringify(result.payload));
        } else {
          console.log(`execution ${result.payload.execution.execution_id} → ${result.payload.execution.status}`);
        }
        process.exit(0);
      }

      if (runSub === 'consent') {
        const runId = args.find((a, i) => i >= 3 && !a.startsWith('--'));
        const lanesRaw = getOpt('lanes');
        const costCap = getOpt('cost-cap', 'number');
        if (!runId || !lanesRaw || costCap === undefined) {
          flowExitWithError(
            'knowtation flow run consent: provide run_id, --lanes, and --cost-cap.',
            'BAD_REQUEST',
          );
        }
        const allowedLanes = lanesRaw.split(',').map((l) => l.trim()).filter(Boolean);
        const ttlRaw = getOpt('ttl-seconds', 'number');
        const result = handleFlowExecutionConsentMintRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          runId,
          allowedLanes,
          costCapUnits: costCap,
          ttlSeconds: ttlRaw ?? undefined,
        });
        if (!result.ok) {
          flowExitWithError(result.error, result.code);
        }
        if (useJson) {
          console.log(JSON.stringify(result.payload));
        } else {
          console.log(`consent ${result.payload.consent.consent_id} expires ${result.payload.consent.expires_at}`);
        }
        process.exit(0);
      }

      if (runSub === 'submit-review') {
        const runId = args.find((a, i) => i >= 3 && !a.startsWith('--'));
        const intent = getOpt('intent');
        if (!runId || !intent) {
          flowExitWithError('knowtation flow run submit-review: provide run_id and --intent.', 'BAD_REQUEST');
        }
        const result = handleFlowRunSubmitReviewRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          runId,
          intent,
          createProposal,
        });
        if (!result.ok) {
          flowExitWithError(result.error, result.code);
        }
        if (useJson) {
          console.log(JSON.stringify(result.payload));
        } else {
          console.log(`submitted ${runId} → proposal ${result.payload.proposal_id}`);
        }
        process.exit(0);
      }

      flowExitWithError(`knowtation flow run: unknown subcommand ${runSub}`, 'BAD_REQUEST');
    }

    if (flowAction === 'grant') {
      const grantAction = args[2];
      if (!grantAction || hasOpt('help') || hasOpt('h')) {
        console.log('knowtation flow grant mint|revoke|list — see knowtation flow --help');
        process.exit(0);
      }

      const {
        handleFlowExternalGrantMintRequest,
        handleFlowExternalGrantRevokeRequest,
        handleFlowExternalGrantListRequest,
      } = await import('../lib/flow/external-agent.mjs');

      if (grantAction === 'mint') {
        const flowId = args.find((a, i) => i >= 3 && !a.startsWith('--'));
        const flowVersion = getOpt('flow-version');
        const toolsRaw = getOpt('tools');
        if (!flowId || !flowVersion || !toolsRaw) {
          flowExitWithError(
            'knowtation flow grant mint: provide flow_id, --flow-version, and --tools.',
            'BAD_REQUEST',
          );
        }
        const requestedTools = toolsRaw.split(',').map((t) => t.trim()).filter(Boolean);
        const ttlRaw = getOpt('ttl-seconds', 'number');
        const result = handleFlowExternalGrantMintRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          flowId,
          flowVersion,
          requestedTools,
          ttlSeconds: ttlRaw ?? undefined,
          actorLabel: getOpt('actor-label') ?? undefined,
        });
        if (!result.ok) {
          flowExitWithError(result.error, result.code);
        }
        if (useJson) {
          console.log(JSON.stringify(result.payload));
        } else {
          console.log(`grant ${result.payload.grant.grant_id} expires ${result.payload.expires_at}`);
          console.log(`bearer (one-time): ${result.payload.bearer}`);
        }
        process.exit(0);
      }

      if (grantAction === 'revoke') {
        const grantId = args.find((a, i) => i >= 3 && !a.startsWith('--'));
        if (!grantId) {
          flowExitWithError('knowtation flow grant revoke: provide grant_id.', 'BAD_REQUEST');
        }
        const result = handleFlowExternalGrantRevokeRequest({
          dataDir: config.data_dir,
          vaultId,
          grantId,
        });
        if (!result.ok) {
          flowExitWithError(result.error, result.code);
        }
        if (useJson) {
          console.log(JSON.stringify(result.payload));
        } else {
          console.log(`revoked ${grantId} at ${result.payload.revoked_at}`);
        }
        process.exit(0);
      }

      if (grantAction === 'list') {
        const result = handleFlowExternalGrantListRequest({
          dataDir: config.data_dir,
          vaultId,
          flowId: getOpt('flow-id') ?? undefined,
        });
        if (!result.ok) {
          flowExitWithError(result.error, result.code);
        }
        if (useJson) {
          console.log(JSON.stringify(result.payload));
        } else {
          for (const g of result.payload.grants) {
            console.log(`${g.grant_id}  ${g.flow_id}@${g.flow_version}  tools=${g.allowed_tools.join(',')}`);
          }
        }
        process.exit(0);
      }

      flowExitWithError(`knowtation flow grant: unknown action "${grantAction}".`, 'BAD_REQUEST');
    }

    if (flowAction === 'capture') {
      const captureAction = args[2];
      if (!captureAction || hasOpt('help') || hasOpt('h')) {
        console.log('knowtation flow capture observe|list|propose|dismiss — see knowtation flow --help');
        process.exit(0);
      }

      const {
        handleFlowCaptureObserveRequest,
        handleFlowCaptureListRequest,
        handleFlowCaptureProposeRequest,
        handleFlowCaptureDismissRequest,
      } = await import('../lib/flow/flow-capture.mjs');
      const { createProposal } = await import('../hub/proposals-store.mjs');

      if (captureAction === 'observe') {
        const signalsPath = args[3];
        if (!signalsPath) {
          flowExitWithError('knowtation flow capture observe: provide a signals.json path.', 'BAD_REQUEST');
        }
        const fsMod = await import('node:fs');
        let sessionMeta;
        try {
          sessionMeta = JSON.parse(fsMod.readFileSync(signalsPath, 'utf8'));
        } catch (e) {
          flowExitWithError(`knowtation flow capture observe: cannot read signals (${e.message}).`, 'BAD_REQUEST');
        }
        const result = handleFlowCaptureObserveRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          sessionMeta,
          includeLowConfidence: hasOpt('include-low-confidence'),
          harness: 'cli',
          config,
        });
        if (!result.ok) flowExitWithError(result.error, result.code);
        if (useJson) console.log(JSON.stringify(result.payload));
        else console.log(JSON.stringify(result.payload, null, 2));
        process.exit(0);
      }

      if (captureAction === 'list') {
        const limitOpt = getOpt('limit', 'number');
        const result = handleFlowCaptureListRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          scope: getOpt('scope') ?? undefined,
          includeLowConfidence: hasOpt('include-low-confidence'),
          limit: limitOpt ?? undefined,
          config,
        });
        if (!result.ok) flowExitWithError(result.error, result.code);
        if (useJson) console.log(JSON.stringify(result.payload));
        else console.log(JSON.stringify(result.payload, null, 2));
        process.exit(0);
      }

      if (captureAction === 'propose') {
        const candidateId = args[3];
        const intent = getOpt('intent');
        const confirmedScope = getOpt('confirmed-scope');
        if (!candidateId || !intent || !confirmedScope) {
          flowExitWithError(
            'knowtation flow capture propose: provide candidate_id, --intent, and --confirmed-scope.',
            'BAD_REQUEST',
          );
        }
        const result = handleFlowCaptureProposeRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          candidateId,
          confirmedScope,
          scopeWidenAcknowledged: hasOpt('scope-widen-acknowledged'),
          allowLowConfidence: hasOpt('allow-low-confidence'),
          forceNewFlow: hasOpt('force-new-flow'),
          mergeIntoFlowId: getOpt('merge-into-flow-id') ?? undefined,
          intent,
          createProposal,
          config,
        });
        if (!result.ok) flowExitWithError(result.error, result.code);
        if (useJson) console.log(JSON.stringify(result.payload));
        else console.log(JSON.stringify(result.payload, null, 2));
        process.exit(0);
      }

      if (captureAction === 'dismiss') {
        const candidateId = args[3];
        const intent = getOpt('intent');
        if (!candidateId || !intent) {
          flowExitWithError('knowtation flow capture dismiss: provide candidate_id and --intent.', 'BAD_REQUEST');
        }
        const result = handleFlowCaptureDismissRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          candidateId,
          intent,
          createProposal,
        });
        if (!result.ok) flowExitWithError(result.error, result.code);
        if (useJson) console.log(JSON.stringify(result.payload));
        else console.log(JSON.stringify(result.payload, null, 2));
        process.exit(0);
      }

      flowExitWithError(`knowtation flow capture: unknown action "${captureAction}".`, 'BAD_REQUEST');
    }

    exitWithError(`knowtation flow: unknown action "${flowAction}". Use list, get, project, propose, import, grant, capture, or run.`, 1, useJson);
    return;
  }

  if (subcommand === 'task') {
    const taskAction = args[1];
    if (hasOpt('help') || hasOpt('h') || !taskAction) {
      console.log(`knowtation task <action>
  Actions:
    list     [--scope personal|project|org] [--workspace-id <id>] [--status <s>] [--kind <k>] [--limit <n>] [--json]
    get      <task_id> [--json]
    propose  <payload.json> [--intent <text>] [--json]

  Options: --json (exact Hub JSON)`);
      process.exit(0);
    }

    let config;
    try {
      config = loadConfig();
    } catch (e) {
      exitWithError(e.message, 2, useJson);
    }

    const vaultId = getOpt('vault') || 'default';
    const cliScopes = Array.isArray(config.flow?.visible_scopes) ? config.flow.visible_scopes : undefined;

    const taskExitWithError = (message, codeStr, exitCode = 1) => {
      if (useJson) {
        process.stderr.write(JSON.stringify({ error: message, code: codeStr }) + '\n');
      } else {
        console.error(message);
      }
      process.exit(exitCode);
    };

    if (taskAction === 'list') {
      const limitOpt = getOpt('limit', 'number');
      const { handleTaskListRequest } = await import('../lib/task/task-handlers.mjs');
      const result = handleTaskListRequest({
        dataDir: config.data_dir,
        vaultId,
        cliScopes,
        scope: getOpt('scope') ?? undefined,
        workspaceId: getOpt('workspace-id') ?? undefined,
        status: getOpt('status') ?? undefined,
        kind: getOpt('kind') ?? undefined,
        limit: limitOpt ?? undefined,
      });
      if (!result.ok) {
        taskExitWithError(result.error, result.code);
      }
      if (useJson) {
        console.log(JSON.stringify(result.payload));
      } else {
        const rows = result.payload.tasks;
        if (rows.length === 0) {
          console.log('(no tasks)');
        } else {
          for (const t of rows) {
            console.log(`${t.task_id}  [${t.scope}]  ${t.status}  ${t.title}`);
          }
        }
        if (result.payload.truncated) {
          console.log('(truncated)');
        }
      }
      process.exit(0);
    }

    if (taskAction === 'get') {
      const taskId = args.find((a, i) => i >= 2 && !a.startsWith('--'));
      if (!taskId) {
        taskExitWithError('knowtation task get: provide a task_id.', 'BAD_REQUEST');
      }
      const { handleTaskGetRequest } = await import('../lib/task/task-handlers.mjs');
      const result = handleTaskGetRequest({
        dataDir: config.data_dir,
        vaultId,
        taskId,
        cliScopes,
      });
      if (!result.ok) {
        taskExitWithError(result.error, result.code);
      }
      if (useJson) {
        console.log(JSON.stringify(result.payload));
      } else {
        const { task } = result.payload;
        console.log(`${task.task_id}  [${task.scope}]  ${task.status}`);
        console.log(task.title);
        console.log(`workspace: ${task.workspace_id}  due: ${task.due_at ?? '—'}`);
        if (task.run_ref) console.log(`run_ref: ${task.run_ref}`);
        if (task.artifact_links.length) {
          console.log(`artifact_links (${task.artifact_links.length}):`);
          for (const link of task.artifact_links) {
            console.log(`  ${link.kind}: ${link.ref}`);
          }
        }
      }
      process.exit(0);
    }

    if (taskAction === 'propose') {
      const payloadPath = args.find((a, i) => i >= 2 && !a.startsWith('--'));
      if (!payloadPath) {
        taskExitWithError('knowtation task propose: provide a payload.json path.', 'BAD_REQUEST');
      }
      const fsMod = await import('node:fs');
      let payload;
      try {
        payload = JSON.parse(fsMod.readFileSync(payloadPath, 'utf8'));
      } catch (e) {
        taskExitWithError(`knowtation task propose: cannot read payload (${e.message}).`, 'BAD_REQUEST');
      }
      const intent = getOpt('intent') || (payload && typeof payload === 'object' ? payload.intent : undefined);
      const proposalKind =
        payload && typeof payload.proposal_kind === 'string' ? payload.proposal_kind : 'task_create';
      const { handleTaskProposeRequest } = await import('../lib/task/task-write.mjs');
      const { createProposal } = await import('../hub/proposals-store.mjs');
      const result = handleTaskProposeRequest({
        dataDir: config.data_dir,
        vaultId,
        cliScopes,
        proposalKind,
        body: payload,
        intent,
        createProposal,
      });
      if (!result.ok) {
        taskExitWithError(result.error, result.code);
      }
      if (useJson) {
        console.log(JSON.stringify(result.payload));
      } else {
        console.log(
          `proposed ${result.payload.proposal_kind} → ${result.payload.proposal_id} task=${result.payload.task_id ?? '—'}`,
        );
      }
      process.exit(0);
    }

    exitWithError(`knowtation task: unknown action "${taskAction}". Use list, get, or propose.`, 1, useJson);
    return;
  }

  if (subcommand === 'task-loop') {
    const loopAction = args[1];
    if (hasOpt('help') || hasOpt('h') || !loopAction) {
      console.log(`knowtation task-loop <action>
  Actions:
    propose      <payload.json> [--intent <text>] [--json]
    materialize  --loop-id <loop_id> [--occurrence-key <key>] [--occurrence-at <iso>] [--due-at <iso>] [--intent <text>] [--json]

  Options: --json (exact Hub JSON)`);
      process.exit(0);
    }

    let config;
    try {
      config = loadConfig();
    } catch (e) {
      exitWithError(e.message, 2, useJson);
    }

    const vaultId = getOpt('vault') || 'default';
    const cliScopes = Array.isArray(config.flow?.visible_scopes) ? config.flow.visible_scopes : undefined;

    const loopExitWithError = (message, codeStr, exitCode = 1) => {
      if (useJson) {
        process.stderr.write(JSON.stringify({ error: message, code: codeStr }) + '\n');
      } else {
        console.error(message);
      }
      process.exit(exitCode);
    };

    if (loopAction === 'propose') {
      const payloadPath = args.find((a, i) => i >= 2 && !a.startsWith('--'));
      if (!payloadPath) {
        loopExitWithError('knowtation task-loop propose: provide a payload.json path.', 'BAD_REQUEST');
      }
      const fsMod = await import('node:fs');
      let payload;
      try {
        payload = JSON.parse(fsMod.readFileSync(payloadPath, 'utf8'));
      } catch (e) {
        loopExitWithError(`knowtation task-loop propose: cannot read payload (${e.message}).`, 'BAD_REQUEST');
      }
      const intent = getOpt('intent') || (payload && typeof payload === 'object' ? payload.intent : undefined);
      const proposalKind =
        payload && typeof payload.proposal_kind === 'string' ? payload.proposal_kind : 'task_loop_create';
      const { handleTaskLoopProposeRequest } = await import('../lib/task/task-write.mjs');
      const { createProposal } = await import('../hub/proposals-store.mjs');
      const result = handleTaskLoopProposeRequest({
        dataDir: config.data_dir,
        vaultId,
        cliScopes,
        proposalKind,
        body: payload,
        intent,
        createProposal,
      });
      if (!result.ok) {
        loopExitWithError(result.error, result.code);
      }
      if (useJson) {
        console.log(JSON.stringify(result.payload));
      } else {
        console.log(
          `proposed ${result.payload.proposal_kind} → ${result.payload.proposal_id} loop=${result.payload.loop_id ?? '—'}`,
        );
      }
      process.exit(0);
    }

    if (loopAction === 'materialize') {
      const loopId = getOpt('loop-id');
      if (!loopId) {
        loopExitWithError('knowtation task-loop materialize: --loop-id required.', 'BAD_REQUEST');
      }
      const intent = getOpt('intent') || 'materialize occurrence';
      const { handleTaskInstanceMaterializeRequest } = await import('../lib/task/task-write.mjs');
      const { createProposal } = await import('../hub/proposals-store.mjs');
      const result = handleTaskInstanceMaterializeRequest({
        dataDir: config.data_dir,
        vaultId,
        cliScopes,
        loopId,
        body: {
          loop_id: loopId,
          occurrence_key: getOpt('occurrence-key') ?? undefined,
          occurrence_at: getOpt('occurrence-at') ?? undefined,
          due_at: getOpt('due-at') ?? undefined,
          title_override: getOpt('title-override') ?? undefined,
          base_state_id: getOpt('base-state-id') ?? undefined,
        },
        intent,
        createProposal,
      });
      if (!result.ok) {
        loopExitWithError(result.error, result.code);
      }
      if (useJson) {
        console.log(JSON.stringify(result.payload));
      } else {
        console.log(
          `materialize proposal ${result.payload.proposal_id} task=${result.payload.task_id} occurrence=${result.payload.occurrence_key}`,
        );
      }
      process.exit(0);
    }

    exitWithError(`knowtation task-loop: unknown action "${loopAction}". Use propose or materialize.`, 1, useJson);

  if (subcommand === 'agent') {
    const agentAction = args[1];
    if (!agentAction || hasOpt('help') || hasOpt('h')) {
      console.log(`knowtation agent identity register|list — gated by DELEGATION_ENABLED (default off)
  register --kind user_owned|org_owned|delegate [--agent-id <id>] [--label <text>] [--scope-ceiling personal|project|org]
  list [--kind <kind>] [--status active|suspended|revoked]`);
      process.exit(0);
    }

    let config;
    try {
      config = loadConfig();
    } catch (e) {
      exitWithError(e.message, 2, useJson);
    }
    const vaultId = config.default_vault_id || 'default';
    const {
      handleAgentIdentityRegisterProposeRequest,
      handleAgentIdentityListRequest,
    } = await import('../lib/agent/delegation.mjs');
    const { createProposal } = await import('../hub/proposals-store.mjs');

    if (agentAction === 'identity') {
      const idAction = args[2];
      if (idAction === 'register') {
        const kind = getOpt('kind');
        if (!kind) {
          exitWithError('knowtation agent identity register: --kind required.', 'BAD_REQUEST', useJson);
        }
        const result = await handleAgentIdentityRegisterProposeRequest({
          dataDir: config.data_dir,
          vaultId,
          userId: config.user_id ?? 'cli-user',
          kind,
          agentId: getOpt('agent-id') ?? undefined,
          label: getOpt('label') ?? undefined,
          scopeCeiling: getOpt('scope-ceiling') ?? undefined,
          createProposal,
        });
        if (!result.ok) exitWithError(result.error, result.code, useJson);
        if (useJson) console.log(JSON.stringify(result.payload));
        else console.log(`proposed agent ${result.payload.agent_id} → proposal ${result.payload.proposal_id}`);
        process.exit(0);
      }
      if (idAction === 'list') {
        const result = handleAgentIdentityListRequest({
          dataDir: config.data_dir,
          vaultId,
          kind: getOpt('kind') ?? undefined,
          status: getOpt('status') ?? undefined,
        });
        if (!result.ok) exitWithError(result.error, result.code, useJson);
        if (useJson) console.log(JSON.stringify(result.payload));
        else {
          for (const i of result.payload.identities) {
            console.log(`${i.agent_id}  ${i.kind}  ${i.status}`);
          }
        }
        process.exit(0);
      }
      exitWithError(`knowtation agent identity: unknown action "${idAction}".`, 'BAD_REQUEST', useJson);
    }
    exitWithError(`knowtation agent: unknown action "${agentAction}".`, 'BAD_REQUEST', useJson);
  }

  if (subcommand === 'delegation') {
    const delAction = args[1];
    if (!delAction || hasOpt('help') || hasOpt('h')) {
      console.log(`knowtation delegation consent propose|revoke — grant mint|revoke|list — audit append
  consent propose --delegate-agent-id <id> --scope personal|project|org [--workspace-id <ws>] [--allowed-task-ids a,b]
  consent revoke <consent_id>
  grant mint --consent-id <id> --actor-agent-id <id> [--task-ref <id>] [--flow-id <id>] [--flow-version <semver>]
  grant revoke <grant_id>
  grant list [--actor-agent-id <id>]
  audit append --grant-id <id> --actor-agent-id <id> --action advance_step|... --evidence-refs a,b`);
      process.exit(0);
    }

    let config;
    try {
      config = loadConfig();
    } catch (e) {
      exitWithError(e.message, 2, useJson);
    }
    const vaultId = config.default_vault_id || 'default';
    const {
      handleDelegationConsentProposeRequest,
      handleDelegationConsentRevokeRequest,
      handleDelegationGrantMintRequest,
      handleDelegationGrantRevokeRequest,
      handleDelegationGrantListRequest,
      handleDelegationAuditAppendRequest,
      hashPrincipalRef,
    } = await import('../lib/agent/delegation.mjs');
    const { createProposal } = await import('../hub/proposals-store.mjs');

    if (delAction === 'consent') {
      const consentAction = args[2];
      if (consentAction === 'propose') {
        const delegateAgentId = getOpt('delegate-agent-id');
        const scope = getOpt('scope');
        if (!delegateAgentId || !scope) {
          exitWithError(
            'knowtation delegation consent propose: --delegate-agent-id and --scope required.',
            'BAD_REQUEST',
            useJson,
          );
        }
        const taskIdsRaw = getOpt('allowed-task-ids');
        const flowIdsRaw = getOpt('allowed-flow-ids');
        const result = await handleDelegationConsentProposeRequest({
          dataDir: config.data_dir,
          vaultId,
          userId: config.user_id ?? 'cli-user',
          delegateAgentId,
          scope,
          workspaceId: getOpt('workspace-id') ?? undefined,
          allowedFlowIds: flowIdsRaw ? flowIdsRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
          allowedTaskIds: taskIdsRaw ? taskIdsRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
          expiresAt: getOpt('expires-at') ?? undefined,
          createProposal,
        });
        if (!result.ok) exitWithError(result.error, result.code, useJson);
        if (useJson) console.log(JSON.stringify(result.payload));
        else console.log(`proposed consent ${result.payload.consent_id} → proposal ${result.payload.proposal_id}`);
        process.exit(0);
      }
      if (consentAction === 'revoke') {
        const consentId = args.find((a, i) => i >= 3 && !a.startsWith('--'));
        if (!consentId) {
          exitWithError('knowtation delegation consent revoke: provide consent_id.', 'BAD_REQUEST', useJson);
        }
        const result = handleDelegationConsentRevokeRequest({
          dataDir: config.data_dir,
          vaultId,
          consentId,
          userId: config.user_id ?? 'cli-user',
        });
        if (!result.ok) exitWithError(result.error, result.code, useJson);
        if (useJson) console.log(JSON.stringify(result.payload));
        else console.log(`revoked ${consentId} at ${result.payload.revoked_at}`);
        process.exit(0);
      }
      exitWithError(`knowtation delegation consent: unknown action "${consentAction}".`, 'BAD_REQUEST', useJson);
    }

    if (delAction === 'grant') {
      const grantAction = args[2];
      if (grantAction === 'mint') {
        const consentId = getOpt('consent-id');
        const actorAgentId = getOpt('actor-agent-id');
        if (!consentId || !actorAgentId) {
          exitWithError(
            'knowtation delegation grant mint: --consent-id and --actor-agent-id required.',
            'BAD_REQUEST',
            useJson,
          );
        }
        const ttlRaw = getOpt('ttl-seconds', 'number');
        const result = handleDelegationGrantMintRequest({
          dataDir: config.data_dir,
          vaultId,
          consentId,
          actorAgentId,
          taskRef: getOpt('task-ref') ?? undefined,
          runRef: getOpt('run-ref') ?? undefined,
          flowId: getOpt('flow-id') ?? undefined,
          flowVersion: getOpt('flow-version') ?? undefined,
          ttlSeconds: ttlRaw ?? undefined,
        });
        if (!result.ok) exitWithError(result.error, result.code, useJson);
        if (useJson) console.log(JSON.stringify(result.payload));
        else {
          console.log(`grant ${result.payload.grant.grant_id} expires ${result.payload.expires_at}`);
          console.log(`bearer (one-time): ${result.payload.bearer}`);
        }
        process.exit(0);
      }
      if (grantAction === 'revoke') {
        const grantId = args.find((a, i) => i >= 3 && !a.startsWith('--'));
        if (!grantId) {
          exitWithError('knowtation delegation grant revoke: provide grant_id.', 'BAD_REQUEST', useJson);
        }
        const result = handleDelegationGrantRevokeRequest({
          dataDir: config.data_dir,
          vaultId,
          grantId,
        });
        if (!result.ok) exitWithError(result.error, result.code, useJson);
        if (useJson) console.log(JSON.stringify(result.payload));
        else console.log(`revoked ${grantId} at ${result.payload.revoked_at}`);
        process.exit(0);
      }
      if (grantAction === 'list') {
        const result = handleDelegationGrantListRequest({
          dataDir: config.data_dir,
          vaultId,
          actorAgentId: getOpt('actor-agent-id') ?? undefined,
        });
        if (!result.ok) exitWithError(result.error, result.code, useJson);
        if (useJson) console.log(JSON.stringify(result.payload));
        else {
          for (const g of result.payload.grants) {
            console.log(`${g.grant_id}  actor=${g.actor_agent_id}  scope=${g.scope}`);
          }
        }
        process.exit(0);
      }
      exitWithError(`knowtation delegation grant: unknown action "${grantAction}".`, 'BAD_REQUEST', useJson);
    }

    if (delAction === 'audit') {
      const auditAction = args[2];
      if (auditAction === 'append') {
        const grantId = getOpt('grant-id');
        const actorAgentId = getOpt('actor-agent-id');
        const action = getOpt('action');
        const evidenceRaw = getOpt('evidence-refs');
        if (!grantId || !actorAgentId || !action || !evidenceRaw) {
          exitWithError(
            'knowtation delegation audit append: --grant-id, --actor-agent-id, --action, --evidence-refs required.',
            'BAD_REQUEST',
            useJson,
          );
        }
        const principalRef = hashPrincipalRef(config.user_id ?? 'cli-user');
        const result = handleDelegationAuditAppendRequest({
          dataDir: config.data_dir,
          vaultId,
          grantId,
          actorAgentId,
          principalRef,
          action,
          evidenceRefs: evidenceRaw.split(',').map((s) => s.trim()).filter(Boolean),
          taskRef: getOpt('task-ref') ?? undefined,
          runRef: getOpt('run-ref') ?? undefined,
          flowId: getOpt('flow-id') ?? undefined,
          flowVersion: getOpt('flow-version') ?? undefined,
          stepId: getOpt('step-id') ?? undefined,
          executionLocation: getOpt('execution-location') ?? undefined,
        });
        if (!result.ok) exitWithError(result.error, result.code, useJson);
        if (useJson) console.log(JSON.stringify(result.payload));
        else console.log(`audit ${result.payload.audit_id} action=${result.payload.action}`);
        process.exit(0);
      }
      exitWithError(`knowtation delegation audit: unknown action "${auditAction}".`, 'BAD_REQUEST', useJson);
    }

    exitWithError(`knowtation delegation: unknown action "${delAction}".`, 'BAD_REQUEST', useJson);
  }

  if (subcommand === 'daemon') {
    const daemonAction = args[1];

    if (!daemonAction || hasOpt('help') || hasOpt('h')) {
      console.log(`knowtation daemon <action>
  Actions:
    start [--background]   Start the daemon. --background runs it detached (writes PID).
    stop                   Stop a running daemon (SIGTERM → SIGKILL after 10 s).
    status                 Show running state, PID, last pass, next scheduled pass.
    log [--tail <n>]       Print daemon log entries (JSONL). --tail limits to last N.

  Notes:
    - Daemon requires daemon.enabled in config and a reachable LLM.
    - Foreground mode: Ctrl+C to stop (SIGINT).
    - Background mode writes PID to {data_dir}/daemon.pid, log to {data_dir}/daemon.log.`);
      process.exit(0);
    }

    let config;
    try {
      config = loadConfig();
    } catch (e) {
      exitWithError(e.message, 2, useJson);
    }

    // ── daemon start ───────────────────────────────────────────────────────
    if (daemonAction === 'start') {
      const background = hasOpt('background');

      if (background) {
        // Spawn a detached child that runs `knowtation daemon start` (foreground).
        // Use env var to prevent the child from re-entering background-spawn logic.
        const child = spawn(process.execPath, [__filename, 'daemon', 'start'], {
          detached: true,
          stdio: 'ignore',
          env: { ...process.env, KNOWTATION_DAEMON_BACKGROUND: '0' },
        });
        child.unref();

        const pidPath = path.join(config.data_dir, 'daemon.pid');
        const logPath = config.daemon?.log_file || path.join(config.data_dir, 'daemon.log');

        if (useJson) {
          console.log(JSON.stringify({ ok: true, pid: child.pid, pid_path: pidPath, log_path: logPath }));
        } else {
          const llmProvider = config.daemon?.llm?.provider || 'auto-detect';
          const llmModel = config.daemon?.llm?.model || 'default';
          console.log(`Daemon started in background (PID ${child.pid}). Consolidation every ${config.daemon?.interval_minutes ?? 120} min when idle.`);
          console.log(`LLM: ${llmProvider} ${llmModel}.`);
          console.log(`Log: ${logPath}`);
        }
        process.exit(0);
        return;
      }

      // Foreground mode
      if (!config.daemon?.enabled && process.env.KNOWTATION_DAEMON_BACKGROUND !== '0') {
        console.warn('Warning: daemon.enabled is false in config. Starting anyway (foreground mode).');
      }

      (async () => {
        try {
          const { startDaemon } = await import('../lib/daemon.mjs');
          const logPath = config.daemon?.log_file || path.join(config.data_dir, 'daemon.log');
          const intervalMin = config.daemon?.interval_minutes ?? 120;
          console.log(`Daemon starting (PID ${process.pid}). Consolidation every ${intervalMin} min when idle.`);
          console.log(`Log: ${logPath}. Press Ctrl+C to stop.`);
          await startDaemon(config);
          console.log('Daemon stopped.');
          process.exit(0);
        } catch (e) {
          exitWithError(`Daemon start failed: ${e.message}`, 2, useJson);
        }
      })();
      return;
    }

    // ── daemon stop ────────────────────────────────────────────────────────
    if (daemonAction === 'stop') {
      (async () => {
        try {
          const { stopDaemon } = await import('../lib/daemon.mjs');
          const result = await stopDaemon(config);
          if (useJson) {
            console.log(JSON.stringify(result));
          } else if (result.stopped) {
            console.log(`Daemon stopped (PID ${result.pid}, signal ${result.signal}).`);
          } else {
            console.log(`Daemon was not running: ${result.reason}`);
          }
          process.exit(0);
        } catch (e) {
          exitWithError(`Daemon stop failed: ${e.message}`, 2, useJson);
        }
      })();
      return;
    }

    // ── daemon status ──────────────────────────────────────────────────────
    if (daemonAction === 'status') {
      try {
        const { getDaemonStatus } = await import('../lib/daemon.mjs');
        const status = getDaemonStatus(config);
        if (useJson) {
          console.log(JSON.stringify(status));
        } else if (!status.running) {
          console.log('Status: not running');
          if (status.last_pass) {
            console.log(`Last pass: ${status.last_pass.ts} (${status.last_pass.events_processed} events, ${status.last_pass.topics} topics)`);
          }
          console.log(`Log: ${status.log_path}`);
        } else {
          const uptimeSec = Math.round((status.uptime_ms ?? 0) / 1000);
          const uptimeStr = uptimeSec < 60
            ? `${uptimeSec}s`
            : uptimeSec < 3600
              ? `${Math.round(uptimeSec / 60)}m ${uptimeSec % 60}s`
              : `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`;
          console.log(`Status: running (PID ${status.pid}, uptime ${uptimeStr})`);
          if (status.last_pass) {
            const lp = status.last_pass;
            console.log(`Last pass: ${lp.ts} (processed ${lp.events_processed} events, ${lp.topics} topics)`);
          } else {
            console.log('Last pass: none yet');
          }
          if (status.next_pass_at) {
            console.log(`Next pass: ~${status.next_pass_at} (if idle)`);
          }
        }
        process.exit(0);
      } catch (e) {
        exitWithError(`Daemon status failed: ${e.message}`, 2, useJson);
      }
      return;
    }

    // ── daemon log ─────────────────────────────────────────────────────────
    if (daemonAction === 'log') {
      const tail = getOpt('tail', 'number') ?? null;
      try {
        const { getLogPath, readDaemonLog } = await import('../lib/daemon.mjs');
        const logPath = getLogPath(config);
        const entries = readDaemonLog(logPath, { tail: tail ?? undefined });
        if (useJson) {
          console.log(JSON.stringify({ entries, count: entries.length, log_path: logPath }));
        } else if (entries.length === 0) {
          console.log(`(no log entries — log: ${logPath})`);
        } else {
          for (const e of entries) {
            const { ts, event, ...rest } = e;
            const detail = Object.keys(rest).length ? '  ' + JSON.stringify(rest) : '';
            console.log(`${ts}  ${event ?? '?'}${detail}`);
          }
        }
        process.exit(0);
      } catch (e) {
        exitWithError(`Daemon log failed: ${e.message}`, 2, useJson);
      }
      return;
    }

    exitWithError(`knowtation daemon: unknown action "${daemonAction}". Use start, stop, status, or log.`, 1, useJson);
    return;
  }

  exitWithError(`Unknown command: ${subcommand}`, 1, useJson);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(2);
});
