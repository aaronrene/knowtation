/**
 * Build Knowtation MCP surface (tools, resources, prompts, Phase C, subscriptions).
 * Used by stdio and Streamable HTTP transports.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { loadConfig } from '../lib/config.mjs';
import { readNote, resolveVaultRelativePath } from '../lib/vault.mjs';
import { runListNotes } from '../lib/list-notes.mjs';
import { runSearch } from '../lib/search.mjs';
import { runKeywordSearch } from '../lib/keyword-search.mjs';
import { runIndex } from '../lib/indexer.mjs';
import { writeNote } from '../lib/write.mjs';
import { exportNotes } from '../lib/export.mjs';
import { runImport } from '../lib/import.mjs';
import { IMPORT_SOURCE_TYPES, IMPORT_SOURCE_TYPES_HELP } from '../lib/import-source-types.mjs';
import { attestBeforeExport } from '../lib/air.mjs';
import { storeMemory, createMemoryManager } from '../lib/memory.mjs';
import { registerKnowtationResources } from './resources/register.mjs';
import { registerPhaseCTools } from './tools/phase-c.mjs';
import { registerMemoryTools } from './tools/memory.mjs';
import { registerHubProposalTools } from './tools/hub-proposals.mjs';
import { registerEnrichTool } from './tools/enrich.mjs';
import { rerankWithSampling } from './tools/sampling-rerank.mjs';
import { registerResourceSubscriptionHandlers, notifyIndexMetadataResources } from './resource-subscriptions.mjs';
import { sendMcpToolProgress, sendMcpLog } from './tool-telemetry.mjs';
import { registerKnowtationPrompts } from './prompts/register.mjs';
import { tryBuildKnowtationMcpInstructions } from './server-instructions.mjs';

export function jsonResponse(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
}

export function jsonError(msg, code = 'ERROR') {
  return { content: [{ type: 'text', text: JSON.stringify({ error: msg, code }) }], isError: true };
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function mountKnowtationMcp(server) {
  server.registerTool(
    'search',
    {
      description:
        'Search the vault: semantic (vector similarity, default) or keyword (substring / all-terms over path, body, and key frontmatter). Same filters as list-notes where applicable.',
      inputSchema: {
        query: z.string().describe('Search query string'),
        mode: z.enum(['semantic', 'keyword']).optional().describe('semantic = meaning (indexed); keyword = literal text'),
        match: z.enum(['phrase', 'all_terms']).optional().describe('Keyword only: phrase = whole query substring; all_terms = every token must appear (AND)'),
        folder: z.string().optional().describe('Filter by folder path prefix'),
        project: z.string().optional().describe('Filter by project slug'),
        tag: z.string().optional().describe('Filter by tag'),
        limit: z.number().optional().describe('Max results (default 10)'),
        fields: z.enum(['path', 'path+snippet', 'full']).optional().describe('Result shape'),
        snippet_chars: z.number().optional().describe('Max snippet length'),
        count_only: z.boolean().optional().describe('Return count only'),
        since: z.string().optional().describe('Filter by date (YYYY-MM-DD)'),
        until: z.string().optional().describe('Filter by date (YYYY-MM-DD)'),
        order: z.enum(['date', 'date-asc']).optional(),
        chain: z.string().optional().describe('Causal chain filter'),
        entity: z.string().optional().describe('Entity filter'),
        episode: z.string().optional().describe('Episode filter'),
        content_scope: z.enum(['all', 'notes', 'approval_logs']).optional().describe('Restrict to note files vs approval logs'),
        network: z.string().optional().describe('Phase 12: filter by blockchain network (e.g. icp, ethereum, sepolia)'),
        wallet_address: z.string().optional().describe('Phase 12: filter by wallet address or principal'),
        payment_status: z.string().optional().describe('Phase 12: filter by payment status (pending, settled, failed, cancelled)'),
        rerank: z.boolean().optional().describe('Phase F4: rerank results via sampling (default true for semantic; requires client sampling support)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const base = {
          folder: args.folder,
          project: args.project,
          tag: args.tag,
          limit: args.limit ?? 10,
          fields: args.fields ?? 'path+snippet',
          snippetChars: args.snippet_chars ?? 300,
          countOnly: args.count_only,
          since: args.since,
          until: args.until,
          order: args.order,
          chain: args.chain,
          entity: args.entity,
          episode: args.episode,
          content_scope: args.content_scope === 'all' ? undefined : args.content_scope,
          network: args.network,
          wallet_address: args.wallet_address,
          payment_status: args.payment_status,
        };
        const out =
          args.mode === 'keyword'
            ? await runKeywordSearch(args.query, { ...base, match: args.match === 'all_terms' ? 'all_terms' : 'phrase' }, config)
            : await runSearch(args.query, base, config);
        if (args.rerank !== false && args.mode !== 'keyword' && !args.count_only && Array.isArray(out.results) && out.results.length > 1) {
          out.results = await rerankWithSampling(server, args.query, out.results, args.limit ?? 10);
        }
        if (config.memory?.enabled) {
          try {
            const mm = createMemoryManager(config);
            if (mm.shouldCapture('search')) {
              mm.store('search', {
                query: out.query,
                mode: args.mode || 'semantic',
                paths: (out.results || []).map((r) => r.path),
                count: out.count ?? (out.results || []).length,
              });
            }
          } catch (_) {}
        }
        return jsonResponse(out);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'get_note',
    {
      description: 'Return full content of one note by vault-relative path.',
      inputSchema: {
        path: z.string().describe('Vault-relative path (e.g. vault/inbox/foo.md)'),
        body_only: z.boolean().optional().describe('Return only body'),
        frontmatter_only: z.boolean().optional().describe('Return only frontmatter'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        resolveVaultRelativePath(config.vault_path, args.path);
        const note = readNote(config.vault_path, args.path);
        if (args.body_only) {
          return jsonResponse({ path: note.path, body: note.body });
        }
        if (args.frontmatter_only) {
          return jsonResponse({ path: note.path, frontmatter: note.frontmatter });
        }
        return jsonResponse({ path: note.path, frontmatter: note.frontmatter, body: note.body });
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'list_notes',
    {
      description: 'List notes with optional filters (folder, project, tag, date range, blockchain fields).',
      inputSchema: {
        folder: z.string().optional(),
        project: z.string().optional(),
        tag: z.string().optional(),
        since: z.string().optional(),
        until: z.string().optional(),
        chain: z.string().optional(),
        entity: z.string().optional(),
        episode: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        order: z.enum(['date', 'date-asc']).optional(),
        fields: z.enum(['path', 'path+metadata', 'full']).optional(),
        count_only: z.boolean().optional(),
        network: z.string().optional().describe('Phase 12: filter by blockchain network (e.g. icp, ethereum)'),
        wallet_address: z.string().optional().describe('Phase 12: filter by wallet address or principal'),
        payment_status: z.string().optional().describe('Phase 12: filter by payment status (pending, settled, failed, cancelled)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const out = runListNotes(config, {
          folder: args.folder,
          project: args.project,
          tag: args.tag,
          since: args.since,
          until: args.until,
          chain: args.chain,
          entity: args.entity,
          episode: args.episode,
          limit: args.limit ?? 20,
          offset: args.offset ?? 0,
          order: args.order ?? 'date',
          fields: args.fields ?? 'path+metadata',
          countOnly: args.count_only,
          network: args.network,
          wallet_address: args.wallet_address,
          payment_status: args.payment_status,
        });
        return jsonResponse(out);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'index',
    {
      description: 'Re-run indexer: vault → chunk → embed → vector store. With enrich=true, generate per-note summaries via sampling after indexing.',
      inputSchema: {
        enrich: z.boolean().optional().describe('Phase F3: generate per-note summaries via sampling after indexing (default false, expensive)'),
        enrich_limit: z.number().optional().describe('Max notes to enrich (default 50)'),
      },
    },
    async (args, extra) => {
      try {
        const t0 = Date.now();
        const result = await runIndex({
          onProgress: async (p) => {
            await sendMcpToolProgress(extra, {
              progress: p.progress,
              total: p.total,
              message: p.message,
            });
          },
        });
        await notifyIndexMetadataResources(server);
        const config = loadConfig();
        let enriched = 0;
        if (args?.enrich) {
          const { enrichIndexedNotes } = await import('./tools/index-enrich.mjs');
          enriched = await enrichIndexedNotes(server, config, {
            limit: args.enrich_limit ?? 50,
            onProgress: async (done, total) => {
              await sendMcpToolProgress(extra, {
                progress: result.notesProcessed + done,
                total: result.notesProcessed + total,
                message: `enriching ${done}/${total}`,
              });
            },
          });
        }
        if (config.memory?.enabled) {
          try {
            const mm = createMemoryManager(config);
            if (mm.shouldCapture('index')) {
              mm.store('index', {
                notes_processed: result.notesProcessed,
                chunks_indexed: result.chunksIndexed,
                duration_ms: Date.now() - t0,
                enriched,
              });
            }
          } catch (_) {}
        }
        await sendMcpLog(server, 'info', {
          event: 'index_complete',
          notesProcessed: result.notesProcessed,
          chunksIndexed: result.chunksIndexed,
          enriched,
        });
        return jsonResponse({ ok: true, notesProcessed: result.notesProcessed, chunksIndexed: result.chunksIndexed, enriched });
      } catch (e) {
        await sendMcpLog(server, 'error', { event: 'index_failed', message: e.message || String(e) });
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'write',
    {
      description: 'Create or overwrite a note. Use body for content, frontmatter for key=value pairs.',
      inputSchema: {
        path: z.string().describe('Vault-relative path'),
        body: z.string().optional().describe('Note body content'),
        frontmatter: z.record(z.string(), z.string()).optional().describe('Frontmatter as key-value'),
        append: z.boolean().optional().describe('Append body to existing'),
      },
    },
    async (args, _extra) => {
      try {
        const config = loadConfig();
        const result = await writeNote(config.vault_path, args.path, {
          body: args.body,
          frontmatter: args.frontmatter,
          append: args.append,
          config,
        });
        if (config.memory?.enabled) {
          try {
            const mm = createMemoryManager(config);
            if (mm.shouldCapture('write')) {
              mm.store('write', {
                path: result.path,
                action: args.append ? 'append' : 'create',
                air_id: result.air_id || undefined,
              });
            }
          } catch (_) {}
        }
        const fm = args.frontmatter;
        if (fm && Object.keys(fm).length > 0 && fm.title === undefined) {
          await sendMcpLog(server, 'warning', {
            event: 'write_missing_title',
            path: args.path,
          });
        }
        return jsonResponse(result);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'export',
    {
      description: 'Export note(s) to file or directory. path_or_query can be a vault path or search query.',
      inputSchema: {
        path_or_query: z.string().describe('Vault path (e.g. vault/inbox/foo.md) or search query'),
        output: z.string().describe('Output file or directory path'),
        format: z.enum(['md', 'html']).optional(),
        project: z.string().optional().describe('Project filter when path_or_query is a query'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        let paths = [];
        const looksLikePath =
          !args.path_or_query.includes(' ') &&
          (args.path_or_query.endsWith('.md') || args.path_or_query.includes('/'));
        if (looksLikePath) {
          try {
            resolveVaultRelativePath(config.vault_path, args.path_or_query);
            paths = [args.path_or_query];
          } catch (_) {
            // Fall through: treat as query
          }
        }
        if (paths.length === 0) {
          const result = await runSearch(args.path_or_query, {
            limit: 50,
            project: args.project,
            fields: 'path',
          });
          paths = (result.results || []).map((r) => r.path).filter(Boolean);
        }
        if (!paths.length) {
          return jsonError('No notes found for path or query', 'RUNTIME_ERROR');
        }
        if (config.air?.enabled) {
          await attestBeforeExport(config, paths);
        }
        const result = exportNotes(config.vault_path, paths, args.output, { format: args.format ?? 'md' });
        if (config.memory?.enabled) {
          try {
            const mm = createMemoryManager(config);
            if (mm.shouldCapture('export')) {
              mm.store('export', { provenance: result.provenance, exported: result.exported, format: args.format ?? 'md' });
            }
          } catch (_) {}
        }
        return jsonResponse({ exported: result.exported, provenance: result.provenance });
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'import',
    {
      description: `Import from external source. source_type must be one of: ${IMPORT_SOURCE_TYPES_HELP}. For source_type "url", input is a full https URL string. For source_type "pdf", input is a filesystem path to a .pdf file. For source_type "docx", input is a filesystem path to a .docx file.`,
      inputSchema: {
        source_type: z
          .enum(
            /** @type {[string, string, ...string[]]} */ ([...IMPORT_SOURCE_TYPES])
          )
          .describe('Import source type'),
        input: z.string().describe('Path to file, folder, export, or https URL when source_type is url'),
        project: z.string().optional(),
        output_dir: z.string().optional().describe('Vault-relative output directory'),
        tags: z.array(z.string()).optional(),
        dry_run: z.boolean().optional(),
        url_mode: z
          .enum(['auto', 'bookmark', 'extract'])
          .optional()
          .describe('When source_type is url: capture mode (default auto)'),
      },
    },
    async (args, extra) => {
      try {
        await sendMcpToolProgress(extra, { progress: 0, message: `import start: ${args.source_type}` });
        const config = loadConfig();
        let mm;
        if (config.memory?.enabled && !args.dry_run) {
          try { mm = createMemoryManager(config); } catch (_) {}
        }
        const importOpts = {
          project: args.project,
          outputDir: args.output_dir,
          tags: args.tags || [],
          dryRun: args.dry_run,
          ...(args.source_type === 'url' && args.url_mode ? { urlMode: args.url_mode } : {}),
          onProgress: async (p) => {
            await sendMcpToolProgress(extra, {
              progress: p.progress,
              total: p.total,
              message: p.message,
            });
          },
        };
        if (mm && args.source_type === 'mem0-export' && mm.shouldCapture('capture')) {
          importOpts.onMemoryEvent = (data) => {
            try { mm.store('capture', data); } catch (_) {}
          };
        }
        const result = await runImport(args.source_type, args.input, importOpts);
        const n = result.count ?? 0;
        if (mm) {
          try {
            if (mm.shouldCapture('import')) {
              mm.store('import', {
                source_type: args.source_type,
                count: n,
                paths: (result.imported || []).map((r) => r.path).slice(0, 50),
                project: args.project || undefined,
              });
            }
          } catch (_) {}
        }
        await sendMcpToolProgress(extra, {
          progress: Math.max(1, n),
          total: Math.max(1, n),
          message: 'import complete',
        });
        await sendMcpLog(server, 'info', {
          event: 'import_complete',
          source_type: args.source_type,
          count: result.count,
        });
        return jsonResponse({ imported: result.imported, count: result.count });
      } catch (e) {
        await sendMcpLog(server, 'error', { event: 'import_failed', message: e.message || String(e) });
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  registerKnowtationResources(server);
  registerKnowtationPrompts(server);
  registerPhaseCTools(server);
  registerMemoryTools(server);
  registerHubProposalTools(server);
  registerEnrichTool(server);
  registerResourceSubscriptionHandlers(server);
}

/**
 * @returns {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer}
 */
export function createKnowtationMcpServer() {
  const instructions = tryBuildKnowtationMcpInstructions();
  const server = new McpServer(
    { name: 'knowtation', version: '0.1.0' },
    { capabilities: { logging: {} }, instructions }
  );
  mountKnowtationMcp(server);
  server.server.oninitialized = async () => {
    const caps = server.server.getClientCapabilities?.();
    if (!caps?.roots) return;
    try {
      const { roots } = await server.server.listRoots();
      await sendMcpLog(server, 'info', {
        event: 'client_roots',
        roots: (roots || []).map((r) => ({ uri: r.uri, name: r.name })),
      });
    } catch (_) {
      /* client may not implement roots/list */
    }
  };
  return server;
}
