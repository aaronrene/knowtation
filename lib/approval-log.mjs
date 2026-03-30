/**
 * Materialized approval logs: thin vault markdown under approvals/ (indexed like notes).
 * Default prefix avoids lib/config DEFAULT_IGNORE of folder name "meta".
 */

export const APPROVAL_LOG_PREFIX = 'approvals';

/**
 * @param {string} path - vault-relative path
 * @returns {boolean}
 */
export function isApprovalLogPath(path) {
  if (path == null || typeof path !== 'string') return false;
  const n = path.replace(/\\/g, '/');
  return n === APPROVAL_LOG_PREFIX || n.startsWith(`${APPROVAL_LOG_PREFIX}/`);
}

/**
 * @param {{ path?: string, frontmatter?: Record<string, unknown> } | null | undefined} note
 * @returns {boolean}
 */
export function isApprovalLogNote(note) {
  if (!note) return false;
  if (isApprovalLogPath(note.path)) return true;
  const k = note.frontmatter && note.frontmatter.kind;
  return String(k) === 'approval_log';
}

/**
 * @param {string} proposalId
 * @param {string} [approvedAtIso] - ISO timestamp (date prefix from first 10 chars)
 * @returns {string} vault-relative path
 */
export function approvalLogRelativePath(proposalId, approvedAtIso = new Date().toISOString()) {
  const day = String(approvedAtIso).slice(0, 10) || '1970-01-01';
  const safeId = String(proposalId)
    .replace(/[^a-zA-Z0-9-]/g, '_')
    .slice(0, 80);
  return `${APPROVAL_LOG_PREFIX}/${day}-${safeId}.md`;
}

function trunc(s, max) {
  if (s == null || typeof s !== 'string') return '';
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max) + '…';
}

/**
 * Payload for writeNote (string frontmatter values).
 * @param {{
 *   proposalId: string,
 *   targetPath: string,
 *   approvedAt: string,
 *   approvedBy?: string,
 *   proposedBy?: string,
 *   intent?: string,
 *   source?: string,
 *   proposedBodyExcerpt?: string,
 * }} p
 * @returns {{ relativePath: string, frontmatter: Record<string, string>, body: string }}
 */
const MAX_PROPOSAL_EXCERPT = 4000;

export function buildApprovalLogWrite(p) {
  const relativePath = approvalLogRelativePath(p.proposalId, p.approvedAt);
  const targetPath = String(p.targetPath || '').trim() || 'unknown';
  const frontmatter = {
    kind: 'approval_log',
    proposal_id: String(p.proposalId),
    target_path: targetPath,
    approved_at: String(p.approvedAt),
  };
  if (p.approvedBy) frontmatter.approved_by = String(p.approvedBy).trim().slice(0, 512);
  if (p.proposedBy) frontmatter.proposed_by = String(p.proposedBy).trim().slice(0, 512);
  const intentT = trunc(p.intent, 400);
  if (intentT) frontmatter.intent = intentT;
  const sourceT = trunc(p.source, 120);
  if (sourceT) frontmatter.source = sourceT;

  const safeTitle = targetPath.replace(/`/g, "'");
  const bodyLines = [
    `Approved vault change applied to \`${safeTitle}\`.`,
    '',
    `- **Proposal ID:** ${p.proposalId}`,
    `- **Approved at:** ${p.approvedAt}`,
  ];
  if (intentT) bodyLines.push(`- **Intent (summary):** ${intentT}`);

  let body = bodyLines.join('\n');
  const ex =
    p.proposedBodyExcerpt != null && String(p.proposedBodyExcerpt).trim()
      ? String(p.proposedBodyExcerpt)
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, MAX_PROPOSAL_EXCERPT)
      : '';
  if (ex) {
    body += '\n\n## Proposal excerpt (for search)\n\n' + ex + '\n';
  }

  return {
    relativePath,
    frontmatter,
    body,
  };
}

/**
 * Filter search hits / results by content scope (path-only; no disk read).
 * @param {{ path: string }[]} hits
 * @param {'all'|'notes'|'approval_logs'} scope
 * @returns {{ path: string }[]}
 */
export function filterHitsByContentScope(hits, scope) {
  if (!hits || !scope || scope === 'all') return hits || [];
  if (scope === 'approval_logs') return hits.filter((h) => h && isApprovalLogPath(h.path));
  if (scope === 'notes') return hits.filter((h) => h && !isApprovalLogPath(h.path));
  return hits;
}

/**
 * Map content_scope to vector-store folder prefix so ANN runs include path-restricted chunks.
 * Post-filtering global top-k alone drops approval-log chunks when their similarity ranks below k.
 * @param {'all'|'notes'|'approval_logs'|undefined} content_scope
 * @param {string|undefined} userFolder - Hub folder filter (vault-relative prefix)
 * @returns {{ folder?: string, wideNotesFetch: boolean, impossible: boolean }}
 */
export function resolveSearchFolderForContentScope(content_scope, userFolder) {
  const cs = content_scope || 'all';
  const uf =
    userFolder != null && String(userFolder).trim()
      ? String(userFolder).trim().replace(/\\/g, '/').replace(/\/$/, '')
      : '';
  if (cs === 'all') {
    return { folder: uf || undefined, wideNotesFetch: false, impossible: false };
  }
  if (cs === 'approval_logs') {
    if (uf && uf !== APPROVAL_LOG_PREFIX && !uf.startsWith(`${APPROVAL_LOG_PREFIX}/`)) {
      return { wideNotesFetch: false, impossible: true };
    }
    return { folder: uf || APPROVAL_LOG_PREFIX, wideNotesFetch: false, impossible: false };
  }
  if (cs === 'notes') {
    return { folder: uf || undefined, wideNotesFetch: true, impossible: false };
  }
  return { folder: uf || undefined, wideNotesFetch: false, impossible: false };
}
