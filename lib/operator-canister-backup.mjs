import crypto from 'node:crypto';

/** File magic for AES-256-GCM operator backups (4 bytes). */
export const OPERATOR_BACKUP_MAGIC = Buffer.from('KTB1', 'ascii');

/**
 * @param {string} baseUrl — no trailing slash
 * @param {string} userId — X-User-Id
 * @param {string} vaultId
 * @returns {Promise<object[]>}
 */
export async function fetchNotesFromExport(baseUrl, userId, vaultId) {
  const base = baseUrl.replace(/\/$/, '');
  const r = await fetch(`${base}/api/v1/export`, {
    method: 'GET',
    headers: {
      'X-User-Id': userId,
      'X-Vault-Id': vaultId,
      Accept: 'application/json',
    },
  });
  if (!r.ok) {
    throw new Error(`export ${r.status}`);
  }
  const data = await r.json();
  return Array.isArray(data.notes) ? data.notes : [];
}

/**
 * Full proposal documents (list + GET each id). Operator export: full partition, no team scope filter.
 *
 * @param {string} baseUrl
 * @param {string} userId
 * @param {string} vaultId
 * @returns {Promise<object[]>}
 */
export async function fetchFullProposalsForOperatorExport(baseUrl, userId, vaultId) {
  const base = baseUrl.replace(/\/$/, '');
  const headers = {
    'X-User-Id': userId,
    'X-Vault-Id': vaultId,
    Accept: 'application/json',
  };
  const listRes = await fetch(`${base}/api/v1/proposals`, { method: 'GET', headers });
  if (!listRes.ok) {
    throw new Error(`proposals list ${listRes.status}`);
  }
  const listJson = await listRes.json();
  const stubs = Array.isArray(listJson.proposals) ? listJson.proposals : [];
  const full = [];
  for (const stub of stubs) {
    const id = stub && stub.proposal_id ? String(stub.proposal_id) : '';
    if (!id) continue;
    const oneRes = await fetch(`${base}/api/v1/proposals/${encodeURIComponent(id)}`, {
      method: 'GET',
      headers,
    });
    if (!oneRes.ok) {
      throw new Error(`proposal ${id} ${oneRes.status}`);
    }
    full.push(await oneRes.json());
  }
  return full;
}

/**
 * @param {string} vaultId
 * @param {object[]} notes
 * @param {object[]} proposals
 */
export function buildOperatorVaultPayload(vaultId, notes, proposals) {
  return {
    format_version: 2,
    kind: 'knowtation-operator-vault-export',
    exported_at: new Date().toISOString(),
    vault_id: vaultId,
    notes,
    proposals,
  };
}

/**
 * AES-256-GCM; wire format: MAGIC (4) + iv (12) + ciphertext + authTag (16).
 *
 * @param {string} plainUtf8
 * @param {string} keyHex — 64 hex chars (32 bytes)
 * @returns {Buffer}
 */
export function encryptOperatorBackupUtf8(plainUtf8, keyHex) {
  const key = Buffer.from(String(keyHex).trim(), 'hex');
  if (key.length !== 32) {
    throw new Error(
      'KNOWTATION_CANISTER_BACKUP_ENCRYPT_KEY_HEX must be exactly 64 hex characters (32-byte AES-256 key)',
    );
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plainUtf8, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([OPERATOR_BACKUP_MAGIC, iv, enc, tag]);
}

/**
 * @param {Buffer} buf
 * @param {string} keyHex
 * @returns {string} utf8 plaintext
 */
export function decryptOperatorBackupToUtf8(buf, keyHex) {
  const key = Buffer.from(String(keyHex).trim(), 'hex');
  if (key.length !== 32) {
    throw new Error('Invalid key length');
  }
  if (buf.length < 4 + 12 + 16 || !buf.subarray(0, 4).equals(OPERATOR_BACKUP_MAGIC)) {
    throw new Error('Invalid operator backup file (magic)');
  }
  const iv = buf.subarray(4, 16);
  const tag = buf.subarray(buf.length - 16);
  const ciphertext = buf.subarray(16, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/**
 * @param {{ bucket: string, key: string, body: Buffer, region?: string }} opts
 */
export async function putS3Object(opts) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  let region = String(opts.region || process.env.AWS_REGION || 'us-east-1').trim();
  if (!region) region = 'us-east-1';
  const client = new S3Client({ region });
  await client.send(
    new PutObjectCommand({
      Bucket: opts.bucket,
      Key: opts.key,
      Body: opts.body,
      ServerSideEncryption: 'AES256',
    }),
  );
}

/**
 * @param {string} vaultId
 */
export function safeVaultFileToken(vaultId) {
  return String(vaultId || 'default').replace(/[/:]/g, '_');
}

/**
 * @param {Date} [d]
 * @returns {string} e.g. 20260408T153022Z
 */
export function utcBackupStamp(d = new Date()) {
  const iso = d.toISOString();
  return (
    iso.slice(0, 4) +
    iso.slice(5, 7) +
    iso.slice(8, 10) +
    'T' +
    iso.slice(11, 13) +
    iso.slice(14, 16) +
    iso.slice(17, 19) +
    'Z'
  );
}
