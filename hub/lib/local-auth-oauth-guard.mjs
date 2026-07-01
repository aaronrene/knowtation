/**
 * Phase 8 P1b-b — OAuth fail-closed guards when offline-locked auth is active (§6.3).
 */

import { appendLocalAuthAudit } from './local-auth-audit.mjs';
import { requestAuditMeta } from './local-auth-audit.mjs';

/**
 * Express middleware: block OAuth routes when offline-locked auth is active.
 * @param {boolean} offlineLockedActive
 * @param {string} [dataDir]
 * @returns {import('express').RequestHandler}
 */
export function oauthDisabledGuard(offlineLockedActive, dataDir = '') {
  return (req, res, next) => {
    if (!offlineLockedActive) return next();
    const { ip } = requestAuditMeta(req);
    if (dataDir) {
      appendLocalAuthAudit(dataDir, 'local_auth.oauth_blocked', {
        route: req.path,
        ip,
        ts: new Date().toISOString(),
      });
    }
    return res.status(403).json({
      error: 'OAuth disabled in offline-locked mode',
      code: 'OAUTH_DISABLED',
    });
  };
}

/**
 * Log bootstrap instruction once at boot when gate on but not bootstrapped (§2.3).
 * @param {boolean} offlineLockedActive
 * @param {boolean} bootstrapped
 */
export function logBootstrapInstructionOnce(offlineLockedActive, bootstrapped) {
  if (!offlineLockedActive || bootstrapped) return;
  if (globalThis.__knowtation_offline_locked_bootstrap_logged) return;
  globalThis.__knowtation_offline_locked_bootstrap_logged = true;
  console.log(
    '[hub] KNOWTATION_OFFLINE_LOCKED_AUTH=enabled but no local admin bootstrapped. ' +
      'Run: node cli/index.mjs auth bootstrap-admin --username admin  OR  auth generate-setup-token'
  );
}
