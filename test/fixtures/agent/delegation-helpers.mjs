/**
 * Shared helpers for agent delegation tiers (7C-6).
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  DELEGATION_POLICY_FILE,
  AGENT_IDENTITY_SCHEMA,
  DELEGATION_CONSENT_SCHEMA,
  hashPrincipalRef,
} from '../../../lib/agent/delegation.mjs';

export const TEST_USER_ID = 'test-user-delegation';
export const TEST_PRINCIPAL_REF = hashPrincipalRef(TEST_USER_ID);

/**
 * @param {string} dataDir
 */
export function writeDelegationPolicy(dataDir) {
  const fp = path.join(dataDir, DELEGATION_POLICY_FILE);
  fs.writeFileSync(
    fp,
    JSON.stringify({
      delegation: {
        enabled: true,
        default_ttl_seconds: 3600,
        max_ttl_seconds: 86400,
      },
    }),
    'utf8',
  );
}

/**
 * @param {{ agentId?: string, kind?: string, scopeCeiling?: string }} [opts]
 */
export function makeAgentIdentity(opts = {}) {
  const now = '2026-06-21T00:00:00Z';
  return {
    schema: AGENT_IDENTITY_SCHEMA,
    agent_id: opts.agentId ?? 'agent_tutor_test01',
    kind: opts.kind ?? 'delegate',
    owner_ref: TEST_PRINCIPAL_REF,
    vault_id: 'default',
    scope_ceiling: opts.scopeCeiling ?? 'project',
    label: 'Test tutor',
    status: 'active',
    created: now,
    updated: now,
  };
}

/**
 * @param {{ consentId?: string, agentId?: string, taskIds?: string[], flowIds?: string[] }} [opts]
 */
export function makeDelegationConsent(opts = {}) {
  const now = '2026-06-21T00:00:00Z';
  return {
    schema: DELEGATION_CONSENT_SCHEMA,
    consent_id: opts.consentId ?? 'dcons_test_fall01',
    principal_ref: TEST_PRINCIPAL_REF,
    delegate_agent_id: opts.agentId ?? 'agent_tutor_test01',
    scope: 'project',
    workspace_id: 'ws_class_101',
    allowed_flow_ids: opts.flowIds ?? ['flow_weekly_review'],
    allowed_task_ids: opts.taskIds ?? ['task_hw_week3'],
    expires_at: '2026-12-31T23:59:59Z',
    revoked_at: null,
    evidence_ref: 'proposal:prop_test123',
    created: now,
  };
}
