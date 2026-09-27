import crypto from 'node:crypto';

const HEX_256 = /^[0-9a-f]{64}$/;

function reject(reason) {
  const error = new Error(reason);
  error.code = reason;
  throw error;
}

export function verifyUpdateSignature({ manifestBytes, signature, publicKey }) {
  if (!Buffer.isBuffer(manifestBytes) || !Buffer.isBuffer(signature)) {
    return false;
  }
  try {
    return crypto.verify(null, manifestBytes, publicKey, signature);
  } catch {
    return false;
  }
}

export function parseUpdateManifest(manifestBytes) {
  if (!Buffer.isBuffer(manifestBytes) || manifestBytes.length === 0 || manifestBytes.length > 131_072) {
    reject('update_manifest_malformed');
  }
  let value;
  try {
    value = JSON.parse(manifestBytes.toString('utf8'));
  } catch {
    reject('update_manifest_malformed');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    reject('update_manifest_malformed');
  }
  return value;
}

export function evaluateUpdateManifest(manifest, context) {
  if (manifest?.schema !== 1) reject('update_schema_unsupported');
  if (manifest.channel !== context.channel) reject('update_channel_mismatch');
  if (manifest.platform !== context.platform) reject('update_platform_mismatch');
  if (manifest.architecture !== context.architecture) reject('update_architecture_mismatch');
  if (manifest.keyID !== context.keyID) reject('update_key_mismatch');
  if (!Number.isSafeInteger(manifest.issuedAt) || manifest.issuedAt > context.now) reject('update_not_yet_valid');
  if (!Number.isSafeInteger(manifest.expiresAt) || manifest.expiresAt < context.now || manifest.expiresAt <= manifest.issuedAt) {
    reject('update_expired');
  }
  if (!Number.isSafeInteger(manifest.source?.minimumBuild) ||
      !Number.isSafeInteger(manifest.source?.maximumBuild) ||
      context.currentBuild < manifest.source.minimumBuild ||
      context.currentBuild > manifest.source.maximumBuild) {
    reject('update_source_mismatch');
  }
  if (!Number.isSafeInteger(manifest.target?.build) || manifest.target.build <= context.currentBuild) {
    reject('update_target_not_newer');
  }
  const floor = Math.max(context.persistedFloor, manifest.minimumAcceptedBuild);
  if (!Number.isSafeInteger(floor) || manifest.target.build < floor) reject('update_rollback_rejected');
  if (typeof manifest.target.version !== 'string' || !manifest.target.version ||
      typeof manifest.target.packageURL !== 'string' ||
      !manifest.target.packageURL.startsWith('https://') ||
      !HEX_256.test(manifest.target.packageSHA256 ?? '') ||
      !Number.isSafeInteger(manifest.target.packageBytes) || manifest.target.packageBytes <= 0) {
    reject('update_package_invalid');
  }
  return Object.freeze({ ...manifest.target, acceptedFloor: floor });
}

export async function readPersistedUpdateFloor(custody) {
  const raw = await custody.get('knowtation.companion.updateFloor');
  if (raw === null) return 0;
  if (!/^[0-9]+$/.test(raw)) reject('update_floor_invalid');
  const floor = Number(raw);
  if (!Number.isSafeInteger(floor)) reject('update_floor_invalid');
  return floor;
}

export async function persistUpdateFloor(custody, build, previousFloor = 0) {
  if (!Number.isSafeInteger(build) || build < previousFloor) reject('update_rollback_rejected');
  await custody.set('knowtation.companion.updateFloor', String(build));
}
