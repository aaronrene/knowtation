/**
 * AIR (attestation) hook: call before write (non-inbox) and before export when air.enabled.
 * SPEC §7. Phase 4: hook point; optional endpoint call.
 */

/**
 * Thrown when air.required=true and attestation fails (endpoint unreachable or returns non-OK).
 * Callers should surface this as a hard write rejection — the write must not proceed.
 */
export class AttestationRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AttestationRequiredError';
    this.code = 'ATTESTATION_REQUIRED';
  }
}

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
 * When air.required=true, a failed endpoint call throws AttestationRequiredError instead of
 * returning a placeholder — the write must not proceed.
 * @param {{ air?: { enabled?: boolean, required?: boolean, endpoint?: string } }} config - from loadConfig()
 * @param {string} vaultRelativePath
 * @returns {Promise<string|null>} - AIR id if attestation obtained, null if skipped
 * @throws {AttestationRequiredError} when air.required=true and attestation cannot be completed
 */
export async function attestBeforeWrite(config, vaultRelativePath) {
  if (!config.air?.enabled) return null;
  if (isInboxPath(vaultRelativePath)) return null;

  const required = config.air.required === true;
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
      if (required) {
        throw new AttestationRequiredError(
          `knowtation: AIR endpoint returned ${res.status} and air.required=true; write rejected.`
        );
      }
    } catch (e) {
      if (e instanceof AttestationRequiredError) throw e;
      if (required) {
        throw new AttestationRequiredError(
          `knowtation: AIR endpoint unreachable and air.required=true; write rejected. (${e.message})`
        );
      }
    }
  } else if (required) {
    throw new AttestationRequiredError(
      'knowtation: air.required=true but no AIR endpoint is configured; write rejected.'
    );
  }

  // No endpoint or call failed and not required: log and return placeholder so write can proceed
  console.error('knowtation: AIR enabled but endpoint not configured or unreachable; logging placeholder.');
  return 'air-placeholder-write';
}

/**
 * If AIR is enabled, obtain attestation before export.
 * When air.required=true, a failed endpoint call throws AttestationRequiredError instead of
 * returning a placeholder — the export must not proceed.
 * @param {{ air?: { enabled?: boolean, required?: boolean, endpoint?: string } }} config
 * @param {string[]} sourcePaths
 * @returns {Promise<string|null>}
 * @throws {AttestationRequiredError} when air.required=true and attestation cannot be completed
 */
export async function attestBeforeExport(config, sourcePaths) {
  if (!config.air?.enabled) return null;

  const required = config.air.required === true;
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
      if (required) {
        throw new AttestationRequiredError(
          `knowtation: AIR endpoint returned ${res.status} and air.required=true; export rejected.`
        );
      }
    } catch (e) {
      if (e instanceof AttestationRequiredError) throw e;
      if (required) {
        throw new AttestationRequiredError(
          `knowtation: AIR endpoint unreachable and air.required=true; export rejected. (${e.message})`
        );
      }
    }
  } else if (required) {
    throw new AttestationRequiredError(
      'knowtation: air.required=true but no AIR endpoint is configured; export rejected.'
    );
  }

  console.error('knowtation: AIR enabled but endpoint not configured or unreachable; logging placeholder.');
  return 'air-placeholder-export';
}
