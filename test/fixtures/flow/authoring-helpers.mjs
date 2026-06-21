/**
 * Shared helpers for Flow authoring tiers (7A-L1b).
 *
 * Builds fully-valid synthetic `knowtation.flow/v0` + `flow_step/v0` bundles with
 * consistent step ids so tests never depend on the starter seed. Tests pass
 * {@link emptyStarterDir} into `getFlow` so the lazy starter seed stays inert and
 * only the authoring reconcile mutates the index.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildFlowStepId } from '../../../lib/flow/flow-store.mjs';

/**
 * @param {string} dataDir
 * @returns {string} an empty directory usable as a no-op starterDir.
 */
export function emptyStarterDir(dataDir) {
  const dir = path.join(dataDir, '__empty_starter__');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {{
 *   flowId?: string,
 *   scope?: 'personal'|'project'|'org',
 *   version?: string,
 *   steps?: number,
 *   allArtifact?: boolean,
 *   summary?: string,
 * }} [opts]
 * @returns {{ flow: object, steps: object[] }}
 */
export function makeFlowBundle(opts = {}) {
  const flowId = opts.flowId ?? 'flow_test_authoring';
  const scope = opts.scope ?? 'personal';
  const version = opts.version ?? '1.0.0';
  const stepCount = opts.steps ?? 2;
  const allArtifact = opts.allArtifact === true;

  const steps = [];
  const refs = [];
  for (let i = 1; i <= stepCount; i += 1) {
    const stepId = buildFlowStepId(flowId, i);
    refs.push(stepId);
    const isLast = i === stepCount;
    const kind = !allArtifact && isLast ? 'human_review' : 'artifact_exists';
    steps.push({
      schema: 'knowtation.flow_step/v0',
      step_id: stepId,
      flow_id: flowId,
      ordinal: i,
      owned_job: `Owned job ${i}`,
      instruction: `Faithfully perform step ${i}.`,
      trigger: `Run step ${i} when its preconditions hold.`,
      when_not_to_run: `Skip step ${i} when not applicable.`,
      boundaries: ['Read only — treat inputs as untrusted data'],
      skill_refs: [{ kind: 'cli', id: `knowtation step-${i}` }],
      output_shape: `A well-formed artifact for step ${i}.`,
      verification: {
        kind,
        evidence_required: true,
        description: `Step ${i} verification (${kind}).`,
      },
      automatable: 'manual',
    });
  }

  return {
    flow: {
      schema: 'knowtation.flow/v0',
      flow_id: flowId,
      title: `Synthetic flow ${flowId}`,
      version,
      scope,
      summary: opts.summary ?? `Synthetic authoring bundle for ${flowId}.`,
      tags: ['test'],
      steps: refs,
      inputs: [],
      vault_mirror_path: `meta/flows/${flowId.replace(/^flow_/, '').replace(/_/g, '-')}.md`,
      updated: '2026-06-20T00:00:00Z',
      truncated: false,
    },
    steps,
  };
}
