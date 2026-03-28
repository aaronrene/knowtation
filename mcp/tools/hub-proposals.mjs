/**
 * Hub proposal tools — require KNOWTATION_HUB_URL and KNOWTATION_HUB_TOKEN (JWT).
 */

import { z } from 'zod';
import { jsonResponse, jsonError } from '../create-server.mjs';

function hubBase() {
  const u = (process.env.KNOWTATION_HUB_URL || '').trim().replace(/\/$/, '');
  return u || '';
}

function hubHeaders(vaultId) {
  const token = (process.env.KNOWTATION_HUB_TOKEN || '').trim();
  if (!token) throw new Error('KNOWTATION_HUB_TOKEN is not set');
  const h = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };
  const vid = (vaultId || process.env.KNOWTATION_HUB_VAULT_ID || '').trim();
  if (vid) h['X-Vault-Id'] = vid;
  return h;
}

async function hubFetch(path, { method = 'GET', body, vaultId } = {}) {
  const base = hubBase();
  if (!base) throw new Error('KNOWTATION_HUB_URL is not set');
  const res = await fetch(base + path, {
    method,
    headers: hubHeaders(vaultId),
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text.slice(0, 200) };
  }
  if (!res.ok) {
    const msg = data?.error || res.statusText || 'Hub request failed';
    const err = new Error(msg);
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerHubProposalTools(server) {
  server.registerTool(
    'hub_list_proposals',
    {
      description:
        'List proposals on the Knowtation Hub (requires KNOWTATION_HUB_URL + KNOWTATION_HUB_TOKEN). Respects Hub roles.',
      inputSchema: {
        status: z.enum(['proposed', 'approved', 'discarded']).optional(),
        limit: z.number().optional(),
        offset: z.number().optional(),
        label: z.string().optional(),
        source: z.string().optional(),
        path_prefix: z.string().optional(),
        evaluation_status: z
          .enum(['none', 'pending', 'passed', 'failed', 'needs_changes'])
          .optional()
          .describe('Filter by proposal evaluation_status'),
        review_queue: z.string().optional().describe('Filter by review_queue metadata'),
        review_severity: z.enum(['standard', 'elevated']).optional().describe('Filter by review_severity'),
        vault_id: z.string().optional().describe('Sets X-Vault-Id when provided'),
      },
    },
    async (args) => {
      try {
        const q = new URLSearchParams();
        if (args.status) q.set('status', args.status);
        q.set('limit', String(args.limit ?? 20));
        if (args.offset != null) q.set('offset', String(args.offset));
        if (args.label) q.set('label', args.label);
        if (args.source) q.set('source', args.source);
        if (args.path_prefix) q.set('path_prefix', args.path_prefix);
        if (args.evaluation_status) q.set('evaluation_status', args.evaluation_status);
        if (args.review_queue) q.set('review_queue', args.review_queue);
        if (args.review_severity) q.set('review_severity', args.review_severity);
        const path = '/api/v1/proposals?' + q.toString();
        const out = await hubFetch(path, { vaultId: args.vault_id });
        return jsonResponse(out);
      } catch (e) {
        return jsonError(e.message || String(e), e.code || 'HUB_ERROR');
      }
    },
  );

  server.registerTool(
    'hub_get_proposal',
    {
      description: 'Get one proposal by id from the Hub (metadata + body + frontmatter).',
      inputSchema: {
        proposal_id: z.string().describe('Proposal UUID from hub_list_proposals'),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const out = await hubFetch('/api/v1/proposals/' + encodeURIComponent(args.proposal_id), {
          vaultId: args.vault_id,
        });
        return jsonResponse(out);
      } catch (e) {
        return jsonError(e.message || String(e), e.code || 'HUB_ERROR');
      }
    },
  );

  server.registerTool(
    'hub_create_proposal',
    {
      description:
        'Create a proposal on the Hub (editor/admin JWT). Sends path, body, frontmatter, optional intent, base_state_id, labels, source, external_ref.',
      inputSchema: {
        path: z.string().describe('Vault-relative note path'),
        body: z.string().optional(),
        frontmatter: z.record(z.unknown()).optional(),
        intent: z.string().optional(),
        base_state_id: z.string().optional().describe('kn1_… id from hub note state for optimistic concurrency'),
        external_ref: z.string().optional(),
        labels: z.array(z.string()).optional(),
        source: z.string().optional(),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const payload = {
          path: args.path,
          body: args.body ?? '',
          frontmatter: args.frontmatter ?? {},
          intent: args.intent,
          base_state_id: args.base_state_id,
          external_ref: args.external_ref,
          labels: args.labels,
          source: args.source,
        };
        const out = await hubFetch('/api/v1/proposals', {
          method: 'POST',
          body: payload,
          vaultId: args.vault_id,
        });
        return jsonResponse(out);
      } catch (e) {
        return jsonError(e.message || String(e), e.code || 'HUB_ERROR');
      }
    },
  );

  server.registerTool(
    'hub_submit_proposal_evaluation',
    {
      description:
        'Submit a human evaluation for a Hub proposal (admin JWT). Requires KNOWTATION_HUB_URL + KNOWTATION_HUB_TOKEN. Outcome pass|fail|needs_changes; comment required for fail and needs_changes; checklist items must all pass for outcome pass when checklist is non-empty.',
      inputSchema: {
        proposal_id: z.string().describe('Proposal id from hub_list_proposals'),
        outcome: z.enum(['pass', 'fail', 'needs_changes']),
        checklist: z
          .array(z.object({ id: z.string(), passed: z.boolean() }))
          .optional()
          .describe('Rubric row toggles; ids should match GET /settings proposal_rubric.items'),
        grade: z.string().optional(),
        comment: z.string().optional(),
        vault_id: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const payload = {
          outcome: args.outcome,
          checklist: args.checklist,
          grade: args.grade,
          comment: args.comment,
        };
        const out = await hubFetch(
          '/api/v1/proposals/' + encodeURIComponent(args.proposal_id) + '/evaluation',
          { method: 'POST', body: payload, vaultId: args.vault_id },
        );
        return jsonResponse(out);
      } catch (e) {
        return jsonError(e.message || String(e), e.code || 'HUB_ERROR');
      }
    },
  );
}
