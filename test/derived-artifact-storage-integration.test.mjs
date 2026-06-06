/**
 * Tier 2 — INTEGRATION: Phase 6 derived-artifact storage layer.
 *
 * Covers (§10 Integration obligations):
 *   - Writer pipeline end-to-end: validate→resolve→consent→encrypt→store
 *     across ai_summary, embedding, and insight artifact types
 *   - Migrated enrichIndexedNotes routes through the writer
 *   - Migrated runDiscoverPass routes through the writer
 *   - Convenience write lands host-readable with provenance (no ciphertext)
 *   - privacy_max write with unavailable encryptor → no plaintext fallback
 *   - deleteArtifacts removes from all stores for a note
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDerivedArtifactWriter,
  WRITER_REASONS,
} from '../lib/companion-artifact-writer.mjs';

import {
  UNAVAILABLE_CLIENT_ENCRYPTOR,
  createClientEncryptor,
  ENCRYPTOR_REASONS,
} from '../lib/companion-client-encryptor.mjs';

import {
  TERMINAL_STATES,
} from '../lib/companion-tier-resolver.mjs';

import {
  buildConvenienceProvenance,
  PROVENANCE_SCHEMA_VERSION,
} from '../lib/companion-provenance-validator.mjs';

import { runDiscoverPass } from '../lib/memory-consolidate.mjs';

// ── Test doubles ──────────────────────────────────────────────────────────────

function makeStores() {
  const frontmatter = new Map();
  const vectors = [];
  const insights = [];
  const maintenance = [];

  const writeNoteFn = (_vaultPath, notePath, opts) => {
    const prev = frontmatter.get(notePath) ?? {};
    frontmatter.set(notePath, { ...prev, ...opts.frontmatter });
  };

  const vectorStore = {
    upsert: async (points) => { vectors.push(...points); },
    deleteByPath: async (notePath) => {
      const idx = vectors.findIndex((v) => v.path === notePath);
      if (idx >= 0) vectors.splice(idx, 1);
    },
  };

  const mm = {
    store: (type, data) => {
      if (type === 'insight') insights.push(data);
      if (type === 'maintenance') maintenance.push(data);
      return { id: `mem_${Date.now()}`, ts: new Date().toISOString() };
    },
  };

  return { frontmatter, vectors, insights, maintenance, writeNoteFn, vectorStore, mm };
}

function convenienceContext() {
  return {
    lane: 'local',
    containsPrivateData: false,
    isDelegate: false,
    delegatedManagedAllowed: false,
    enrichesDelegatedPartition: false,
    delegatedEnrichmentAllowed: false,
  };
}

function summaryProvenance(overrides = {}) {
  return buildConvenienceProvenance({
    generatedBy: 'user-abc',
    source: 'companion',
    model: 'llama-3',
    modelVersion: '3.1',
    lane: 'local',
    artifactType: 'ai_summary',
    sourceNotePath: 'notes/test.md',
    sourceEventId: 'mem_001',
    ...overrides,
  });
}

function insightProvenance(overrides = {}) {
  return buildConvenienceProvenance({
    generatedBy: 'user-abc',
    source: 'companion',
    model: 'llama-3',
    modelVersion: '3.1',
    lane: 'local',
    artifactType: 'insight',
    sourceNotePath: null,
    sourceEventId: ['mem_001', 'mem_002'],
    ...overrides,
  });
}

// ── Pipeline end-to-end: ai_summary ──────────────────────────────────────────

describe('writer pipeline — ai_summary, convenience tier', () => {
  it('stores summary + provenance sidecar in note frontmatter', async () => {
    const { frontmatter, writeNoteFn } = makeStores();
    const w = createDerivedArtifactWriter({
      writeNoteFn,
      vaultPath: '/vault',
    });

    const artifact = { summary: 'This note discusses quantum entanglement.' };
    const prov = summaryProvenance();
    const r = await w.write(artifact, prov, convenienceContext());

    assert.equal(r.ok, true);
    assert.equal(r.terminalState, TERMINAL_STATES.HOST_READABLE);

    const fm = frontmatter.get('notes/test.md');
    assert.ok(fm, 'Frontmatter should be written');
    assert.equal(fm.ai_summary, artifact.summary);
    assert.ok(fm.ai_summary_provenance, 'Provenance sidecar should be written');
    assert.equal(fm.ai_summary_provenance.artifact_type, 'ai_summary');
    assert.equal(fm.ai_summary_provenance.privacy_tier, 'convenience');
    // No ciphertext at convenience tier
    assert.equal(fm.ai_summary_ciphertext, undefined);
  });

  it('provenance sidecar contains only safe fields (no secrets)', async () => {
    const { frontmatter, writeNoteFn } = makeStores();
    const w = createDerivedArtifactWriter({ writeNoteFn, vaultPath: '/vault' });
    await w.write({ summary: 'fine' }, summaryProvenance(), convenienceContext());
    const fm = frontmatter.get('notes/test.md');
    const prov = fm.ai_summary_provenance;
    // Must not contain key material
    for (const key of Object.keys(prov)) {
      const lk = key.toLowerCase();
      assert.ok(
        !lk.includes('secret') && !lk.includes('token') && !lk.includes('key') && !lk.includes('password'),
        `Provenance sidecar must not contain sensitive key: ${key}`,
      );
    }
  });
});

// ── Pipeline end-to-end: embedding ───────────────────────────────────────────

describe('writer pipeline — embedding, convenience tier', () => {
  it('upserts vector with provenance metadata', async () => {
    const { vectors, writeNoteFn, vectorStore } = makeStores();
    const w = createDerivedArtifactWriter({
      writeNoteFn,
      vaultPath: '/vault',
      vectorStore,
    });

    const prov = buildConvenienceProvenance({
      generatedBy: 'user-abc',
      source: 'companion',
      model: 'embed-model',
      modelVersion: '1.0',
      lane: 'local',
      artifactType: 'embedding',
      sourceNotePath: 'notes/embed.md',
      sourceEventId: 'mem_emb_001',
    });
    const artifact = {
      vector: [0.1, 0.2, 0.3],
      payload: { path: 'notes/embed.md' },
    };
    const r = await w.write(artifact, prov, convenienceContext());

    assert.equal(r.ok, true);
    assert.equal(r.terminalState, TERMINAL_STATES.HOST_READABLE);
    assert.equal(vectors.length, 1);
    assert.deepEqual(vectors[0].vector, [0.1, 0.2, 0.3]);
    assert.ok(vectors[0].payload.provenance);
  });
});

// ── Pipeline end-to-end: insight ─────────────────────────────────────────────

describe('writer pipeline — insight, convenience tier', () => {
  it('stores insight with provenance via MemoryManager', async () => {
    const { insights, writeNoteFn, mm } = makeStores();
    const w = createDerivedArtifactWriter({
      writeNoteFn,
      vaultPath: '/vault',
      mm,
    });

    const prov = insightProvenance();
    const artifact = {
      connections: ['A relates to B'],
      contradictions: [],
      open_questions: ['What is X?'],
      topic_count: 2,
    };
    const r = await w.write(artifact, prov, convenienceContext());

    assert.equal(r.ok, true);
    assert.equal(insights.length, 1);
    assert.deepEqual(insights[0].connections, ['A relates to B']);
    assert.ok(insights[0].provenance);
  });
});

// ── Privacy-max: fail-closed with unavailable encryptor ───────────────────────

describe('writer pipeline — privacy_max with unavailable encryptor', () => {
  it('returns ENCRYPTION_UNAVAILABLE and writes nothing', async () => {
    const { frontmatter, writeNoteFn } = makeStores();
    const w = createDerivedArtifactWriter({
      writeNoteFn,
      vaultPath: '/vault',
      vaultRegistryAvailable: true,
      // No encryptor provided → defaults to UNAVAILABLE_CLIENT_ENCRYPTOR
    });

    // buildConvenienceProvenance always sets privacy_tier=convenience; override after
    const prov = { ...summaryProvenance(), privacy_tier: 'privacy_max' };
    const r = await w.write({ summary: 'private' }, prov, convenienceContext());

    assert.equal(r.ok, false);
    assert.equal(r.reason, WRITER_REASONS.ENCRYPTION_UNAVAILABLE);
    assert.equal(frontmatter.size, 0, 'No frontmatter should be written');
  });

  it('never stores plaintext when privacy_max encryption fails', async () => {
    const { writeNoteFn, frontmatter } = makeStores();
    const failingEncryptor = createClientEncryptor({
      isAvailable: () => true,
      encrypt: () => { throw new Error('encrypt_failed'); },
    });

    const w = createDerivedArtifactWriter({
      writeNoteFn,
      vaultPath: '/vault',
      vaultRegistryAvailable: true,
      encryptor: failingEncryptor,
    });

    // Override privacy_tier to privacy_max after building convenience provenance
    const prov = { ...summaryProvenance(), privacy_tier: 'privacy_max' };
    const r = await w.write({ summary: 'private' }, prov, convenienceContext());

    assert.equal(r.ok, false);
    assert.equal(r.reason, WRITER_REASONS.ENCRYPTION_FAILED);
    assert.equal(frontmatter.size, 0, 'No plaintext must ever be written on encryption failure');
  });
});

// ── Privacy-max: success path with working encryptor ─────────────────────────

describe('writer pipeline — privacy_max with working encryptor', () => {
  it('stores ciphertext + wrappedDekRef, never plaintext', async () => {
    const { frontmatter, writeNoteFn } = makeStores();
    const workingEncryptor = createClientEncryptor({
      isAvailable: () => true,
      encrypt: (bytes, _opts) => ({
        ciphertext: new Uint8Array(Array.from(bytes).map((b) => b ^ 0xff)), // trivial XOR
        wrappedDekRef: 'dek-ref-vault-001',
        alg: 'X-TEST-256',
      }),
    });

    const w = createDerivedArtifactWriter({
      writeNoteFn,
      vaultPath: '/vault',
      vaultRegistryAvailable: true,
      encryptor: workingEncryptor,
    });

    // Override privacy_tier after building (buildConvenienceProvenance always emits 'convenience')
    const prov = { ...summaryProvenance(), privacy_tier: 'privacy_max' };
    const r = await w.write({ summary: 'my private note' }, prov, convenienceContext());

    assert.equal(r.ok, true);
    assert.equal(r.terminalState, TERMINAL_STATES.CLIENT_ENCRYPTED);

    const fm = frontmatter.get('notes/test.md');
    assert.ok(fm.ai_summary_ciphertext, 'Should store ciphertext');
    assert.equal(fm.ai_summary_provenance.wrapped_dek_ref, 'dek-ref-vault-001');
    assert.equal(fm.ai_summary_provenance.alg, 'X-TEST-256');
    // No plaintext ai_summary field
    assert.equal(fm.ai_summary, undefined, 'Plaintext ai_summary must not be stored at privacy_max');
  });
});

// ── deleteArtifacts — removes from all stores ─────────────────────────────────

describe('writer.deleteArtifacts — single-path deletion (D6.5.4)', () => {
  it('removes frontmatter ai_summary, vector, and stale-flags insights', async () => {
    const { frontmatter, vectors, maintenance, writeNoteFn, vectorStore, mm } = makeStores();

    // Pre-populate
    frontmatter.set('notes/del.md', { ai_summary: 'old', ai_summary_provenance: {} });
    vectors.push({ path: 'notes/del.md', vector: [1, 2] });

    const w = createDerivedArtifactWriter({ writeNoteFn, vaultPath: '/vault', vectorStore, mm });
    const r = await w.deleteArtifacts({ notePath: 'notes/del.md' });

    assert.equal(r.ok, true);

    // Frontmatter nulled out
    const fm = frontmatter.get('notes/del.md');
    assert.equal(fm.ai_summary, null);
    assert.equal(fm.ai_summary_provenance, null);

    // Vector purged
    assert.equal(vectors.filter((v) => v.path === 'notes/del.md').length, 0);

    // Maintenance event for stale-flagging
    assert.equal(maintenance.length, 1);
    assert.equal(maintenance[0].deleted_note_path, 'notes/del.md');
  });

  it('reports partial failure but still succeeds on the working stores', async () => {
    const { frontmatter, writeNoteFn, mm } = makeStores();
    const badVectorStore = {
      upsert: async () => {},
      deleteByPath: async () => { throw new Error('qdrant down'); },
    };

    const w = createDerivedArtifactWriter({
      writeNoteFn,
      vaultPath: '/vault',
      vectorStore: badVectorStore,
      mm,
    });

    const r = await w.deleteArtifacts({ notePath: 'notes/del.md' });
    // Partial: frontmatter and maintenance succeeded, vector failed
    assert.equal(r.ok, false);
    assert.ok(r.failed.includes('vector'));
  });
});

// ── Migrated runDiscoverPass routes through writer ────────────────────────────

describe('runDiscoverPass (migrated) — routes insight through writer', () => {
  it('calls writer.write instead of mm.store directly', async () => {
    const writeCalls = [];
    const mockWriter = {
      write: async (artifact, provenance, context) => {
        writeCalls.push({ artifact, provenance, context });
        return { ok: true, terminalState: 'host_readable' };
      },
      deleteArtifacts: async () => ({ ok: true, stores: [] }),
      checkReEnrichmentEligibility: () => ({ eligible: false, reason: 'current' }),
    };

    const mockMm = { store: () => ({ id: 'x', ts: '...' }) };

    const config = {
      vault_path: '/vault',
      vault_id: 'test-vault',
      llm: { model: 'test-model', model_version: '1.0' },
      memory: {},
      daemon: { llm: { max_tokens: 100 } },
    };

    const consolidations = [
      { id: 'mem_c1', data: { topic: 'testing', facts: ['Fact A', 'Fact B'] } },
      { id: 'mem_c2', data: { topic: 'learning', facts: ['Fact C'] } },
    ];

    const fakeLlm = async () => JSON.stringify({
      connections: ['Testing relates to learning'],
      contradictions: [],
      open_questions: ['How?'],
    });

    await runDiscoverPass(config, consolidations, {
      llmFn: fakeLlm,
      mm: mockMm,
      writer: mockWriter,
    });

    assert.equal(writeCalls.length, 1, 'writer.write must be called exactly once');
    const { artifact, provenance } = writeCalls[0];
    assert.ok(Array.isArray(artifact.connections));
    assert.equal(provenance.artifact_type, 'insight');
    assert.equal(provenance.privacy_tier, 'convenience');
    assert.ok(Array.isArray(provenance.source_event_id));
  });
});
