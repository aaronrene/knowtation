import express from 'express';

const REQUIRED_ACTIONS = new Set([
  'metadata_read',
  'proposal_dry_run',
  'conflict_check_dry_run',
  'live_write_denial_check',
]);

function normalizeBooleanFlag(value) {
  return value === true || value === '1' || value === 'true';
}

function configuredEnvironment() {
  return String(
    process.env.SCOOLING_WRITE_BACK_SMOKE_ENV ||
      process.env.KNOWTATION_ENV ||
      process.env.HUB_ENV ||
      '',
  )
    .trim()
    .toLowerCase();
}

function smokeEnabled() {
  return normalizeBooleanFlag(process.env.SCOOLING_WRITE_BACK_SMOKE_ENABLED);
}

function validSmokeRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const allowed = new Set([
    'requestId',
    'targetId',
    'kind',
    'environment',
    'vaultId',
    'actions',
    'includeRawCredentials',
    'allowLiveWrite',
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) return false;
  if (typeof body.requestId !== 'string' || body.requestId.trim() === '') return false;
  if (typeof body.targetId !== 'string' || body.targetId.trim() === '') return false;
  if (body.kind !== 'hosted_knowtation') return false;
  if (body.environment !== 'staging') return false;
  if (typeof body.vaultId !== 'string' || body.vaultId.trim() === '') return false;
  if (body.includeRawCredentials !== false) return false;
  if (body.allowLiveWrite !== false) return false;
  if (!Array.isArray(body.actions) || body.actions.length !== REQUIRED_ACTIONS.size) return false;
  return body.actions.every((action) => REQUIRED_ACTIONS.has(action)) &&
    new Set(body.actions).size === REQUIRED_ACTIONS.size;
}

async function canisterMetadataAvailable({ canisterUrl, fetchImpl }) {
  if (!canisterUrl) return false;
  try {
    const response = await fetchImpl(`${canisterUrl.replace(/\/$/, '')}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return response.ok === true;
  } catch (_) {
    return false;
  }
}

function createScoolingWriteBackSmokeRouter({
  canisterUrl = process.env.CANISTER_URL || '',
  fetchImpl = globalThis.fetch,
  nowIso = () => new Date().toISOString(),
  isEnabled = smokeEnabled,
  environment = configuredEnvironment,
} = {}) {
  const router = express.Router();

  router.post('/scooling/write-back/smoke', async (req, res) => {
    if (!isEnabled() || environment() !== 'staging') {
      return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    }

    if (!validSmokeRequest(req.body)) {
      return res.status(400).json({
        error: 'Invalid metadata-only Scooling smoke request.',
        code: 'BAD_REQUEST',
        containsRawCredentials: false,
        performedLiveWrite: false,
      });
    }

    const metadataAvailable = await canisterMetadataAvailable({ canisterUrl, fetchImpl });
    if (!metadataAvailable) {
      return res.status(503).json({
        error: 'Hosted Knowtation canister metadata is unavailable.',
        code: 'SERVICE_UNAVAILABLE',
        containsRawCredentials: false,
        performedLiveWrite: false,
      });
    }

    return res.json({
      ok: true,
      checkedAtIso: nowIso(),
      targetId: req.body.targetId,
      metadataRead: true,
      proposalDryRun: true,
      conflictCheckDryRun: true,
      liveWriteDenied: true,
      containsRawCredentials: false,
      performedLiveWrite: false,
    });
  });

  return router;
}

export {
  createScoolingWriteBackSmokeRouter,
  validSmokeRequest,
};
