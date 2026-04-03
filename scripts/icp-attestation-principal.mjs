#!/usr/bin/env node
/**
 * Utility: derive the ICP Principal from ICP_ATTESTATION_KEY.
 *
 * Usage:
 *   ICP_ATTESTATION_KEY=<hex> node scripts/icp-attestation-principal.mjs
 *
 * Or with .env loaded:
 *   node scripts/icp-attestation-principal.mjs
 *
 * Output: the Principal text that must be passed to the attestation canister's
 *   setAuthorizedCallers method after deploy:
 *
 *   dfx canister call attestation setAuthorizedCallers \
 *     '(vec { principal "<printed-principal>" })' --network ic
 */

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
if (existsSync(envPath)) {
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

const keyHex = process.env.ICP_ATTESTATION_KEY;
if (!keyHex || keyHex.trim().length < 64) {
  console.error(
    'Error: ICP_ATTESTATION_KEY must be set (64-char hex string, 32 bytes).\n' +
      'Generate one: openssl rand -hex 32\n' +
      'Set in .env or export before running.',
  );
  process.exit(1);
}

const { Secp256k1KeyIdentity } = await import('@icp-sdk/core/identity/secp256k1');

const seed = Uint8Array.from(Buffer.from(keyHex.trim(), 'hex'));
const identity = Secp256k1KeyIdentity.fromSecretKey(seed);
const principal = identity.getPrincipal().toText();

console.log('Gateway identity Principal:');
console.log(principal);
console.log('');
console.log('After deploying the attestation canister, run:');
console.log('');
console.log(
  `  cd hub/icp && dfx canister call attestation setAuthorizedCallers '(vec { principal "${principal}" })' --network ic`,
);
