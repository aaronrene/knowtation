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
import { runIndex } from '../lib/indexer.mjs';
import { writeNote, isInboxPath } from '../lib/write.mjs';
import { exportNotes } from '../lib/export.mjs';
import { runImport } from '../lib/import.mjs';
import { IMPORT_SOURCE_TYPES, IMPORT_SOURCE_TYPES_HELP } from '../lib/import-source-types.mjs';
import { attestBeforeWrite, attestBeforeExport } from '../lib/air.mjs';
import { storeMemory } from '../lib/memory.mjs';
import { registerKnowtationResources } from './resources/register.mjs';
import { registerPhaseCTools } from './tools/phase-c.mjs';
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
      description: 'Semantic search over the indexed vault. Returns ranked results.',
      inputSchema: {
        query: z.string().describe('Search query string'),
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
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const out = await runSearch(args.query, {
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
        });
        if (config.memory?.enabled) {
          try {
            storeMemory(config.data_dir, 'last_search', {
              query: out.query,
              paths: (out.results || []).map((r) => r.path),
              count: out.count ?? (out.results || []).length,
            });
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
      description: 'List notes with optional filters (folder, project, tag, date range).',
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
      description: 'Re-run indexer: vault → chunk → embed → vector store.',
    },
    async (extra) => {
      try {
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
        await sendMcpLog(server, 'info', {
          event: 'index_complete',
          notesProcessed: result.notesProcessed,
          chunksIndexed: result.chunksIndexed,
        });
        return jsonResponse({ ok: true, notesProcessed: result.notesProcessed, chunksIndexed: result.chunksIndexed });
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
        if (config.air?.enabled && !isInboxPath(args.path)) {
          await attestBeforeWrite(config, args.path);
        }
        const result = writeNote(config.vault_path, args.path, {
          body: args.body,
          frontmatter: args.frontmatter,
          append: args.append,
        });
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
            storeMemory(config.data_dir, 'last_export', { provenance: result.provenance, exported: result.exported });
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
      description: `Import from external source. source_type must be one of: ${IMPORT_SOURCE_TYPES_HELP}.`,
      inputSchema: {
        source_type: z
          .enum(
            /** @type {[string, string, ...string[]]} */ ([...IMPORT_SOURCE_TYPES])
          )
          .describe('Import source type'),
        input: z.string().describe('Path to file, folder, or export'),
        project: z.string().optional(),
        output_dir: z.string().optional().describe('Vault-relative output directory'),
        tags: z.array(z.string()).optional(),
        dry_run: z.boolean().optional(),
      },
    },
    async (args, extra) => {
      try {
        await sendMcpToolProgress(extra, { progress: 0, message: `import start: ${args.source_type}` });
        const result = await runImport(args.source_type, args.input, {
          project: args.project,
          outputDir: args.output_dir,
          tags: args.tags || [],
          dryRun: args.dry_run,
          onProgress: async (p) => {
            await sendMcpToolProgress(extra, {
              progress: p.progress,
              total: p.total,
              message: p.message,
            });
          },
        });
        const n = result.count ?? 0;
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
