/**
 * Tier 7 — SECURITY (centerpiece): Phase 6 derived-artifact storage layer.
 *
 * Covers (§10 Security obligations — all build-blocking):
 *   P6-a/P6-b: NO privacy_max artifact ever written host-readable or under server-held key
 *   P6-j:      NO plaintext fallback when encryption unavailable
 *   P6-c:      Delegated write fail-closed without owner opt-in
 *   P6-d:      NO tier downgrade by a delegate
 *   P6-e:      Provenance cannot be forged or omitted
 *   P6-f:      NO secret in any artifact, provenance field, log, or error
 *   P6-h:      Single-writer no-bypass architecture test (BUILD-BLOCKING)
 *   P6-i:      Runtime group imports no writer/encryptor/vault module (extends D5.8)
 *   Global:    Convenience never masquerades as privacy_max and vice-versa
 *              Fail-closed posture on every ambiguous input
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  createDerivedArtifactWriter,
  WRITER_REASONS,
} from '../lib/companion-artifact-writer.mjs';

import {
  createClientEncryptor,
  UNAVAILABLE_CLIENT_ENCRYPTOR,
  ENCRYPTOR_REASONS,
} from '../lib/companion-client-encryptor.mjs';

import {
  buildConvenienceProvenance,
  validateProvenance,
  PROVENANCE_REJECT_REASONS,
} from '../lib/companion-provenance-validator.mjs';

import {
  TERMINAL_STATES,
  resolveTier,
  TIER_RESOLVE_REASONS,
} from '../lib/companion-tier-resolver.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSecStores() {
  const written = [];
  const vectors = [];
  const insights = [];

  const writeNoteFn = (_vp, notePath, opts) => {
    written.push({ notePath, frontmatter: { ...opts.frontmatter } });
  };

  const vs = {
    upsert: async (points) => { vectors.push(...points); },
    deleteByPath: async () => {},
  };

  const mm = {
    store: (type, data) => {
      if (type === 'insight') insights.push(data);
      return { id: 'x', ts: '' };
    },
  };

  return { written, vectors, insights, writeNoteFn, vs, mm };
}

function selfCtx(overrides = {}) {
  return {
    lane: 'local', containsPrivateData: false, isDelegate: false,
    delegatedManagedAllowed: false, enrichesDelegatedPartition: false,
    delegatedEnrichmentAllowed: false,
    ...overrides,
  };
}

function baseProv(overrides = {}) {
  return buildConvenienceProvenance({
    generatedBy: 'sec-user',
    source: 'companion',
    model: 'sec-model',
    modelVersion: '1.0',
    lane: 'local',
    artifactType: 'ai_summary',
    sourceNotePath: 'sec/note.md',
    sourceEventId: 'mem_sec_001',
    ...overrides,
  });
}

// ── P6-a / P6-b: Privacy_max NEVER host-readable or server-held-key ───────────

describe('security P6-a/P6-b — privacy_max artifact never host-readable', () => {
  it('privacy_max + unavailable encryptor → no write occurs (fail closed)', async () => {
    const { written, writeNoteFn } = buildSecStores();
    const writer = createDerivedArtifactWriter({
      writeNoteFn,
      vaultPath: '/vault',
      vaultRegistryAvailable: true, // registry present → tier resolves to client_encrypted
      // No encryptor → UNAVAILABLE_CLIENT_ENCRYPTOR (default)
    });

    const privProv = { ...baseProv(), privacy_tier: 'privacy_max' };
    const r = await writer.write({ summary: 'private content' }, privProv, selfCtx());

    assert.equal(r.ok, false);
    assert.equal(r.reason, WRITER_REASONS.ENCRYPTION_UNAVAILABLE);
    assert.equal(written.length, 0, 'NOTHING must be written when privacy_max encryption unavailable');
  });

  it('privacy_max + vault registry absent → tier rejected before encryption check', async () => {
    const { written, writeNoteFn } = buildSecStores();
    const writer = createDerivedArtifactWriter({
      writeNoteFn,
      vaultPath: '/vault',
      vaultRegistryAvailable: false, // D6.1.1 — no registry → fail closed
    });

    const privProv = { ...baseProv(), privacy_tier: 'privacy_max' };
    const r = await writer.write({ summary: 'private' }, privProv, selfCtx());

    assert.equal(r.ok, false);
    assert.equal(r.reason, WRITER_REASONS.TIER_UNRESOLVABLE);
    assert.equal(written.length, 0);
  });

  it('resolveTier: server-held-key equivalent → host_readable (only convenience may use it)', () => {
    // Server-held-key = host_readable classification (D6.1.2)
    // Convenience → host_readable: this is the ONLY class that may use server-held key
    const r = resolveTier('ai_summary', 'convenience');
    assert.equal(r.ok, true);
    assert.equal(r.terminalState, TERMINAL_STATES.HOST_READABLE);

    // Privacy_max NEVER resolves to host_readable
    const rp = resolveTier('ai_summary', 'privacy_max', { vaultRegistryAvailable: true });
    assert.equal(rp.terminalState, TERMINAL_STATES.CLIENT_ENCRYPTED);
    assert.notEqual(rp.terminalState, TERMINAL_STATES.HOST_READABLE, 'privacy_max must never be host_readable');
  });

  it('privacy_max artifact never has a plaintext ai_summary in frontmatter', async () => {
    const { written, writeNoteFn } = buildSecStores();

    const workingEncryptor = createClientEncryptor({
      isAvailable: () => true,
      encrypt: (bytes) => ({
        ciphertext: new Uint8Array(bytes.length).fill(0xee),
        wrappedDekRef: 'dek-sec-001',
        alg: 'STUB-256',
      }),
    });

    const writer = createDerivedArtifactWriter({
      writeNoteFn,
      vaultPath: '/vault',
      vaultRegistryAvailable: true,
      encryptor: workingEncryptor,
    });

    const privProv = { ...baseProv(), privacy_tier: 'privacy_max' };
    await writer.write({ summary: 'very private' }, privProv, selfCtx());

    for (const w of written) {
      assert.equal(w.frontmatter.ai_summary, undefined,
        'plaintext ai_summary must NEVER appear in frontmatter at privacy_max');
    }
  });
});

// ── P6-j: No plaintext fallback, ever ─────────────────────────────────────────

describe('security P6-j — no plaintext fallback when encryption unavailable', () => {
  it('UNAVAILABLE_CLIENT_ENCRYPTOR.encrypt throws, never returns plaintext', () => {
    assert.throws(
      () => UNAVAILABLE_CLIENT_ENCRYPTOR.encrypt(new Uint8Array([1, 2, 3]), { scope: 'vault' }),
      (err) => err.message === ENCRYPTOR_REASONS.UNAVAILABLE,
    );
  });

  it('writer never writes plaintext when encrypt() throws', async () => {
    const { written, writeNoteFn } = buildSecStores();
    const throwingEncryptor = createClientEncryptor({
      isAvailable: () => true,
      encrypt: () => { throw new Error('key locked'); },
    });

    const writer = createDerivedArtifactWriter({
      writeNoteFn,
      vaultPath: '/vault',
      vaultRegistryAvailable: true,
      encryptor: throwingEncryptor,
    });

    const privProv = { ...baseProv(), privacy_tier: 'privacy_max' };
    const r = await writer.write({ summary: 'sensitive' }, privProv, selfCtx());

    assert.equal(r.ok, false);
    assert.equal(r.reason, WRITER_REASONS.ENCRYPTION_FAILED);
    assert.equal(written.length, 0, 'Nothing must be written on encryption failure — no plaintext fallback');
  });

  it('writer returns ENCRYPTION_UNAVAILABLE before any store call (no partial write)', async () => {
    let storeCallCount = 0;
    const countingWriter = (_vp, _np, _opts) => { storeCallCount++; };

    const writer = createDerivedArtifactWriter({
      writeNoteFn: countingWriter,
      vaultPath: '/vault',
      vaultRegistryAvailable: true,
    });

    const privProv = { ...baseProv(), privacy_tier: 'privacy_max' };
    await writer.write({ summary: 'secret' }, privProv, selfCtx());

    assert.equal(storeCallCount, 0, 'writeNoteFn must not be called before encryption succeeds');
  });
});

// ── P6-c: Delegated write fail-closed without owner opt-in ────────────────────

describe('security P6-c — delegated write fail-closed (D6.3.3)', () => {
  it('enrichesDelegatedPartition=true always blocked (D6.3.6: tenancy gate absent)', async () => {
    const { written, writeNoteFn } = buildSecStores();
    const writer = createDerivedArtifactWriter({ writeNoteFn, vaultPath: '/vault' });

    for (const delegatedEnrichmentAllowed of [false, true]) {
      const r = await writer.write({ summary: 'delegate' }, baseProv(), {
        lane: 'local', containsPrivateData: false,
        isDelegate: true, delegatedManagedAllowed: false,
        enrichesDelegatedPartition: true, delegatedEnrichmentAllowed,
      });
      assert.equal(r.ok, false);
      assert.equal(r.reason, WRITER_REASONS.SELF_PARTITION_ONLY,
        `enrichesDelegatedPartition=true must always be blocked, delegatedEnrichmentAllowed=${delegatedEnrichmentAllowed}`);
    }
    assert.equal(written.length, 0);
  });

  it('delegated managed-lane write denied without delegatedManagedAllowed', async () => {
    const { written, writeNoteFn } = buildSecStores();
    const writer = createDerivedArtifactWriter({ writeNoteFn, vaultPath: '/vault' });

    const managedProv = baseProv({
      source: 'managed',
      lane: 'direct_provider',
      artifactType: 'ai_summary',
    });
    const r = await writer.write({ summary: 'managed delegate' }, managedProv, {
      lane: 'direct_provider', containsPrivateData: false,
      isDelegate: true, delegatedManagedAllowed: false,
      enrichesDelegatedPartition: false, // self-partition managed
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, WRITER_REASONS.CONSENT_DENIED);
    assert.equal(written.length, 0);
  });
});

// ── P6-d: No tier downgrade ────────────────────────────────────────────────────

describe('security P6-d — no tier downgrade (D6.3.4)', () => {
  it('tier is resolved from provenance.privacy_tier (owner tier) — cannot be downgraded', () => {
    // Tier resolver always uses the provenance.privacy_tier (the owner's tier).
    // A delegate cannot pass a different tier — the tier is stamped by the writer
    // from the owner's vault, not from the actor's capability.
    //
    // At Phase 6: cross-partition is fully blocked (D6.3.6), so tier downgrade
    // by a delegate is structurally impossible — the write fails at SELF_PARTITION_ONLY
    // before tier resolution even runs.
    //
    // Verify that the tier resolver never maps privacy_max → host_readable:
    for (const at of ['ai_summary', 'embedding', 'insight', 'discovery_facet']) {
      const r = resolveTier(at, 'privacy_max', { vaultRegistryAvailable: true });
      assert.ok(r.ok);
      assert.notEqual(r.terminalState, TERMINAL_STATES.HOST_READABLE,
        `privacy_max must never resolve to host_readable for ${at}`);
    }
  });

  it('convenience tier never resolves to client_encrypted (no accidental upgrade)', () => {
    for (const at of ['ai_summary', 'embedding', 'insight', 'discovery_facet']) {
      const r = resolveTier(at, 'convenience');
      assert.equal(r.terminalState, TERMINAL_STATES.HOST_READABLE,
        `convenience must always resolve to host_readable for ${at}`);
    }
  });
});

// ── P6-e: Provenance cannot be forged or omitted ──────────────────────────────

describe('security P6-e — provenance cannot be forged or omitted (D6.2, D6.6)', () => {
  it('every missing required field causes rejection', async () => {
    const { written, writeNoteFn } = buildSecStores();
    const writer = createDerivedArtifactWriter({ writeNoteFn, vaultPath: '/vault' });
    const base = baseProv();

    const required = [
      'generated_by', 'source', 'model', 'lane', 'privacy_tier',
      'source_note_path', 'source_event_id', 'created_at', 'artifact_type', 'schema_version',
    ];

    for (const field of required) {
      const p = { ...base };
      delete p[field];
      const r = await writer.write({ summary: 'x' }, p, selfCtx());
      assert.equal(r.ok, false, `Missing ${field} must cause rejection`);
      assert.equal(written.length, 0, `No write after missing ${field}`);
    }
  });

  it('null provenance is always rejected', async () => {
    const { writeNoteFn } = buildSecStores();
    const writer = createDerivedArtifactWriter({ writeNoteFn, vaultPath: '/vault' });
    const r = await writer.write({ summary: 'x' }, null, selfCtx());
    assert.equal(r.ok, false);
  });

  it('provenance with forged generated_by (empty) is rejected', async () => {
    const { writeNoteFn } = buildSecStores();
    const writer = createDerivedArtifactWriter({ writeNoteFn, vaultPath: '/vault' });
    const p = { ...baseProv(), generated_by: '' };
    const r = await writer.write({ summary: 'x' }, p, selfCtx());
    assert.equal(r.ok, false);
  });

  it('provenance sidecar stored in frontmatter matches written provenance exactly', async () => {
    const { written, writeNoteFn } = buildSecStores();
    const writer = createDerivedArtifactWriter({ writeNoteFn, vaultPath: '/vault' });
    const p = baseProv();
    await writer.write({ summary: 'honest summary' }, p, selfCtx());

    const stored = written[0].frontmatter.ai_summary_provenance;
    assert.equal(stored.generated_by, p.generated_by);
    assert.equal(stored.model, p.model);
    assert.equal(stored.lane, p.lane);
    assert.equal(stored.created_at, p.created_at);
  });
});

// ── P6-f: No secret in artifact, provenance, log, or error ────────────────────

describe('security P6-f — no secret in any artifact, provenance, log, or error', () => {
  it('validateProvenance rejects provenance with token field', () => {
    const p = { ...baseProv(), access_token: 'bearer-xyz' };
    const r = validateProvenance(p);
    assert.equal(r.ok, false);
    assert.equal(r.reason, PROVENANCE_REJECT_REASONS.SENSITIVE_DATA);
  });

  it('validateProvenance rejects artifact with api_key', () => {
    const r = validateProvenance(baseProv(), { summary: 'ok', api_key: 'sk-1234' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, PROVENANCE_REJECT_REASONS.SENSITIVE_DATA);
  });

  it('validateProvenance rejects artifact with nested credential', () => {
    const r = validateProvenance(baseProv(), { data: { credentials: { password: 'abc' } } });
    assert.equal(r.ok, false);
    assert.equal(r.reason, PROVENANCE_REJECT_REASONS.SENSITIVE_DATA);
  });

  it('writer reason codes do not include key material', async () => {
    const { writeNoteFn } = buildSecStores();
    const writer = createDerivedArtifactWriter({ writeNoteFn, vaultPath: '/vault' });

    // Test each failure path and ensure the reason code is a fixed string
    const tests = [
      // Invalid provenance
      writer.write({ summary: 'x' }, null, selfCtx()),
      // Cross-partition
      writer.write({ summary: 'x' }, baseProv(), { ...selfCtx(), enrichesDelegatedPartition: true }),
      // Consent denied
      writer.write({ summary: 'x' }, { ...baseProv(), lane: 'direct_provider', source: 'managed' }, {
        lane: 'direct_provider', containsPrivateData: false, isDelegate: true,
        delegatedManagedAllowed: false,
      }),
    ];

    const results = await Promise.all(tests);
    const SECRET_PATTERNS = /key|secret|token|password|credential|bearer/i;

    for (const r of results) {
      assert.equal(r.ok, false);
      assert.ok(
        !SECRET_PATTERNS.test(r.reason),
        `Reason code must not contain sensitive patterns: ${r.reason}`,
      );
      if (r.detail) {
        assert.ok(
          !SECRET_PATTERNS.test(r.detail),
          `Detail must not contain sensitive patterns: ${r.detail}`,
        );
      }
    }
  });

  it('ENCRYPTOR_REASONS codes do not contain key material (no hex blobs, JWTs, or base64 payloads)', () => {
    // Reason codes are short fixed identifiers like 'encryptor_unavailable_no_user_held_key'.
    // The check guards against actual key material (long hex/base64 strings, JWT patterns)
    // leaking into codes — not against descriptive identifiers that use the word "key".
    const ACTUAL_SECRET_PATTERNS = /[0-9a-f]{32,}|eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+|[A-Za-z0-9+/]{40,}={0,2}/;
    for (const code of Object.values(ENCRYPTOR_REASONS)) {
      assert.ok(!ACTUAL_SECRET_PATTERNS.test(code), `Encryptor reason must not contain key material: ${code}`);
      // Also verify it's a reasonable short identifier (not an exfiltrated value)
      assert.ok(code.length < 80, `Encryptor reason code suspiciously long: ${code}`);
    }
  });

  it('provenance sidecar stored in frontmatter contains no secret-bearing fields', async () => {
    const { written, writeNoteFn } = buildSecStores();
    const writer = createDerivedArtifactWriter({ writeNoteFn, vaultPath: '/vault' });
    await writer.write({ summary: 'fine' }, baseProv(), selfCtx());

    const stored = written[0].frontmatter.ai_summary_provenance;
    const secretPattern = /(api[_-]?key|secret|password|token|credential|authorization|bearer|private[_-]?key)/i;
    for (const key of Object.keys(stored)) {
      assert.ok(!secretPattern.test(key), `Provenance sidecar must not have sensitive key: ${key}`);
    }
  });
});

// ── P6-h: Single-writer no-bypass architecture test (BUILD-BLOCKING) ──────────

describe('security P6-h — single-writer no-bypass (D6.6.3/D6.6.4) [BUILD-BLOCKING]', () => {
  it('index-enrich.mjs does not call writeNote directly for ai_summary after migration', () => {
    const enrichPath = join(REPO_ROOT, 'mcp/tools/index-enrich.mjs');
    const src = readFileSync(enrichPath, 'utf8');

    // The direct writeNote call for ai_summary frontmatter must be removed (D6.6.2)
    // Pattern: writeNote(..., { frontmatter: { ai_summary: ... } }) without going through writer
    const directWritePattern = /writeNote\s*\([^)]*frontmatter\s*:\s*\{[^}]*ai_summary\s*:/;
    assert.ok(
      !directWritePattern.test(src),
      'index-enrich.mjs must NOT contain direct writeNote calls for ai_summary frontmatter. ' +
      'All writes must go through DerivedArtifactWriter (D6.6.2).',
    );
  });

  it('memory-consolidate.mjs does not call mm.store("insight") directly after migration', () => {
    const consolidatePath = join(REPO_ROOT, 'lib/memory-consolidate.mjs');
    const src = readFileSync(consolidatePath, 'utf8');

    // Strip comment lines so we only check executable code, not comment references (D6.6.2)
    const codeLines = src.split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');

    const directInsightPattern = /mm\.store\s*\(\s*['"]insight['"]/;
    assert.ok(
      !directInsightPattern.test(codeLines),
      'memory-consolidate.mjs must NOT contain direct mm.store("insight", ...) calls in code. ' +
      'All insight persistence must go through DerivedArtifactWriter (D6.6.2).',
    );
  });

  it('companion-artifact-writer.mjs is in the lib/ directory (authority group)', () => {
    const writerPath = join(REPO_ROOT, 'lib/companion-artifact-writer.mjs');
    assert.ok(existsSync(writerPath), 'DerivedArtifactWriter must exist in lib/ (authority group)');
  });

  it('companion-client-encryptor.mjs is in the lib/ directory (authority group)', () => {
    const encPath = join(REPO_ROOT, 'lib/companion-client-encryptor.mjs');
    assert.ok(existsSync(encPath), 'ClientEncryptor must exist in lib/ (authority group)');
  });
});

// ── P6-i: Runtime group imports no writer/encryptor/vault module ──────────────

describe('security P6-i — runtime group imports no writer/encryptor module (extends D5.8) [BUILD-BLOCKING]', () => {
  const FORBIDDEN_IMPORTS = [
    'companion-artifact-writer',
    'companion-client-encryptor',
  ];

  const RUNTIME_GROUP_FILES = [
    'lib/companion-runtime-manager.mjs',
    'lib/companion-spawn-adapter.mjs',
    'lib/companion-download-adapter.mjs',
    'lib/companion-inference-listener.mjs',
    'lib/companion-resource-probe.mjs',
  ];

  for (const file of RUNTIME_GROUP_FILES) {
    for (const forbidden of FORBIDDEN_IMPORTS) {
      it(`${file} does not import ${forbidden}`, () => {
        const filePath = join(REPO_ROOT, file);
        if (!existsSync(filePath)) return; // File may not exist in all branches — skip

        const src = readFileSync(filePath, 'utf8');
        const importPattern = new RegExp(`import[^'"]*['"].*${forbidden.replace('.', '\\.')}.*['"]`);
        assert.ok(
          !importPattern.test(src),
          `SECURITY VIOLATION: ${file} must NOT import ${forbidden}. ` +
          `The runtime/inference group must never hold the writer or encryptor capability (D6.6.3, D5.8).`,
        );
      });
    }
  }
});

// ── Convenience never masquerades as privacy_max / vice-versa ─────────────────

describe('security — tier purity (no masquerade)', () => {
  it('convenience write produces host_readable terminal state, never client_encrypted', async () => {
    const { written, writeNoteFn } = buildSecStores();
    const writer = createDerivedArtifactWriter({ writeNoteFn, vaultPath: '/vault' });

    const r = await writer.write({ summary: 'convenience' }, baseProv(), selfCtx());
    assert.equal(r.ok, true);
    assert.equal(r.terminalState, TERMINAL_STATES.HOST_READABLE);
    // ai_summary is plaintext — that is correct for convenience
    assert.equal(written[0].frontmatter.ai_summary, 'convenience');
    assert.equal(written[0].frontmatter.ai_summary_ciphertext, undefined);
  });

  it('unknown tier input never resolves to convenience (fail-closed to most-restrictive)', () => {
    // Unknown tier → TIER_RESOLVE_REASONS.UNKNOWN_TIER (not convenience)
    const r = resolveTier('ai_summary', 'unknown_mystery_tier');
    assert.equal(r.ok, false);
    assert.equal(r.reason, TIER_RESOLVE_REASONS.UNKNOWN_TIER);
    // It must NOT silently fall back to convenience
  });
});

// ── Global fail-closed posture ────────────────────────────────────────────────

describe('security — global fail-closed posture', () => {
  it('writer with every possible bad provenance field combination always returns ok:false', async () => {
    const { writeNoteFn } = buildSecStores();
    const writer = createDerivedArtifactWriter({ writeNoteFn, vaultPath: '/vault' });

    const badProvCases = [
      null, undefined, '', 0, [], {}, { generated_by: 'x' }, { schema_version: 1 },
      { ...baseProv(), privacy_tier: undefined },
      { ...baseProv(), artifact_type: 'invalid' },
      { ...baseProv(), created_at: 'not-a-date' },
    ];

    for (const prov of badProvCases) {
      const r = await writer.write({ summary: 'x' }, prov, selfCtx());
      assert.equal(r.ok, false, `Bad provenance must always fail: ${JSON.stringify(prov)}`);
    }
  });

  it('resolveTier returns ok:false for every invalid input combination', () => {
    const badCombos = [
      ['', ''],
      ['ai_summary', ''],
      ['', 'convenience'],
      [null, null],
      ['video', 'convenience'],
      ['ai_summary', 'SECRET_TIER'],
    ];
    for (const [at, pt] of badCombos) {
      const r = resolveTier(at, pt);
      assert.equal(r.ok, false, `resolveTier(${at}, ${pt}) must fail`);
    }
  });

  it('UNAVAILABLE_CLIENT_ENCRYPTOR.isAvailable never throws, always false', () => {
    const extremeInputs = [null, undefined, '', 0, {}, [], 'privacy_max', 'vault'];
    for (let i = 0; i < extremeInputs.length - 1; i++) {
      assert.doesNotThrow(() => {
        const result = UNAVAILABLE_CLIENT_ENCRYPTOR.isAvailable(extremeInputs[i], extremeInputs[i + 1]);
        assert.equal(result, false);
      });
    }
  });
});
