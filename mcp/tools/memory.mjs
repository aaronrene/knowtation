/**
 * MCP memory tools: query, store, list, search, clear, summarize.
 * Phase 8 Memory Augmentation.
 */

import { z } from 'zod';
import { loadConfig } from '../../lib/config.mjs';
import { createMemoryManager, verifyMemoryEvent } from '../../lib/memory.mjs';
import { MEMORY_EVENT_TYPES } from '../../lib/memory-event.mjs';

function jsonResponse(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
}

function jsonError(msg, code = 'ERROR') {
  return { content: [{ type: 'text', text: JSON.stringify({ error: msg, code }) }], isError: true };
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerMemoryTools(server) {
  server.registerTool(
    'memory_query',
    {
      description: 'Read the latest value for a memory event type (e.g. search, export, write, import, index, propose, user).',
      inputSchema: {
        key: z.string().describe('Memory event type to query (e.g. search, export, write, user)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        if (!config.memory?.enabled) {
          return jsonResponse({ key: args.key, value: null, enabled: false });
        }
        const mm = createMemoryManager(config);
        const event = mm.getLatest(args.key);
        if (!event) return jsonResponse({ key: args.key, value: null, updated_at: null });
        return jsonResponse({ key: args.key, value: event.data, updated_at: event.ts, id: event.id });
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'memory_store',
    {
      description: 'Store a value in memory for agent write-back or user-defined context. Type defaults to "user".',
      inputSchema: {
        key: z.string().describe('Descriptive key for this memory entry'),
        value: z.record(z.unknown()).describe('JSON object to store'),
        ttl: z.string().optional().describe('Optional TTL (ISO 8601 duration, e.g. P7D for 7 days)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        if (!config.memory?.enabled) {
          return jsonError('Memory layer not enabled. Set memory.enabled in config.', 'DISABLED');
        }
        const mm = createMemoryManager(config);
        const data = { key: args.key, ...args.value };
        const result = mm.store('user', data, { ttl: args.ttl });
        return jsonResponse(result);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'memory_list',
    {
      description: 'List recent memory events with optional filters. Use topic to filter by topic slug (e.g. "blockchain", "vault").',
      inputSchema: {
        type: z.string().optional().describe('Filter by event type'),
        topic: z.string().optional().describe('Filter by topic slug (derived from event data)'),
        since: z.string().optional().describe('ISO date lower bound'),
        until: z.string().optional().describe('ISO date upper bound'),
        limit: z.number().optional().describe('Max events (default 20, max 100)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        if (!config.memory?.enabled) {
          return jsonResponse({ events: [], count: 0, enabled: false });
        }
        const mm = createMemoryManager(config);
        const events = mm.list({
          type: args.type,
          topic: args.topic,
          since: args.since,
          until: args.until,
          limit: Math.min(args.limit ?? 20, 100),
        });
        return jsonResponse({ events, count: events.length });
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'memory_search',
    {
      description: 'Semantic search over memory entries. Requires memory.provider: vector or mem0.',
      inputSchema: {
        query: z.string().describe('Search query'),
        limit: z.number().optional().describe('Max results (default 10)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        if (!config.memory?.enabled) {
          return jsonError('Memory layer not enabled.', 'DISABLED');
        }
        const mm = createMemoryManager(config);
        if (!mm.supportsSearch()) {
          return jsonError('Semantic memory search requires memory.provider: vector or mem0.', 'UNSUPPORTED');
        }
        const results = mm.search(args.query, { limit: args.limit ?? 10 });
        return jsonResponse({ results, count: results.length });
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'memory_clear',
    {
      description: 'Clear memory events. Requires confirm: true.',
      inputSchema: {
        type: z.string().optional().describe('Only clear events of this type'),
        before: z.string().optional().describe('Only clear events before this ISO date'),
        confirm: z.boolean().describe('Must be true to proceed'),
      },
    },
    async (args) => {
      try {
        if (!args.confirm) {
          return jsonError('Set confirm: true to clear memory.', 'CONFIRMATION_REQUIRED');
        }
        const config = loadConfig();
        if (!config.memory?.enabled) {
          return jsonError('Memory layer not enabled.', 'DISABLED');
        }
        const mm = createMemoryManager(config);
        const result = mm.clear({ type: args.type, before: args.before });
        return jsonResponse(result);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'memory_verify',
    {
      description:
        'Verify one or more memory events against the current vault state. Returns a confidence level for each: ' +
        '"verified" (path exists, unchanged), "stale" (path gone or modified after event), or ' +
        '"hint" (no verifiable reference — treat as context only). ' +
        'ALWAYS call this before acting on memory that references vault paths.',
      inputSchema: {
        event_ids: z
          .array(z.string())
          .optional()
          .describe('List of memory event IDs (mem_*) to verify. Omit to verify all recent events.'),
        type: z.string().optional().describe('Verify only events of this type (e.g. write, export)'),
        limit: z.number().optional().describe('Max events to verify when no event_ids given (default 20)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        if (!config.memory?.enabled) {
          return jsonError('Memory layer not enabled.', 'DISABLED');
        }
        const mm = createMemoryManager(config);

        let events;
        if (args.event_ids && args.event_ids.length > 0) {
          const allRecent = mm.list({ limit: 500 });
          const idSet = new Set(args.event_ids);
          events = allRecent.filter((e) => idSet.has(e.id));
        } else {
          events = mm.list({ type: args.type, limit: Math.min(args.limit ?? 20, 100) });
        }

        const results = events.map((event) => {
          const { confidence, reason } = verifyMemoryEvent(config, event);
          return {
            id: event.id,
            type: event.type,
            ts: event.ts,
            confidence,
            reason,
            data_summary: JSON.stringify(event.data).slice(0, 120),
          };
        });

        const counts = { verified: 0, hint: 0, stale: 0 };
        for (const r of results) counts[r.confidence] = (counts[r.confidence] || 0) + 1;

        return jsonResponse({
          results,
          summary: counts,
          total: results.length,
          note: 'Treat memory as hints. Stale entries may reference moved or deleted notes. Verify against the vault before taking action.',
        });
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'memory_consolidate',
    {
      description:
        'Trigger LLM-powered memory consolidation: group recent events by topic, merge/deduplicate via LLM, ' +
        'and store concise fact summaries as consolidation events. Rebuilds the pointer index afterward.',
      inputSchema: {
        dry_run: z.boolean().optional().describe('If true, preview what would happen without writing events (default false)'),
        passes: z.number().optional().describe('Number of consolidation passes (default 1)'),
        lookback_hours: z.number().optional().describe('How far back to read events (default: daemon config or 24h)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        if (!config.memory?.enabled) {
          return jsonError('Memory layer not enabled. Set memory.enabled in config.', 'DISABLED');
        }
        const { consolidateMemory } = await import('../../lib/memory-consolidate.mjs');
        const result = await consolidateMemory(config, {
          dryRun: args.dry_run,
          passes: args.passes,
          lookbackHours: args.lookback_hours,
        });
        return jsonResponse(result);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'daemon_status',
    {
      description:
        'Return the background consolidation daemon status: running state, PID, ' +
        'last pass time and statistics, next scheduled pass time, and events processed count. ' +
        'Use before calling daemon start/stop to check current state.',
      inputSchema: {},
    },
    async () => {
      try {
        const config = loadConfig();
        const { getDaemonStatus } = await import('../../lib/daemon.mjs');
        const status = getDaemonStatus(config);
        return jsonResponse(status);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );

  server.registerTool(
    'memory_summarize',
    {
      description: 'Generate an LLM-powered summary of recent session activity and store it as a session_summary event.',
      inputSchema: {
        since: z.string().optional().describe('ISO date lower bound (default: last 24 hours)'),
        max_tokens: z.number().optional().describe('Max LLM output tokens (default 512)'),
        dry_run: z.boolean().optional().describe('If true, returns summary without storing'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        if (!config.memory?.enabled) {
          return jsonError('Memory layer not enabled.', 'DISABLED');
        }
        const { generateSessionSummary } = await import('../../lib/memory-session-summary.mjs');
        const result = await generateSessionSummary(config, {
          since: args.since,
          maxTokens: args.max_tokens,
          dryRun: args.dry_run,
        });
        return jsonResponse(result);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    }
  );
}
