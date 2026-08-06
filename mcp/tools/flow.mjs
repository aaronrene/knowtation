/**
 * MCP Flow read tools — flow_list / flow_get (Phase 7A-10b).
 *
 * Delegates to lib/flow/flow-handlers.mjs for CLI = MCP = Hub parity.
 *
 * @see docs/FLOW-STORE-CONTRACT-7A-10.md §7
 */

import { z } from 'zod';
import { loadConfig } from '../../lib/config.mjs';
import { handleFlowListRequest, handleFlowGetRequest, handleFlowProjectRequest } from '../../lib/flow/flow-handlers.mjs';
import { handleFlowProposeRequest } from '../../lib/flow/flow-authoring.mjs';
import {
  handleFlowCaptureObserveRequest,
  handleFlowCaptureListRequest,
  handleFlowCaptureProposeRequest,
  handleFlowCaptureDismissRequest,
} from '../../lib/flow/flow-capture.mjs';
import {
  handleFlowExternalGrantMintRequest,
  handleFlowExternalGrantRevokeRequest,
  handleFlowExternalGrantListRequest,
} from '../../lib/flow/external-agent.mjs';
import { handleFlowRunMcpRequest } from '../../lib/flow/flow-execution.mjs';
import { createProposal } from '../../hub/proposals-store.mjs';
import { jsonResponse, jsonError } from '../create-server.mjs';

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerFlowTools(server) {
  server.registerTool(
    'flow_list',
    {
      description:
        'List scope-visible flows (content-minimized summaries). Same JSON as Hub GET /api/v1/flows.',
      inputSchema: {
        scope: z.enum(['personal', 'project', 'org']).optional().describe('Narrow within authorized scopes only'),
        tag: z.string().optional().describe('Filter by a single tag'),
        limit: z.number().int().min(1).max(200).optional().describe('Max summaries (default 200)'),
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
        const result = handleFlowListRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          scope: args.scope,
          tag: args.tag,
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
    'flow_get',
    {
      description:
        'Get one flow definition + ordered steps. Same JSON as Hub GET /api/v1/flows/{id}.',
      inputSchema: {
        flow_id: z.string().describe('Flow id (flow_<slug>)'),
        version: z.string().optional().describe('Pin semver version; default latest visible'),
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
        const result = handleFlowGetRequest({
          dataDir: config.data_dir,
          vaultId,
          flowId: args.flow_id,
          cliScopes,
          version: args.version,
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
    'flow_project',
    {
      description:
        'Derive a read-only harness projection of a canonical flow. Same JSON as Hub GET /api/v1/flows/{id}/projection.',
      inputSchema: {
        flow_id: z.string().describe('Flow id (flow_<slug>)'),
        harness: z
          .enum(['cursor_rule', 'cursor_skill', 'mcp_prompt', 'cli_runbook', 'agent_bundle'])
          .describe('Target harness format'),
        version: z.string().optional().describe('Pin semver version; default latest visible'),
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
        const result = handleFlowProjectRequest({
          dataDir: config.data_dir,
          vaultId,
          flowId: args.flow_id,
          harness: args.harness,
          cliScopes,
          version: args.version,
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
    'flow_propose',
    {
      description:
        'Propose a new or edited Flow as a reviewable proposal (review-before-write). ' +
        'Same handler as Hub POST /api/v1/flows (+/{id}/proposals). Gated by FLOW_AUTHORING_WRITES (default off).',
      inputSchema: {
        flow: z.record(z.string(), z.unknown()).describe('knowtation.flow/v0 record (full)'),
        steps: z.array(z.unknown()).describe('knowtation.flow_step/v0[] (full anatomy)'),
        intent: z.string().describe('Required review intent (untrusted; never executed)'),
        base_version: z.string().optional().describe('Required for an edit; omit for new'),
        base_state_id: z.string().optional().describe('Required for an edit (flowst1_ token)'),
        vault_id: z.string().optional().describe('Vault id (default from config)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const cliScopes = Array.isArray(config.flow?.visible_scopes) ? config.flow.visible_scopes : undefined;
        const isEdit =
          typeof args.base_version === 'string' && args.base_version.trim().length > 0;
        const result = await handleFlowProposeRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          kind: isEdit ? 'edit' : 'new',
          flow: args.flow,
          steps: args.steps,
          intent: args.intent,
          flowId: args.flow && typeof args.flow === 'object' ? args.flow.flow_id : undefined,
          baseVersion: args.base_version,
          baseStateId: args.base_state_id,
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
    'flow_import',
    {
      description:
        'Import a portable Flow bundle as a scope-checked reviewable proposal. ' +
        'Same handler as Hub POST /api/v1/flows/import. Gated by FLOW_AUTHORING_WRITES (default off).',
      inputSchema: {
        bundle: z
          .object({ flow: z.record(z.string(), z.unknown()), steps: z.array(z.unknown()) })
          .describe('Portable { flow, steps } bundle'),
        intent: z.string().describe('Required review intent (untrusted; never executed)'),
        external_ref: z.string().optional().describe('Lineage pointer (label only)'),
        source_vault_hint: z.string().optional().describe('Source vault hint (label only)'),
        vault_id: z.string().optional().describe('Vault id (default from config)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const cliScopes = Array.isArray(config.flow?.visible_scopes) ? config.flow.visible_scopes : undefined;
        const result = await handleFlowProposeRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          kind: 'import',
          bundle: args.bundle,
          intent: args.intent,
          externalRef: args.external_ref,
          sourceVaultHint: args.source_vault_hint,
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
    'flow_capture',
    {
      description:
        'Flow capture flywheel — observe session signals, list candidates, propose promotion, or dismiss. ' +
        'Detection gated by FLOW_CAPTURE_DETECTION_ENABLED; writes gated by FLOW_CAPTURE_WRITES_ENABLED (both default off).',
      inputSchema: {
        action: z.enum(['observe', 'list', 'propose', 'dismiss']).describe('Capture action'),
        session_meta: z.record(z.string(), z.unknown()).optional().describe('Content-minimized session meta for observe'),
        candidate_id: z.string().optional().describe('Candidate id for propose/dismiss'),
        confirmed_scope: z.enum(['personal', 'project', 'org']).optional().describe('User-confirmed scope for propose'),
        scope_widen_acknowledged: z.boolean().optional().describe('Required when confirmed_scope > scope_hint'),
        allow_low_confidence: z.boolean().optional().describe('Allow promoting low-confidence candidates'),
        force_new_flow: z.boolean().optional().describe('Force new Flow when dedup overlap is high'),
        merge_into_flow_id: z.string().optional().describe('Target flow for merge proposal'),
        include_low_confidence: z.boolean().optional().describe('Include low-confidence in observe/list'),
        intent: z.string().optional().describe('Untrusted review intent for propose/dismiss'),
        scope: z.enum(['personal', 'project', 'org']).optional().describe('Scope filter for list'),
        limit: z.number().int().min(1).max(50).optional().describe('List cap'),
        vault_id: z.string().optional().describe('Vault id (default from config)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const cliScopes = Array.isArray(config.flow?.visible_scopes) ? config.flow.visible_scopes : undefined;
        const base = {
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          config,
        };

        if (args.action === 'observe') {
          const result = handleFlowCaptureObserveRequest({
            ...base,
            sessionMeta: args.session_meta ?? {},
            includeLowConfidence: args.include_low_confidence === true,
            harness: 'mcp',
          });
          if (!result.ok) return jsonError(result.error, result.code);
          return jsonResponse(result.payload);
        }

        if (args.action === 'list') {
          const result = handleFlowCaptureListRequest({
            ...base,
            scope: args.scope,
            includeLowConfidence: args.include_low_confidence === true,
            limit: args.limit,
          });
          if (!result.ok) return jsonError(result.error, result.code);
          return jsonResponse(result.payload);
        }

        if (args.action === 'propose') {
          const result = await handleFlowCaptureProposeRequest({
            ...base,
            candidateId: args.candidate_id,
            confirmedScope: args.confirmed_scope,
            scopeWidenAcknowledged: args.scope_widen_acknowledged === true,
            allowLowConfidence: args.allow_low_confidence === true,
            forceNewFlow: args.force_new_flow === true,
            mergeIntoFlowId: args.merge_into_flow_id,
            intent: args.intent,
            createProposal,
          });
          if (!result.ok) return jsonError(result.error, result.code);
          return jsonResponse(result.payload);
        }

        const result = await handleFlowCaptureDismissRequest({
          ...base,
          candidateId: args.candidate_id,
          intent: args.intent,
          createProposal,
        });
        if (!result.ok) return jsonError(result.error, result.code);
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );

  server.registerTool(
    'flow_external_grant_mint',
    {
      description:
        'Mint a short-lived external-agent grant for a pinned flow version. Gated by FLOW_EXTERNAL_AGENT_ENABLED (default off).',
      inputSchema: {
        flow_id: z.string().describe('Flow id (flow_<slug>)'),
        flow_version: z.string().describe('Pinned semver version'),
        requested_tools: z.array(z.string()).min(1).describe('Tool ids ⊆ vault allowlist ∩ flow external_tool refs'),
        ttl_seconds: z.number().int().positive().optional().describe('TTL capped by policy'),
        actor_label: z.string().optional().describe('Untrusted label; stored hashed only'),
        vault_id: z.string().optional().describe('Vault id (default from config)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const cliScopes = Array.isArray(config.flow?.visible_scopes) ? config.flow.visible_scopes : undefined;
        const result = handleFlowExternalGrantMintRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          flowId: args.flow_id,
          flowVersion: args.flow_version,
          requestedTools: args.requested_tools,
          ttlSeconds: args.ttl_seconds,
          actorLabel: args.actor_label,
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
    'flow_external_grant_revoke',
    {
      description: 'Revoke an external-agent grant immediately. Gated by FLOW_EXTERNAL_AGENT_ENABLED.',
      inputSchema: {
        grant_id: z.string().describe('Grant id (fgrnt_…)'),
        vault_id: z.string().optional().describe('Vault id (default from config)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const result = handleFlowExternalGrantRevokeRequest({
          dataDir: config.data_dir,
          vaultId,
          grantId: args.grant_id,
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
    'flow_external_grant_list',
    {
      description: 'List external-agent grant metadata (no bearer). Gated by FLOW_EXTERNAL_AGENT_ENABLED.',
      inputSchema: {
        flow_id: z.string().optional().describe('Filter by flow id'),
        vault_id: z.string().optional().describe('Vault id (default from config)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const result = handleFlowExternalGrantListRequest({
          dataDir: config.data_dir,
          vaultId,
          flowId: args.flow_id,
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
    'flow_run',
    {
      description:
        'Flow run lifecycle — start/advance/evidence/execute/submit. ' +
        'Gated by FLOW_RUN_WRITES_ENABLED and FLOW_AUTOMATABLE_EXECUTION_ENABLED (default off).',
      inputSchema: {
        action: z
          .enum([
            'start',
            'get',
            'list',
            'advance',
            'evidence',
            'execute_automatable',
            'submit_review',
            'consent_mint',
          ])
          .describe('Run action'),
        flow_id: z.string().optional().describe('Flow id for start/list'),
        flow_version: z.string().optional().describe('Pinned semver for start'),
        run_id: z.string().optional().describe('Run id'),
        step_id: z.string().optional().describe('Step id for advance/evidence/execute'),
        to_status: z
          .enum(['in_progress', 'blocked', 'done', 'skipped'])
          .optional()
          .describe('Target step status for advance'),
        skip_reason: z
          .enum(['policy', 'not_applicable', 'blocked_dependency'])
          .optional()
          .describe('Required when to_status is skipped'),
        evidence_ref: z.string().optional().describe('Evidence pointer id/hash'),
        pointer_kind: z
          .enum(['proposal', 'artifact', 'hash', 'test_result'])
          .optional()
          .describe('Evidence pointer kind'),
        consent_id: z.string().optional().describe('Execution consent id for execute_automatable'),
        model_lane: z.string().optional().describe('Model lane (must be in consent)'),
        dry_run: z.boolean().optional().describe('Validate gates only; no model call'),
        allowed_lanes: z.array(z.string()).optional().describe('Consent mint: allowed lanes'),
        cost_cap_units: z.number().int().positive().optional().describe('Consent mint: cost cap'),
        ttl_seconds: z.number().int().positive().optional().describe('Consent mint: TTL'),
        intent: z.string().optional().describe('Submit-review intent (untrusted)'),
        task_ref: z.string().optional().describe('Optional SD-2 task link at start'),
        external_ref: z.string().optional().describe('Optional lineage pointer at start'),
        vault_id: z.string().optional().describe('Vault id (default from config)'),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const cliScopes = Array.isArray(config.flow?.visible_scopes) ? config.flow.visible_scopes : undefined;
        const result = await handleFlowRunMcpRequest({
          dataDir: config.data_dir,
          vaultId,
          cliScopes,
          action: args.action,
          flow_id: args.flow_id,
          flow_version: args.flow_version,
          run_id: args.run_id,
          step_id: args.step_id,
          to_status: args.to_status,
          skip_reason: args.skip_reason,
          evidence_ref: args.evidence_ref,
          pointer_kind: args.pointer_kind,
          consent_id: args.consent_id,
          model_lane: args.model_lane,
          dry_run: args.dry_run,
          allowed_lanes: args.allowed_lanes,
          cost_cap_units: args.cost_cap_units,
          ttl_seconds: args.ttl_seconds,
          intent: args.intent,
          task_ref: args.task_ref,
          external_ref: args.external_ref,
          createProposal,
          harness: 'mcp',
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
