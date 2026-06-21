/**
 * Shared helpers for Flow execution gate tiers (7A-L3b).
 */
import fs from 'node:fs';
import path from 'node:path';

import { upsertFlowVersion } from '../../../lib/flow/flow-store.mjs';
import {
  FLOW_EXECUTION_POLICY_FILE,
  makeAutomatableFlowBundle,
} from '../../../lib/flow/flow-execution.mjs';

/**
 * @param {string} dataDir
 * @param {{ runWrites?: boolean, automatable?: boolean, automatableForbidden?: boolean, lanes?: string[], costCap?: number }} [opts]
 */
export function writeExecutionPolicy(dataDir, opts = {}) {
  const fp = path.join(dataDir, FLOW_EXECUTION_POLICY_FILE);
  fs.writeFileSync(
    fp,
    JSON.stringify({
      flow_run_writes_enabled: opts.runWrites ?? true,
      execution: {
        automatable_enabled: opts.automatable ?? true,
        allowed_lanes: opts.lanes ?? ['local_default'],
        automatable_forbidden: opts.automatableForbidden ?? false,
        default_cost_cap_units: opts.costCap ?? 100,
        default_ttl_seconds: 3600,
        max_ttl_seconds: 86400,
      },
    }),
    'utf8',
  );
}

/**
 * Seed an automatable test flow into the vault store.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} [flowId]
 */
export function seedAutomatableFlow(dataDir, vaultId, flowId = 'flow_automatable_test') {
  const bundle = makeAutomatableFlowBundle(undefined, flowId);
  upsertFlowVersion(dataDir, vaultId, bundle.flow, bundle.steps);
  return bundle;
}
