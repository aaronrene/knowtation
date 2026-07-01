/**
 * Phase 8 P1b-b — local auth audit events (§7.3). No secrets in logs.
 */

import fs from 'fs';
import path from 'path';

/**
 * Append a local-auth audit event to data_dir/hub_audit.log.
 * @param {string} dataDir
 * @param {string} eventName
 * @param {Record<string, unknown>} fields
 */
export function appendLocalAuthAudit(dataDir, eventName, fields) {
  if (!dataDir) return;
  const logPath = path.join(dataDir, 'hub_audit.log');
  const dir = path.dirname(logPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      event: eventName,
      ...fields,
    }) + '\n';
  fs.appendFileSync(logPath, line, 'utf8');
}

/**
 * @param {import('express').Request} req
 * @returns {{ ip: string, ua: string }}
 */
export function requestAuditMeta(req) {
  const ip =
    (typeof req.ip === 'string' && req.ip) ||
    (typeof req.headers['x-forwarded-for'] === 'string'
      ? req.headers['x-forwarded-for'].split(',')[0].trim()
      : '') ||
    'unknown';
  const ua = String(req.headers['user-agent'] || '').slice(0, 256);
  return { ip, ua };
}
