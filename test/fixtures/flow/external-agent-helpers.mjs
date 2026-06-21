/**
 * Shared helpers for Flow external-agent tiers (7A-L2b).
 */
import fs from 'node:fs';
import path from 'node:path';

import { buildFlowStepId } from '../../../lib/flow/flow-store.mjs';
import { FLOW_EXTERNAL_AGENT_POLICY_FILE } from '../../../lib/flow/external-agent.mjs';

/**
 * @param {string} dataDir
 * @param {string[]} [allowedTools]
 */
export function writeExternalAgentPolicy(dataDir, allowedTools = ['web_search']) {
  const fp = path.join(dataDir, FLOW_EXTERNAL_AGENT_POLICY_FILE);
  fs.writeFileSync(
    fp,
    JSON.stringify({
      external_agent: {
        enabled: true,
        hosted_projection_enabled: true,
        allowed_tools: allowedTools.map((id) => ({ id, description: id })),
        default_ttl_seconds: 3600,
        max_ttl_seconds: 86400,
        import_policy: 'reject',
      },
    }),
    'utf8',
  );
}

/**
 * @param {{ flowId?: string, toolId?: string, scope?: string, version?: string }} [opts]
 */
export function makeExternalToolFlowBundle(opts = {}) {
  const flowId = opts.flowId ?? 'flow_ext_agent_test';
  const toolId = opts.toolId ?? 'web_search';
  const scope = opts.scope ?? 'personal';
  const version = opts.version ?? '1.0.0';
  const stepId = buildFlowStepId(flowId, 1);
  return {
    flow: {
      schema: 'knowtation.flow/v0',
      flow_id: flowId,
      title: 'External agent test flow',
      version,
      scope,
      summary: 'Flow with external_tool ref for grant tests.',
      tags: ['test'],
      steps: [stepId],
      inputs: [],
      vault_mirror_path: `meta/flows/${flowId.replace(/^flow_/, '')}.md`,
      updated: '2026-06-20T00:00:00Z',
      truncated: false,
    },
    steps: [
      {
        schema: 'knowtation.flow_step/v0',
        step_id: stepId,
        flow_id: flowId,
        ordinal: 1,
        owned_job: 'Search the web',
        instruction: 'Use the scoped web search tool when needed.',
        trigger: 'On request',
        when_not_to_run: 'When offline',
        boundaries: ['Read only'],
        skill_refs: [{ kind: 'external_tool', id: toolId }],
        output_shape: 'Search summary',
        verification: {
          kind: 'human_review',
          evidence_required: true,
          description: 'Human checks results',
        },
        automatable: 'manual',
      },
    ],
  };
}
