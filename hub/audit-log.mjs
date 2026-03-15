/**
 * Hub audit log. Appends approve/discard events to data_dir/hub_audit.log.
 */

import fs from 'fs';
import path from 'path';

/**
 * Append an audit entry. Creates data_dir if needed.
 * @param {string} dataDir - Path to data directory
 * @param {{ userId: string, action: 'approve'|'discard', proposalId: string }} entry
 */
export function appendAudit(dataDir, entry) {
  const logPath = path.join(dataDir, 'hub_audit.log');
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    user_id: entry.userId,
    action: entry.action,
    proposal_id: entry.proposalId,
  }) + '\n';
  fs.appendFileSync(logPath, line, 'utf8');
}
