/**
 * AIR (attestation) hook: call before write (non-inbox) and before export when air.enabled.
 * SPEC §7. Phase 4: hook point; optional endpoint call.
 */

/**
 * Return true if path is under vault inbox (global or project inbox).
 * @param {string} vaultRelativePath
 * @returns {boolean}
 */
function isInboxPath(vaultRelativePath) {
  const n = vaultRelativePath.replace(/\\/g, '/');
  return n === 'inbox' || n.startsWith('inbox/') || /^projects\/[^/]+\/inbox(\/|$)/.test(n);
}

/**
 * If AIR is enabled and path is outside inbox, obtain attestation before write.
 * @param {{ air?: { enabled?: boolean, endpoint?: string } }} config - from loadConfig()
 * @param {string} vaultRelativePath
 * @returns {Promise<string|null>} - AIR id if attestation obtained, null if skipped
 */
export async function attestBeforeWrite(config, vaultRelativePath) {
  if (!config.air?.enabled) return null;
  if (isInboxPath(vaultRelativePath)) return null;

  const endpoint = config.air.endpoint || process.env.KNOWTATION_AIR_ENDPOINT;
  if (endpoint) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'write', path: vaultRelativePath }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return data.id || data.air_id || 'air-write-ok';
      }
    } catch (_) {
      // Fall through to placeholder
    }
  }
  // No endpoint or call failed: log and return placeholder so write can proceed
  console.error('knowtation: AIR enabled but endpoint not configured or unreachable; logging placeholder.');
  return 'air-placeholder-write';
}

/**
 * If AIR is enabled, obtain attestation before export.
 * @param {{ air?: { enabled?: boolean, endpoint?: string } }} config
 * @param {string[]} sourcePaths
 * @returns {Promise<string|null>}
 */
export async function attestBeforeExport(config, sourcePaths) {
  if (!config.air?.enabled) return null;

  const endpoint = config.air.endpoint || process.env.KNOWTATION_AIR_ENDPOINT;
  if (endpoint) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'export', source_notes: sourcePaths }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        return data.id || data.air_id || 'air-export-ok';
      }
    } catch (_) {}
  }
  console.error('knowtation: AIR enabled but endpoint not configured or unreachable; logging placeholder.');
  return 'air-placeholder-export';
}
