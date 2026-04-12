/**
 * Issue #1 Phase D2 — Hosted MCP server variant for the Hub gateway.
 * Creates a per-session McpServer backed by canister (notes CRUD) and bridge (search/index).
 * Tools are role-filtered based on user permissions.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isToolAllowed } from './mcp-tool-acl.mjs';

function jsonResponse(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
}

function jsonError(msg, code = 'ERROR') {
  return { content: [{ type: 'text', text: JSON.stringify({ error: msg, code }) }], isError: true };
}

/**
 * Fetch JSON from an upstream service with auth forwarding.
 * @param {string} url
 * @param {{ method?: string, body?: unknown, token?: string, vaultId?: string }} [opts]
 */
async function upstreamFetch(url, opts = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  if (opts.vaultId) headers['X-Vault-Id'] = opts.vaultId;
  const res = await fetch(url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Upstream ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Create a hosted McpServer instance scoped to one user's session.
 *
 * @param {{
 *   userId: string,
 *   vaultId: string,
 *   role: 'viewer' | 'editor' | 'admin',
 *   token: string,
 *   canisterUrl: string,
 *   bridgeUrl: string,
 *   scope?: Record<string, unknown>,
 * }} ctx
 * @returns {McpServer}
 */
export function createHostedMcpServer(ctx) {
  const { userId, vaultId, role, token, canisterUrl, bridgeUrl } = ctx;
  const server = new McpServer(
    { name: 'knowtation-hosted', version: '0.1.0' },
    { capabilities: { logging: {} } }
  );
  const fetchOpts = { token, vaultId };

  if (isToolAllowed('search', role)) {
    server.registerTool(
      'search',
      {
        description:
          'Search the hosted vault: semantic (vector similarity, default) or keyword (substring / all-terms). Same filters as list-notes where applicable.',
        inputSchema: {
          query: z.string().describe('Search query'),
          mode: z.enum(['semantic', 'keyword']).optional().describe('semantic = meaning (indexed); keyword = literal text'),
          match: z.enum(['phrase', 'all_terms']).optional().describe('Keyword only: phrase = whole query substring; all_terms = every token must appear (AND)'),
          limit: z.number().optional().describe('Max results (default 10)'),
          fields: z.enum(['path', 'path+snippet', 'full']).optional().describe('Result shape (default path+snippet)'),
          snippet_chars: z.number().optional().describe('Max snippet length (default 300)'),
          count_only: z.boolean().optional().describe('Return count only, no results array'),
          folder: z.string().optional().describe('Filter by folder path prefix'),
          project: z.string().optional().describe('Filter by project slug'),
          tag: z.string().optional().describe('Filter by tag'),
          since: z.string().optional().describe('Filter by date (YYYY-MM-DD)'),
          until: z.string().optional().describe('Filter by date (YYYY-MM-DD)'),
          order: z.enum(['date', 'date-asc']).optional(),
          chain: z.string().optional().describe('Causal chain filter'),
          entity: z.string().optional().describe('Entity filter'),
          episode: z.string().optional().describe('Episode filter'),
          content_scope: z.enum(['all', 'notes', 'approval_logs']).optional().describe('Restrict to note files vs approval logs'),
        },
      },
      async (args) => {
        try {
          const body = { query: args.query };
          if (args.mode != null) body.mode = args.mode;
          if (args.match != null) body.match = args.match;
          if (args.limit != null) body.limit = args.limit;
          if (args.fields != null) body.fields = args.fields;
          if (args.snippet_chars != null) body.snippetChars = args.snippet_chars;
          if (args.count_only != null) body.count_only = args.count_only;
          if (args.folder != null) body.folder = args.folder;
          if (args.project != null) body.project = args.project;
          if (args.tag != null) body.tag = args.tag;
          if (args.since != null) body.since = args.since;
          if (args.until != null) body.until = args.until;
          if (args.order != null) body.order = args.order;
          if (args.chain != null) body.chain = args.chain;
          if (args.entity != null) body.entity = args.entity;
          if (args.episode != null) body.episode = args.episode;
          if (args.content_scope != null) body.content_scope = args.content_scope;
          const data = await upstreamFetch(`${bridgeUrl}/api/v1/search`, {
            ...fetchOpts,
            method: 'POST',
            body,
          });
          return jsonResponse(data);
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  if (isToolAllowed('get_note', role)) {
    server.registerTool(
      'get_note',
      {
        description: 'Retrieve a single note by vault-relative path.',
        inputSchema: {
          path: z.string().describe('Vault-relative note path'),
        },
      },
      async (args) => {
        try {
          const data = await upstreamFetch(
            `${canisterUrl}/api/v1/notes/${encodeURIComponent(args.path)}`,
            fetchOpts
          );
          return jsonResponse(data);
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  if (isToolAllowed('list_notes', role)) {
    server.registerTool(
      'list_notes',
      {
        description: 'List notes with filters.',
        inputSchema: {
          folder: z.string().optional(),
          project: z.string().optional(),
          tag: z.string().optional(),
          since: z.string().optional(),
          until: z.string().optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        },
      },
      async (args) => {
        try {
          const params = new URLSearchParams();
          if (args.folder) params.set('folder', args.folder);
          if (args.project) params.set('project', args.project);
          if (args.tag) params.set('tag', args.tag);
          if (args.since) params.set('since', args.since);
          if (args.until) params.set('until', args.until);
          if (args.limit) params.set('limit', String(args.limit));
          if (args.offset) params.set('offset', String(args.offset));
          const data = await upstreamFetch(`${canisterUrl}/api/v1/notes?${params}`, fetchOpts);
          return jsonResponse(data);
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  if (isToolAllowed('write', role)) {
    server.registerTool(
      'write',
      {
        description: 'Write or update a note in the vault.',
        inputSchema: {
          path: z.string().describe('Vault-relative path'),
          body: z.string().describe('Markdown body'),
          frontmatter: z.record(z.unknown()).optional(),
        },
      },
      async (args) => {
        try {
          const data = await upstreamFetch(`${canisterUrl}/api/v1/notes`, {
            ...fetchOpts,
            method: 'POST',
            body: { path: args.path, body: args.body, frontmatter: args.frontmatter },
          });
          return jsonResponse(data);
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  if (isToolAllowed('index', role)) {
    server.registerTool(
      'index',
      {
        description: 'Trigger re-indexing of the hosted vault.',
      },
      async () => {
        try {
          const data = await upstreamFetch(`${bridgeUrl}/api/v1/index`, {
            ...fetchOpts,
            method: 'POST',
          });
          return jsonResponse(data);
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  if (isToolAllowed('summarize', role)) {
    server.registerTool(
      'summarize',
      {
        description: 'Summarize notes via the client LLM (sampling) or server fallback.',
        inputSchema: {
          path: z.string().optional(),
          paths: z.array(z.string()).optional(),
          style: z.enum(['brief', 'detailed', 'bullets']).optional(),
        },
      },
      async (args) => {
        try {
          const paths = [];
          if (args.path) paths.push(args.path);
          if (args.paths) paths.push(...args.paths);
          if (!paths.length) return jsonError('Provide path or paths', 'INVALID');

          const bodies = [];
          for (const p of paths.slice(0, 10)) {
            try {
              const note = await upstreamFetch(
                `${canisterUrl}/api/v1/notes/${encodeURIComponent(p)}`,
                fetchOpts
              );
              bodies.push(`## ${p}\n${note.body || ''}`);
            } catch (_) {}
          }

          const combined = bodies.join('\n\n').slice(0, 48000);
          const style = args.style || 'brief';
          const maxWords = style === 'detailed' ? 400 : style === 'bullets' ? 300 : 150;
          const system = `You summarize vault notes faithfully. Output style: ${style}. Max approximately ${maxWords} words.`;

          const { trySampling } = await import('../../mcp/sampling.mjs');
          let summary = await trySampling(server, { system, user: combined, maxTokens: Math.min(1024, maxWords * 2) });
          if (!summary) {
            summary = `(Sampling unavailable — summarize tool requires a client that supports MCP sampling for hosted mode.)`;
          }
          return jsonResponse({ summary, source_paths: paths });
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  if (isToolAllowed('enrich', role)) {
    server.registerTool(
      'enrich',
      {
        description: 'Auto-categorize a note (suggest project, tags, title) via sampling.',
        inputSchema: {
          path: z.string().describe('Vault-relative note path'),
        },
      },
      async (args) => {
        try {
          const note = await upstreamFetch(
            `${canisterUrl}/api/v1/notes/${encodeURIComponent(args.path)}`,
            fetchOpts
          );
          const body = (note.body || '').slice(0, 32000);
          const existingFm = note.frontmatter || {};

          const { trySamplingJson } = await import('../../mcp/sampling.mjs');
          const system = `You are a knowledge management assistant. Given a note's content, suggest metadata. Return ONLY a JSON object with: "title" (string), "project" (lowercase-kebab-case string or null), "tags" (array of up to 5 lowercase strings).`;
          const result = await trySamplingJson(server, {
            system,
            user: `Existing frontmatter: ${JSON.stringify(existingFm)}\n\n${body}`,
            maxTokens: 512,
          });

          return jsonResponse({
            path: args.path,
            suggestions: result || { title: null, project: null, tags: [] },
            source: result ? 'sampling' : 'unavailable',
          });
        } catch (e) {
          return jsonError(e.message || String(e), 'UPSTREAM_ERROR');
        }
      }
    );
  }

  server.registerResource(
    'vault-info',
    'knowtation://hosted/vault-info',
    { description: 'Current vault context (user, vault, role, scope)' },
    async () => ({
      contents: [{
        uri: 'knowtation://hosted/vault-info',
        mimeType: 'application/json',
        text: JSON.stringify({ userId, vaultId, role, scope: ctx.scope }),
      }],
    })
  );

  return server;
}
