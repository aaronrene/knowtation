import { describe, it } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import {
  OPERATOR_BACKUP_MAGIC,
  buildOperatorVaultPayload,
  decryptOperatorBackupToUtf8,
  encryptOperatorBackupUtf8,
  safeVaultFileToken,
  utcBackupStamp,
} from '../lib/operator-canister-backup.mjs';

const SAMPLE_KEY_HEX = crypto.randomBytes(32).toString('hex');

describe('buildOperatorVaultPayload', () => {
  it('includes format_version 2 and notes + proposals', () => {
    const p = buildOperatorVaultPayload('default', [{ path: 'a.md' }], [{ proposal_id: 'p1' }]);
    assert.strictEqual(p.format_version, 2);
    assert.strictEqual(p.kind, 'knowtation-operator-vault-export');
    assert.strictEqual(p.vault_id, 'default');
    assert.strictEqual(p.notes.length, 1);
    assert.strictEqual(p.proposals.length, 1);
    assert.match(p.exported_at, /^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('encryptOperatorBackupUtf8 / decryptOperatorBackupToUtf8', () => {
  it('roundtrips JSON', () => {
    const plain = JSON.stringify({ hello: 'world', n: 1 });
    const enc = encryptOperatorBackupUtf8(plain, SAMPLE_KEY_HEX);
    assert.ok(enc.subarray(0, 4).equals(OPERATOR_BACKUP_MAGIC));
    const out = decryptOperatorBackupToUtf8(enc, SAMPLE_KEY_HEX);
    assert.strictEqual(out, plain);
  });

  it('rejects wrong key length', () => {
    assert.throws(() => encryptOperatorBackupUtf8('x', 'abcd'), /64 hex/);
  });
});

describe('safeVaultFileToken', () => {
  it('replaces path separators', () => {
    assert.strictEqual(safeVaultFileToken('a/b:c'), 'a_b_c');
  });
});

describe('utcBackupStamp', () => {
  it('matches YYYYMMDDTHHMMSSZ shape', () => {
    const s = utcBackupStamp(new Date('2026-04-08T15:30:22.000Z'));
    assert.strictEqual(s, '20260408T153022Z');
  });
});
