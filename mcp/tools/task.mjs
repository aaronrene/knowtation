/**
 * MCP Task read tools — task_list / task_get (Phase 2G-b).
 *
 * Delegates to lib/task/task-handlers.mjs for CLI = MCP = Hub parity.
 *
 * @see docs/TASK-STORE-CONTRACT-2G.md §4.2
 */

import { z } from 'zod';
import { loadConfig } from '../../lib/config.mjs';
import { handleTaskListRequest, handleTaskGetRequest } from '../../lib/task/task-handlers.mjs';
import {
  handleTaskProposeRequest,
  handleTaskLoopProposeRequest,
  handleTaskInstanceMaterializeRequest,
} from '../../lib/task/task-write.mjs';
import { createProposal } from '../../hub/proposals-store.mjs';
import { jsonResponse, jsonError } from '../create-server.mjs';

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerTaskTools(server) {
  server.registerTool(
    'task_list',
    {
      description:
        'List scope-visible tasks (content-minimized summaries). Same JSON as Hub GET /api/v1/tasks.',
      inputSchema: {
        scope: z.enum(['personal', 'project', 'org']).optional().describe('Narrow within authorized scopes only'),
        workspace_id: z.string().optional().describe('Filter by workspace_id equality'),
        status: z
          .enum(['pending', 'in_progress', 'blocked', 'done', 'cancelled'])
          .optional()
          .describe('Filter by task status'),
        kind: z
          .enum(['personal', 'assignment', 'mentor_checkin', 'org_work_job'])
          .optional()
          .describe('Filter by task kind'),
        limit: z.number().int().min(1).max(500).optional().describe('Max summaries (default 500)'),
        vault_id: z.string().optional().describe('Vault id (default from config)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const cliScopes = Array.isArray(config.flow?.visible_scopes)
          ? config.flow.visible_scopes
          : undefined;
        const result = handleTaskListRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          scope: args.scope,
          workspace_id: args.workspace_id,
          status: args.status,
          kind: args.kind,
          limit: args.limit,
        });
        if (!result.ok) {
          return jsonError(result.error, result.code);
        }
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );

  server.registerTool(
    'task_get',
    {
      description: 'Get one authorized task record. Same JSON as Hub GET /api/v1/tasks/{id}.',
      inputSchema: {
        task_id: z.string().describe('Task id (task_<slug>)'),
        vault_id: z.string().optional().describe('Vault id (default from config)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const cliScopes = Array.isArray(config.flow?.visible_scopes)
          ? config.flow.visible_scopes
          : undefined;
        const result = handleTaskGetRequest({
          dataDir: config.data_dir,
          vaultId,
          taskId: args.task_id,
          cliScopes,
        });
        if (!result.ok) {
          return jsonError(result.error, result.code);
        }
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );

  server.registerTool(
    'task_propose',
    {
      description:
        'Propose a one-time task write (create/status/assign/artifact). Same path as Hub POST /api/v1/tasks/proposals.',
      inputSchema: {
        proposal_kind: z
          .enum(['task_create', 'task_status_update', 'task_assign', 'task_artifact_link'])
          .optional()
          .describe('Server-stamped on create; client value selects handler only'),
        intent: z.string().describe('Untrusted human-readable reason (required)'),
        task: z.record(z.unknown()).optional().describe('task_create payload'),
        task_id: z.string().optional(),
        base_state_id: z.string().optional(),
        status: z.enum(['pending', 'in_progress', 'blocked', 'done', 'cancelled']).optional(),
        assignee_ref: z.string().nullable().optional(),
        assigner_ref: z.string().nullable().optional(),
        artifact_link: z.object({ kind: z.string(), ref: z.string() }).optional(),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const cliScopes = Array.isArray(config.flow?.visible_scopes)
          ? config.flow.visible_scopes
          : undefined;
        const proposalKind = args.proposal_kind || 'task_create';
        const result = handleTaskProposeRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          proposalKind,
          body: args,
          intent: args.intent,
          createProposal,
        });
        if (!result.ok) {
          return jsonError(result.error, result.code);
        }
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );

  server.registerTool(
    'task_loop_propose',
    {
      description:
        'Propose a task loop series write (create/pause/cancel). Same as Hub POST /api/v1/task-loops/proposals.',
      inputSchema: {
        proposal_kind: z.enum(['task_loop_create', 'task_loop_pause', 'task_loop_cancel']).optional(),
        intent: z.string(),
        loop: z.record(z.unknown()).optional(),
        loop_id: z.string().optional(),
        base_state_id: z.string().optional(),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const cliScopes = Array.isArray(config.flow?.visible_scopes)
          ? config.flow.visible_scopes
          : undefined;
        const proposalKind = args.proposal_kind || 'task_loop_create';
        const result = handleTaskLoopProposeRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          proposalKind,
          body: args,
          intent: args.intent,
          createProposal,
        });
        if (!result.ok) {
          return jsonError(result.error, result.code);
        }
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );

  server.registerTool(
    'task_instance_materialize',
    {
      description:
        'Propose materializing one loop occurrence task. Same as Hub POST /api/v1/task-loops/{loop_id}/instances/proposals.',
      inputSchema: {
        loop_id: z.string(),
        intent: z.string(),
        occurrence_key: z.string().optional(),
        occurrence_at: z.string().optional(),
        due_at: z.string().optional(),
        title_override: z.string().optional(),
        base_state_id: z.string().optional(),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const cliScopes = Array.isArray(config.flow?.visible_scopes)
          ? config.flow.visible_scopes
          : undefined;
        const result = handleTaskInstanceMaterializeRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          loopId: args.loop_id,
          body: args,
          intent: args.intent,
          createProposal,
        });
        if (!result.ok) {
          return jsonError(result.error, result.code);
        }
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );
}
