/**
 * AIR Improvement E — ICP attestation canister client.
 *
 * Wraps @icp-sdk/core to call the attestation canister from the gateway.
 * Uses Secp256k1KeyIdentity derived from ICP_ATTESTATION_KEY env var.
 *
 * Env vars:
 *   ICP_ATTESTATION_CANISTER_ID — attestation canister principal (required to enable)
 *   ICP_ATTESTATION_KEY         — 32-byte hex seed for gateway identity (required to store)
 *   ICP_ATTESTATION_HOST        — IC host (default: https://ic0.app)
 */

import { HttpAgent, Actor } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';

const DEFAULT_HOST = 'https://ic0.app';
const DEFAULT_STORE_TIMEOUT_MS = 4000;
const DEFAULT_QUERY_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// Candid IDL factory for the attestation canister
// ---------------------------------------------------------------------------

const AttestationRecord = IDL.Record({
  id: IDL.Text,
  action: IDL.Text,
  path: IDL.Text,
  timestamp: IDL.Text,
  content_hash: IDL.Text,
  sig: IDL.Text,
  seq: IDL.Nat,
  stored_at: IDL.Text,
});

const StoreInput = IDL.Record({
  id: IDL.Text,
  action: IDL.Text,
  path: IDL.Text,
  timestamp: IDL.Text,
  content_hash: IDL.Text,
  sig: IDL.Text,
});

const StoreResult = IDL.Variant({
  ok: IDL.Record({ seq: IDL.Nat }),
  err: IDL.Text,
});

const ListResult = IDL.Record({
  records: IDL.Vec(AttestationRecord),
  total: IDL.Nat,
});

/** @type {import('@icp-sdk/core/candid').InterfaceFactory} */
const idlFactory = ({ IDL: _IDL }) => {
  return IDL.Service({
    storeAttestation: IDL.Func([StoreInput], [StoreResult], []),
    getAttestation: IDL.Func([IDL.Text], [IDL.Opt(AttestationRecord)], ['query']),
    listAttestations: IDL.Func([IDL.Nat, IDL.Nat], [ListResult], ['query']),
    getStats: IDL.Func([], [IDL.Record({ total: IDL.Nat, nextSeq: IDL.Nat })], ['query']),
    getAuthorizedCallers: IDL.Func([], [IDL.Vec(IDL.Principal)], ['query']),
    setAuthorizedCallers: IDL.Func([IDL.Vec(IDL.Principal)], [], []),
  });
};

// ---------------------------------------------------------------------------
// Singleton agent + actor (lazy init)
// ---------------------------------------------------------------------------

let _identity = null;
let _agent = null;
let _actor = null;

function getCanisterId() {
  const id = process.env.ICP_ATTESTATION_CANISTER_ID;
  return id && id.trim().length > 0 ? id.trim() : null;
}

function getKeyHex() {
  const k = process.env.ICP_ATTESTATION_KEY;
  return k && k.trim().length >= 64 ? k.trim() : null;
}

function getHost() {
  return (process.env.ICP_ATTESTATION_HOST || DEFAULT_HOST).replace(/\/$/, '');
}

/** @returns {boolean} */
export function isIcpAttestationConfigured() {
  return Boolean(getCanisterId() && getKeyHex());
}

/** @returns {string|null} */
export function getAttestationCanisterId() {
  return getCanisterId();
}

async function getIdentity() {
  if (_identity) return _identity;
  const keyHex = getKeyHex();
  if (!keyHex) return null;
  const { Secp256k1KeyIdentity } = await import('@icp-sdk/core/identity/secp256k1');
  const seed = Uint8Array.from(Buffer.from(keyHex, 'hex'));
  _identity = Secp256k1KeyIdentity.fromSecretKey(seed);
  return _identity;
}

async function getAgent() {
  if (_agent) return _agent;
  const identity = await getIdentity();
  if (!identity) return null;
  _agent = await HttpAgent.create({
    identity,
    host: getHost(),
  });
  return _agent;
}

async function getActor() {
  if (_actor) return _actor;
  const agent = await getAgent();
  if (!agent) return null;
  const canisterId = getCanisterId();
  if (!canisterId) return null;
  _actor = Actor.createActor(idlFactory, {
    agent,
    canisterId,
  });
  return _actor;
}

/**
 * Get the Principal of the gateway identity (for setAuthorizedCallers setup).
 * @returns {Promise<string|null>}
 */
export async function getGatewayPrincipal() {
  const identity = await getIdentity();
  if (!identity) return null;
  return identity.getPrincipal().toText();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Anchor an attestation record on the ICP canister.
 *
 * @param {{ id: string, action: string, path: string, timestamp: string, content_hash: string, sig: string }} record
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<{ seq: number } | null>} seq on success, null on failure/timeout
 */
export async function anchorAttestation(record, opts = {}) {
  if (_testAnchorFn) return _testAnchorFn(record, opts);
  if (!isIcpAttestationConfigured()) return null;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_STORE_TIMEOUT_MS;

  try {
    const actor = await getActor();
    if (!actor) return null;

    const result = await Promise.race([
      actor.storeAttestation({
        id: record.id,
        action: record.action || '',
        path: record.path || '',
        timestamp: record.timestamp || '',
        content_hash: record.content_hash || '',
        sig: record.sig || '',
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('ICP attestation store timeout')), timeoutMs),
      ),
    ]);

    if (result && 'ok' in result) {
      return { seq: Number(result.ok.seq) };
    }

    if (result && 'err' in result) {
      console.error('[icp-attest] canister returned error:', result.err);
      return null;
    }

    return null;
  } catch (e) {
    console.error('[icp-attest] anchorAttestation failed:', e?.message || String(e));
    return null;
  }
}

/**
 * Query an attestation record from the ICP canister.
 *
 * @param {string} id
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<object|null>} record object or null
 */
export async function queryAttestation(id, opts = {}) {
  if (_testQueryFn) return _testQueryFn(id, opts);
  if (!getCanisterId()) return null;

  const timeoutMs = opts.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;

  try {
    const actor = await getActor();
    if (!actor) return null;

    const result = await Promise.race([
      actor.getAttestation(id),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('ICP attestation query timeout')), timeoutMs),
      ),
    ]);

    if (result && result.length > 0 && result[0]) {
      const r = result[0];
      return {
        id: r.id,
        action: r.action,
        path: r.path,
        timestamp: r.timestamp,
        content_hash: r.content_hash,
        sig: r.sig,
        seq: Number(r.seq),
        stored_at: r.stored_at,
      };
    }

    return null;
  } catch (e) {
    console.error('[icp-attest] queryAttestation failed:', e?.message || String(e));
    return null;
  }
}

/**
 * Reset cached agent/actor (for testing or key rotation).
 */
export function resetClient() {
  _identity = null;
  _agent = null;
  _actor = null;
}

// ---------------------------------------------------------------------------
// Test hooks — allow tests to override anchor/query without fighting ESM
// ---------------------------------------------------------------------------

let _testAnchorFn = null;
let _testQueryFn = null;

/**
 * Override anchorAttestation / queryAttestation for unit tests.
 * Pass null to restore real implementations.
 * @param {{ anchor?: Function|null, query?: Function|null }} overrides
 */
export function _setTestOverrides(overrides) {
  _testAnchorFn = overrides?.anchor ?? null;
  _testQueryFn = overrides?.query ?? null;
}

/** @internal */
export function _getTestOverrides() {
  return { anchor: _testAnchorFn, query: _testQueryFn };
}
