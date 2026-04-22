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
import { readNote, resolveVaultRelativePath, noteFileExistsInVault } from '../lib/vault.mjs';
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
        `knowtation import <source-type> <input>\n  Options: --project, --output-dir, --tags t1,t2, --dry-run, --json\n  Source types: ${IMPORT_SOURCE_TYPES_HELP}`
      );
      process.exit(0);
    }
    const sourceType = args[1];
    const input = args[2];
    if (!sourceType || !input) {
      exitWithError('knowtation import: provide <source-type> and <input>. See docs/IMPORT-SOURCES.md.', 1, useJson);
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

        const importOpts = {
          project: project ?? undefined,
          outputDir: outputDir ?? undefined,
          tags,
          dryRun,
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
