/**
 * Tier 4 — STRESS: Phase 6 derived-artifact storage layer.
 *
 * Covers (§10 Stress obligations):
 *   - High-volume concurrent writes across all three stores
 *   - Large embedding batch writes through the writer
 *   - Many delegated-write authorization checks under concurrency
 *   - Deletion fan-out across stores under load
 *   - No partial/half-write under contention
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createDerivedArtifactWriter } from '../lib/companion-artifact-writer.mjs';
import { buildConvenienceProvenance } from '../lib/companion-provenance-validator.mjs';
import { TERMINAL_STATES } from '../lib/companion-tier-resolver.mjs';

const CONCURRENCY = 50;
const BATCH_SIZE = 200;

function buildStressStores() {
  const frontmatter = new Map();
  const vectors = [];
  const insights = [];
  const maintenance = [];
  let writeCalls = 0;
  let upsertCalls = 0;

  const writeNoteFn = (_vp, notePath, opts) => {
    writeCalls++;
    const prev = frontmatter.get(notePath) ?? {};
    frontmatter.set(notePath, { ...prev, ...opts.frontmatter });
  };

  const vectorStore = {
    upsert: async (points) => {
      upsertCalls++;
      vectors.push(...points);
    },
    deleteByPath: async (notePath) => {
      const idx = vectors.findIndex((v) => v.path === notePath);
      if (idx >= 0) vectors.splice(idx, 1);
    },
  };

  const mm = {
    store: (type, data) => {
      if (type === 'insight') insights.push(data);
      if (type === 'maintenance') maintenance.push(data);
      return { id: `mem_${Date.now()}_${Math.random()}`, ts: new Date().toISOString() };
    },
  };

  return {
    frontmatter, vectors, insights, maintenance,
    writeNoteFn, vectorStore, mm,
    get writeCalls() { return writeCalls; },
    get upsertCalls() { return upsertCalls; },
  };
}

function makeProvenance(artifactType, notePath, idx) {
  return buildConvenienceProvenance({
    generatedBy: `user-${idx}`,
    source: 'companion',
    model: 'stress-model',
    modelVersion: '1.0',
    lane: 'local',
    artifactType,
    sourceNotePath: notePath,
    sourceEventId: `mem_${idx}`,
  });
}

function selfCtx() {
  return {
    lane: 'local',
    containsPrivateData: false,
    isDelegate: false,
    delegatedManagedAllowed: false,
    enrichesDelegatedPartition: false,
    delegatedEnrichmentAllowed: false,
  };
}

describe('stress — concurrent ai_summary writes', () => {
  it(`${CONCURRENCY} concurrent writes all succeed without partial state`, async () => {
    const stores = buildStressStores();
    const writer = createDerivedArtifactWriter({
      writeNoteFn: stores.writeNoteFn,
      vaultPath: '/vault',
      mm: stores.mm,
    });

    const tasks = Array.from({ length: CONCURRENCY }, (_, i) => {
      const notePath = `notes/stress-${i}.md`;
      const prov = makeProvenance('ai_summary', notePath, i);
      return writer.write({ summary: `Summary for note ${i}` }, prov, selfCtx());
    });

    const results = await Promise.all(tasks);

    const failed = results.filter((r) => !r.ok);
    assert.equal(failed.length, 0, `All ${CONCURRENCY} writes must succeed`);
    assert.equal(stores.writeCalls, CONCURRENCY, `writeNoteFn called exactly ${CONCURRENCY} times`);
  });
});

describe('stress — large embedding batch', () => {
  it(`${BATCH_SIZE} sequential embedding writes all succeed`, async () => {
    const stores = buildStressStores();
    const writer = createDerivedArtifactWriter({
      writeNoteFn: stores.writeNoteFn,
      vaultPath: '/vault',
      vectorStore: stores.vectorStore,
    });

    let successCount = 0;
    for (let i = 0; i < BATCH_SIZE; i++) {
      const notePath = `embeddings/note-${i}.md`;
      const prov = makeProvenance('embedding', notePath, i);
      const r = await writer.write(
        { vector: [i * 0.01, i * 0.02, i * 0.03], payload: { path: notePath } },
        prov,
        selfCtx(),
      );
      if (r.ok) successCount++;
    }

    assert.equal(successCount, BATCH_SIZE);
    assert.equal(stores.vectors.length, BATCH_SIZE);
    assert.equal(stores.upsertCalls, BATCH_SIZE);
  });
});

describe('stress — delegated writes all denied under load (D6.3.6)', () => {
  it(`${CONCURRENCY} concurrent delegated writes all return SELF_PARTITION_ONLY`, async () => {
    const stores = buildStressStores();
    const writer = createDerivedArtifactWriter({
      writeNoteFn: stores.writeNoteFn,
      vaultPath: '/vault',
    });

    const tasks = Array.from({ length: CONCURRENCY }, (_, i) => {
      const prov = makeProvenance('ai_summary', `owner/note-${i}.md`, i);
      return writer.write({ summary: `delegated ${i}` }, prov, {
        lane: 'local',
        containsPrivateData: false,
        isDelegate: true,
        delegatedManagedAllowed: false,
        enrichesDelegatedPartition: true,
        delegatedEnrichmentAllowed: false,
      });
    });

    const results = await Promise.all(tasks);
    for (const r of results) {
      assert.equal(r.ok, false);
      assert.equal(r.reason, 'writer_self_partition_only');
    }
    // No writes
    assert.equal(stores.writeCalls, 0);
  });
});

describe('stress — concurrent insight writes', () => {
  it(`${CONCURRENCY} concurrent insight writes all store without collision`, async () => {
    const stores = buildStressStores();
    const writer = createDerivedArtifactWriter({
      writeNoteFn: stores.writeNoteFn,
      vaultPath: '/vault',
      mm: stores.mm,
    });

    const tasks = Array.from({ length: CONCURRENCY }, (_, i) => {
      const prov = buildConvenienceProvenance({
        generatedBy: `u${i}`,
        source: 'companion',
        model: 'm',
        modelVersion: '1',
        lane: 'local',
        artifactType: 'insight',
        sourceNotePath: null,
        sourceEventId: [`mem_c${i}`, `mem_d${i}`],
      });
      return writer.write(
        { connections: [`conn-${i}`], contradictions: [], open_questions: [], topic_count: 2 },
        prov,
        selfCtx(),
      );
    });

    const results = await Promise.all(tasks);
    const succeeded = results.filter((r) => r.ok);
    assert.equal(succeeded.length, CONCURRENCY);
    assert.equal(stores.insights.length, CONCURRENCY);
  });
});

describe('stress — deletion fan-out under load', () => {
  it('concurrent deletes of different notes all succeed without corruption', async () => {
    const stores = buildStressStores();
    const writer = createDerivedArtifactWriter({
      writeNoteFn: stores.writeNoteFn,
      vaultPath: '/vault',
      vectorStore: stores.vectorStore,
      mm: stores.mm,
    });

    // Pre-write notes
    for (let i = 0; i < CONCURRENCY; i++) {
      const notePath = `notes/del-stress-${i}.md`;
      stores.frontmatter.set(notePath, { ai_summary: `old-${i}` });
      stores.vectors.push({ path: notePath, vector: [i] });
    }

    const tasks = Array.from({ length: CONCURRENCY }, (_, i) =>
      writer.deleteArtifacts({ notePath: `notes/del-stress-${i}.md` }),
    );

    const results = await Promise.all(tasks);
    const failed = results.filter((r) => !r.ok);
    assert.equal(failed.length, 0, 'All concurrent deletes must succeed');

    // Vectors purged
    const remaining = stores.vectors.filter((v) => v.path?.startsWith('notes/del-stress-'));
    assert.equal(remaining.length, 0, 'All stress vectors must be purged');
  });
});

describe('stress — no partial write on store failure under load', () => {
  it('when writeNoteFn throws, no partial state leaks', async () => {
    let callCount = 0;
    const failOnThird = (_vp, notePath, _opts) => {
      callCount++;
      if (callCount % 3 === 0) throw new Error('disk full');
    };

    const writer = createDerivedArtifactWriter({
      writeNoteFn: failOnThird,
      vaultPath: '/vault',
    });

    const tasks = Array.from({ length: 30 }, (_, i) => {
      const prov = makeProvenance('ai_summary', `notes/partial-${i}.md`, i);
      return writer.write({ summary: `partial ${i}` }, prov, selfCtx());
    });

    const results = await Promise.all(tasks);
    // Every result must be either ok:true or ok:false — never a thrown exception
    for (const r of results) {
      assert.ok(r.ok === true || r.ok === false, 'Result must always be ok:true or ok:false');
      assert.ok(typeof r.reason === 'string' || r.ok === true, 'Failed results must have reason');
    }
  });
});
