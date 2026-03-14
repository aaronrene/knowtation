#!/usr/bin/env node
import '../lib/load-env.mjs';

/**
 * Knowtation CLI — single entry point for search, get-note, list-notes, index, etc.
 */

import fs from 'fs';
import yaml from 'js-yaml';
import { loadConfig } from '../lib/config.mjs';
import { listMarkdownFiles, readNote, normalizeSlug, normalizeTags, resolveVaultRelativePath } from '../lib/vault.mjs';
import { exitWithError } from '../lib/errors.mjs';

const args = process.argv.slice(2);
const subcommand = args[0];
const useJson = args.includes('--json');

const help = `
knowtation — personal knowledge and content system (know + notation)

Usage:
  knowtation <command> [options]

Commands:
  search <query>     Semantic search over vault. Use --project, --tag, --folder, --limit. --json for machine output.
  get-note <path>   Return full content of one note by path. Use --body-only, --frontmatter-only, --json.
  list-notes        List notes. Use --folder, --project, --tag, --limit, --offset, --fields, --count-only, --json.
  index             Re-run indexer: vault → chunk → embed → vector store (Qdrant or sqlite-vec).
  write <path>      Create or overwrite a note. Use --stdin for body, --frontmatter k=v, --append.
  export <path|query> <output>  Export note(s) to dir/file. Use --format, --project. Provenance and AIR per spec.
  import <source-type> <input>   Ingest from ChatGPT, Claude, Mem0, etc. See docs/IMPORT-SOURCES.md.

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

function getNotesWithMeta(vaultPath, config) {
  const paths = listMarkdownFiles(vaultPath, { ignore: config.ignore });
  const notes = [];
  for (const p of paths) {
    try {
      notes.push(readNote(vaultPath, p));
    } catch (_) {
      // skip unreadable
    }
  }
  return notes;
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

/**
 * Normalize date to YYYY-MM-DD for range comparison.
 */
function dateSlice(d) {
  if (d == null || typeof d !== 'string') return '';
  return d.trim().slice(0, 10) || '';
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
  const limit = getOpt('limit', 'number') ?? 20;
  const offset = getOpt('offset', 'number') ?? 0;
  const order = getOpt('order') || 'date';
  const fields = getOpt('fields') || 'path+metadata';
  const countOnly = hasOpt('count-only');

  let config;
  try {
    config = loadConfig();
  } catch (e) {
    exitWithError(e.message, 2, useJson);
  }

  let notes = getNotesWithMeta(config.vault_path, config);

  if (folder) {
    const prefix = folder.replace(/\\/g, '/').replace(/\/$/, '') + '/';
    notes = notes.filter((n) => n.path === folder || n.path.startsWith(prefix));
  }
  if (project) {
    const p = normalizeSlug(project);
    notes = notes.filter((n) => n.project === p || (n.frontmatter?.project && normalizeSlug(String(n.frontmatter.project)) === p));
  }
  if (tag) {
    const t = normalizeSlug(tag);
    notes = notes.filter((n) => n.tags?.includes(t) || normalizeTags(n.frontmatter?.tags).includes(t));
  }
  if (since) {
    const s = dateSlice(since);
    if (s) notes = notes.filter((n) => dateSlice(n.date || n.updated) >= s);
  }
  if (until) {
    const u = dateSlice(until);
    if (u) notes = notes.filter((n) => dateSlice(n.date || n.updated) <= u);
  }
  if (chain) {
    const c = normalizeSlug(chain);
    notes = notes.filter((n) => n.causal_chain_id === c);
  }
  if (entity) {
    const e = normalizeSlug(entity);
    notes = notes.filter((n) => Array.isArray(n.entity) && n.entity.includes(e));
  }
  if (episode) {
    const ep = normalizeSlug(episode);
    notes = notes.filter((n) => n.episode_id === ep);
  }

  if (order === 'date-asc') {
    notes.sort((a, b) => (a.date || a.updated || '').localeCompare(b.date || b.updated || ''));
  } else if (order === 'date') {
    notes.sort((a, b) => (b.date || b.updated || '').localeCompare(a.date || a.updated || ''));
  } else {
    notes.sort((a, b) => a.path.localeCompare(b.path));
  }

  const total = notes.length;
  const slice = notes.slice(offset, offset + limit);

  if (countOnly) {
    if (useJson) {
      console.log(JSON.stringify({ total }));
    } else {
      console.log(total);
    }
    process.exit(0);
  }

  if (useJson) {
    const list = slice.map((n) => {
      if (fields === 'path') return { path: n.path };
      if (fields === 'full') return { path: n.path, frontmatter: n.frontmatter, body: n.body };
      return { path: n.path, project: n.project || null, tags: n.tags || [], date: n.date || null };
    });
    console.log(JSON.stringify({ notes: list, total }));
  } else {
    for (const n of slice) {
      const meta = [n.project, n.tags?.join(', '), n.date].filter(Boolean).join(' | ');
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
      console.log('knowtation search <query>\n  Options: --folder, --project, --tag, --since, --until, --chain, --entity, --episode, --order date|date-asc, --limit, --fields path|path+snippet|full, --snippet-chars <n>, --count-only, --json');
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
    const limit = getOpt('limit', 'number') ?? 10;
    const fields = getOpt('fields') || 'path+snippet';
    const snippetChars = getOpt('snippet-chars', 'number');
    const countOnly = hasOpt('count-only');
    const validFields = ['path', 'path+snippet', 'full'];
    if (fields && !validFields.includes(fields)) {
      exitWithError(`knowtation search: --fields must be one of ${validFields.join(', ')}.`, 1, useJson);
    }
    (async () => {
      try {
        const { runSearch } = await import('../lib/search.mjs');
        const out = await runSearch(query, {
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
        });
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
      console.log('knowtation import <source-type> <input>\n  Options: --project, --output-dir, --tags t1,t2, --dry-run, --json\n  Source types: markdown, chatgpt-export, claude-export, mif, mem0-export, audio, video (notebooklm, gdrive: stub)');
      process.exit(0);
    }
    const sourceType = args[1];
    const input = args[2];
    if (!sourceType || !input) {
      exitWithError('knowtation import: provide <source-type> and <input>. See docs/IMPORT-SOURCES.md.', 1, useJson);
    }
    const validTypes = ['chatgpt-export', 'claude-export', 'mem0-export', 'notebooklm', 'gdrive', 'mif', 'markdown', 'audio', 'video'];
    if (!validTypes.includes(sourceType)) {
      exitWithError(`Unknown source-type "${sourceType}". Valid: ${validTypes.join(', ')}.`, 1, useJson);
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

  exitWithError(`Unknown command: ${subcommand}`, 1, useJson);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(2);
});
