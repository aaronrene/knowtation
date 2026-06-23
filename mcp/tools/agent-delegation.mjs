/**
 * MCP tools for agent delegation (Phase 7C-6). Gated by DELEGATION_ENABLED (default off).
 *
 * @see docs/AGENT-DELEGATION-V0-SPEC.md
 */

import { z } from 'zod';

import { loadConfig } from '../../lib/config.mjs';
import { createProposal } from '../../hub/proposals-store.mjs';
import {
  handleAgentIdentityRegisterProposeRequest,
  handleAgentIdentityListRequest,
  handleDelegationConsentProposeRequest,
  handleDelegationConsentRevokeRequest,
  handleDelegationGrantMintRequest,
  handleDelegationGrantRevokeRequest,
  handleDelegationGrantListRequest,
  handleDelegationAuditAppendRequest,
} from '../../lib/agent/delegation.mjs';
import { jsonResponse, jsonError } from '../create-server.mjs';

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerAgentDelegationTools(server) {
  server.registerTool(
    'agent_identity_register',
    {
      description:
        'Propose registration of an agent identity (SD-4). Gated by DELEGATION_ENABLED (default off).',
      inputSchema: {
        kind: z.enum(['user_owned', 'org_owned', 'delegate']).describe('Agent kind'),
        agent_id: z.string().optional().describe('Optional stable agent id (agent_<token>)'),
        label: z.string().optional().describe('Display label (untrusted)'),
        scope_ceiling: z.enum(['personal', 'project', 'org']).optional(),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const result = await handleAgentIdentityRegisterProposeRequest({
          dataDir: config.data_dir,
          vaultId,
          userId: config.user_id ?? 'cli-user',
          kind: args.kind,
          agentId: args.agent_id,
          label: args.label,
          scopeCeiling: args.scope_ceiling,
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
    'agent_identity_list',
    {
      description: 'List agent identities. Gated by DELEGATION_ENABLED.',
      inputSchema: {
        kind: z.enum(['user_owned', 'org_owned', 'delegate']).optional(),
        status: z.enum(['active', 'suspended', 'revoked']).optional(),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const result = handleAgentIdentityListRequest({
          dataDir: config.data_dir,
          vaultId,
          kind: args.kind,
          status: args.status,
        });
        if (!result.ok) return jsonError(result.error, result.code);
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );

  server.registerTool(
    'delegation_consent_propose',
    {
      description:
        'Propose delegation consent (SD-4 intent: delegation_consent_create). Gated by DELEGATION_ENABLED.',
      inputSchema: {
        delegate_agent_id: z.string().describe('Agent id to delegate to'),
        scope: z.enum(['personal', 'project', 'org']),
        workspace_id: z.string().optional(),
        allowed_flow_ids: z.array(z.string()).optional(),
        allowed_task_kinds: z.array(z.string()).optional(),
        allowed_task_ids: z.array(z.string()).optional(),
        expires_at: z.string().optional(),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const result = await handleDelegationConsentProposeRequest({
          dataDir: config.data_dir,
          vaultId,
          userId: config.user_id ?? 'cli-user',
          delegateAgentId: args.delegate_agent_id,
          scope: args.scope,
          workspaceId: args.workspace_id,
          allowedFlowIds: args.allowed_flow_ids,
          allowedTaskKinds: args.allowed_task_kinds,
          allowedTaskIds: args.allowed_task_ids,
          expiresAt: args.expires_at,
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
    'delegation_consent_revoke',
    {
      description: 'Revoke delegation consent immediately. Gated by DELEGATION_ENABLED.',
      inputSchema: {
        consent_id: z.string(),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const result = handleDelegationConsentRevokeRequest({
          dataDir: config.data_dir,
          vaultId,
          consentId: args.consent_id,
          userId: config.user_id ?? 'cli-user',
        });
        if (!result.ok) return jsonError(result.error, result.code);
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );

  server.registerTool(
    'delegation_grant_mint',
    {
      description: 'Mint short-lived delegation grant from active consent. Gated by DELEGATION_ENABLED.',
      inputSchema: {
        consent_id: z.string(),
        actor_agent_id: z.string(),
        task_ref: z.string().optional(),
        run_ref: z.string().optional(),
        flow_id: z.string().optional(),
        flow_version: z.string().optional(),
        ttl_seconds: z.number().int().positive().optional(),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const result = handleDelegationGrantMintRequest({
          dataDir: config.data_dir,
          vaultId,
          consentId: args.consent_id,
          actorAgentId: args.actor_agent_id,
          taskRef: args.task_ref,
          runRef: args.run_ref,
          flowId: args.flow_id,
          flowVersion: args.flow_version,
          ttlSeconds: args.ttl_seconds,
        });
        if (!result.ok) return jsonError(result.error, result.code);
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );

  server.registerTool(
    'delegation_grant_revoke',
    {
      description: 'Revoke delegation grant immediately. Gated by DELEGATION_ENABLED.',
      inputSchema: {
        grant_id: z.string(),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const result = handleDelegationGrantRevokeRequest({
          dataDir: config.data_dir,
          vaultId,
          grantId: args.grant_id,
        });
        if (!result.ok) return jsonError(result.error, result.code);
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );

  server.registerTool(
    'delegation_grant_list',
    {
      description: 'List delegation grant metadata (no bearer). Gated by DELEGATION_ENABLED.',
      inputSchema: {
        actor_agent_id: z.string().optional(),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const result = handleDelegationGrantListRequest({
          dataDir: config.data_dir,
          vaultId,
          actorAgentId: args.actor_agent_id,
        });
        if (!result.ok) return jsonError(result.error, result.code);
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );

  server.registerTool(
    'delegation_audit_append',
    {
      description: 'Append pointer-safe delegation audit entry. Gated by DELEGATION_ENABLED.',
      inputSchema: {
        grant_id: z.string(),
        actor_agent_id: z.string(),
        principal_ref: z.string().describe('Server-verified hashed principal ref'),
        action: z.enum([
          'advance_step',
          'complete_task',
          'propose_outcome',
          'invoke_tool',
          'mint_subgrant',
        ]),
        evidence_refs: z.array(z.string()).min(1),
        task_ref: z.string().optional(),
        run_ref: z.string().optional(),
        flow_id: z.string().optional(),
        flow_version: z.string().optional(),
        step_id: z.string().optional(),
        execution_location: z.enum(['local', 'hosted', 'hybrid']).optional(),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const config = loadConfig();
        const vaultId = args.vault_id?.trim() || config.default_vault_id || 'default';
        const result = handleDelegationAuditAppendRequest({
          dataDir: config.data_dir,
          vaultId,
          grantId: args.grant_id,
          actorAgentId: args.actor_agent_id,
          principalRef: args.principal_ref,
          action: args.action,
          evidenceRefs: args.evidence_refs,
          taskRef: args.task_ref,
          runRef: args.run_ref,
          flowId: args.flow_id,
          flowVersion: args.flow_version,
          stepId: args.step_id,
          executionLocation: args.execution_location,
        });
        if (!result.ok) return jsonError(result.error, result.code);
        return jsonResponse(result.payload);
      } catch (e) {
        return jsonError(e.message || String(e), 'RUNTIME_ERROR');
      }
    },
  );
}
