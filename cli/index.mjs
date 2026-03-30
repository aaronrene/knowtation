#!/usr/bin/env node
import '../lib/load-env.mjs';

/**
 * Knowtation CLI — single entry point for search, get-note, list-notes, index, etc.
 */

import fs from 'fs';
import { execSync } from 'child_process';
import yaml from 'js-yaml';
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
  memory query <key>             Read from memory layer (requires memory.enabled). Keys: last_search, last_export.
  hub status                    Check Hub reachability (use --hub <url>). Requires Hub API.
  propose <path>                Create a proposal from local vault note (body/frontmatter) on the Hub. Options: --hub, --intent, --vault (X-Vault-Id), --external-ref, --labels a,b, --source agent|human|import, --base-state-id, --no-fetch-base.
  vault sync                    Commit and push vault to Git (when vault.git.enabled and remote set). See config.
  mcp                           Start MCP server (stdio transport). For Cursor/Claude Desktop.

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
            const { storeMemory } = await import('../lib/memory.mjs');
            storeMemory(config.data_dir, 'last_search', {
              query: out.query,
              paths: (out.results || []).map((r) => r.path),
              count: out.count ?? (out.results || []).length,
            });
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
      const result = await runIndex();
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
        const { writeNote, isInboxPath } = await import('../lib/write.mjs');
        const { attestBeforeWrite } = await import('../lib/air.mjs');
        if (config.air?.enabled && !isInboxPath(pathArg)) {
          await attestBeforeWrite(config, pathArg);
        }
        const result = writeNote(config.vault_path, pathArg, {
          body,
          frontmatter: Object.keys(frontmatterOverrides).length ? frontmatterOverrides : undefined,
          append,
        });
        try {
          const { maybeAutoSync } = await import('../lib/vault-git-sync.mjs');
          maybeAutoSync(config);
        } catch (_) {}
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
            const { storeMemory } = await import('../lib/memory.mjs');
            storeMemory(config.data_dir, 'last_export', { provenance: result.provenance, exported: result.exported });
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
        const result = await runImport(sourceType, input, {
          project: project ?? undefined,
          outputDir: outputDir ?? undefined,
          tags,
          dryRun,
        });
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
    const keyArg = args[2];
    if (action !== 'query' || !keyArg) {
      exitWithError('knowtation memory: use "memory query <key>". Keys: last_search, last_export.', 1, useJson);
    }
    const key = keyArg.replace(/\s+/g, '_');
    const validKeys = ['last_search', 'last_export'];
    if (!validKeys.includes(key)) {
      exitWithError(`knowtation memory: unknown key "${key}". Use: ${validKeys.join(', ')}.`, 1, useJson);
    }
    try {
      const config = loadConfig();
      if (!config.memory?.enabled) {
        exitWithError('knowtation memory: memory layer not enabled. Set memory.enabled in config.', 2, useJson);
      }
      const { getMemory } = await import('../lib/memory.mjs');
      const val = getMemory(config.data_dir, key);
      if (!val) {
        if (useJson) console.log(JSON.stringify({ key, value: null }));
        else console.log('(no value)');
      } else if (useJson) {
        console.log(JSON.stringify({ key, value: val }));
      } else {
        console.log(JSON.stringify(val, null, 2));
      }
      process.exit(0);
    } catch (e) {
      exitWithError(e.message, 2, useJson);
    }
    return;
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
        if (useJson) console.log(JSON.stringify(data));
        else console.log('Proposal created:', data.proposal_id, data.path);
        process.exit(0);
      } catch (e) {
        exitWithError(e.message, 2, useJson);
      }
    })();
    return;
  }

  exitWithError(`Unknown command: ${subcommand}`, 1, useJson);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(2);
});
