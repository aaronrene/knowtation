/**
 * Shared helpers for task-write seven-tier tests.
 */
import fs from 'node:fs';
import path from 'node:path';

import {
  precheckApprovedTaskProposal,
  reconcileApprovedTaskProposal,
} from '../../../lib/task/task-write.mjs';
import { getProposal, updateProposalStatus } from '../../../hub/proposals-store.mjs';
import { getRepoRoot } from '../../../lib/repo-root.mjs';

export const visibleAll = new Set(['personal', 'project', 'org']);

/**
 * @param {string} dataDir
 * @returns {string}
 */
export function emptyTaskStarterDir(dataDir) {
  const d = path.join(dataDir, 'empty-starter');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/**
 * @param {string} dataDir
 * @param {string} proposalId
 */
export function approveTaskProposal(dataDir, proposalId) {
  const proposal = getProposal(dataDir, proposalId);
  const pre = precheckApprovedTaskProposal(dataDir, proposal);
  if (!pre.ok) return pre;
  reconcileApprovedTaskProposal(dataDir, pre);
  updateProposalStatus(dataDir, proposalId, 'approved');
  return { ok: true, pre };
}

/**
 * @returns {object}
 */
export function sampleTaskCreatePayload() {
  return {
    proposal_kind: 'task_create',
    intent: 'Add personal practice goal',
    task: {
      task_id: 'task_practice_june',
      kind: 'personal',
      scope: 'personal',
      title: 'Daily scale practice',
      workspace_id: 'ws_personal',
      due_at: '2026-06-30T17:00:00.000Z',
      assignee_ref: null,
      assigner_ref: null,
      artifact_links: [],
    },
  };
}

/**
 * @returns {object}
 */
export function sampleLoopCreatePayload() {
  return {
    proposal_kind: 'task_loop_create',
    intent: 'Weekly mentor check-in series',
    loop: {
      loop_id: 'loop_mentor_w25',
      kind: 'mentor_checkin',
      scope: 'personal',
      title: 'Weekly mentor check-in',
      workspace_id: 'ws_personal',
      status: 'active',
      recurrence: {
        kind: 'interval',
        every: 1,
        unit: 'week',
        anchor_at: '2026-06-23T09:00:00.000Z',
      },
      timezone: 'America/Los_Angeles',
      flow_id: null,
      boundary_policy: 'propose_only',
      memory_links: [],
      handoff_refs: [],
      until_at: null,
    },
  };
}

export const loopStarterDir = path.join(getRepoRoot(), 'task-loops/starter');
