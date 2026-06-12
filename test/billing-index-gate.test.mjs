/**
 * Billing index-gate regression tests.
 *
 * These tests lock the hosted reindex contract to the same counters the Hub
 * billing panel shows: monthly index jobs and indexing-token packs, not the
 * legacy hidden cents ledger.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { MONTHLY_INDEX_JOBS_INCLUDED_BY_TIER } from '../hub/gateway/billing-constants.mjs';
import { runBillingGate } from '../hub/gateway/billing-middleware.mjs';
import { recordIndexingTokensAfterBridgeIndex } from '../hub/gateway/billing-index-usage.mjs';

const UID = 'google:index-gate-regression';
const SECRET = 'billing-index-gate-test-secret';

let originalBillingEnforce;
let originalBillingShadowLog;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeBlob(initialDb) {
  let state = clone(initialDb);
  return {
    async get(key) {
      return key === 'billing-db-v1' ? clone(state) : null;
    },
    async setJSON(key, value) {
      if (key !== 'billing-db-v1') throw new Error(`unexpected blob key: ${key}`);
      state = clone(value);
    },
    snapshot() {
      return clone(state);
    },
  };
}

function plusUser(overrides = {}) {
  return {
    user_id: UID,
    tier: 'plus',
    stripe_customer_id: 'cus_index_gate',
    stripe_subscription_id: 'sub_index_gate',
    has_active_subscription: true,
    monthly_included_cents: 900,
    monthly_used_cents: 900,
    addon_cents: 0,
    monthly_indexing_tokens_used: 0,
    pack_indexing_tokens_balance: 0,
    monthly_searches_used: 0,
    monthly_index_jobs_used: 8,
    monthly_consolidation_jobs_used: 0,
    ...overrides,
  };
}

function installBillingDb(user = plusUser()) {
  const blob = makeBlob({ users: { [UID]: user }, processed_events: [] });
  globalThis.__knowtation_gateway_blob = blob;
  return blob;
}

function makeIndexReq() {
  return {
    method: 'POST',
    baseUrl: '',
    path: '/api/v1/index',
    originalUrl: '/api/v1/index',
    url: '/api/v1/index',
  };
}

function makeRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function getUserId() {
  return UID;
}

describe('billing index gate - unit', () => {
  it('plus tier has the visible monthly index-job allowance used by the Hub', () => {
    assert.equal(MONTHLY_INDEX_JOBS_INCLUDED_BY_TIER.plus, 50);
  });
});

describe('billing index gate - integration', () => {
  beforeEach(() => {
    originalBillingEnforce = process.env.BILLING_ENFORCE;
    originalBillingShadowLog = process.env.BILLING_SHADOW_LOG;
    process.env.BILLING_ENFORCE = 'true';
    process.env.BILLING_SHADOW_LOG = 'false';
  });

  afterEach(() => {
    if (originalBillingEnforce === undefined) delete process.env.BILLING_ENFORCE;
    else process.env.BILLING_ENFORCE = originalBillingEnforce;
    if (originalBillingShadowLog === undefined) delete process.env.BILLING_SHADOW_LOG;
    else process.env.BILLING_SHADOW_LOG = originalBillingShadowLog;
    delete globalThis.__knowtation_gateway_blob;
  });

  it('allows reindex when visible index jobs remain even if hidden legacy credits are exhausted', async () => {
    const blob = installBillingDb(plusUser({
      monthly_used_cents: 900,
      addon_cents: 0,
      monthly_index_jobs_used: 8,
    }));
    const res = makeRes();

    const ok = await runBillingGate(makeIndexReq(), res, getUserId);

    assert.equal(ok, true);
    assert.equal(res.statusCode, null);
    const db = blob.snapshot();
    assert.equal(db.users[UID].monthly_used_cents, 900, 'legacy credits must not be charged for index gate');
    assert.equal(db.users[UID].monthly_index_jobs_used, 8, 'preflight gate must not count a job before bridge accepts it');
  });
});

describe('billing index gate - e2e usage recording', () => {
  beforeEach(() => {
    process.env.BILLING_ENFORCE = 'true';
    process.env.BILLING_SHADOW_LOG = 'false';
  });

  afterEach(() => {
    delete process.env.BILLING_ENFORCE;
    delete process.env.BILLING_SHADOW_LOG;
    delete globalThis.__knowtation_gateway_blob;
  });

  it('records a successful sync reindex as one job plus embedding tokens', async () => {
    const blob = installBillingDb(plusUser({ monthly_index_jobs_used: 8, monthly_indexing_tokens_used: 100 }));

    await recordIndexingTokensAfterBridgeIndex(UID, 200, JSON.stringify({
      ok: true,
      notesProcessed: 3,
      chunksIndexed: 7,
      embedding_input_tokens: 1200,
    }));

    const user = blob.snapshot().users[UID];
    assert.equal(user.monthly_index_jobs_used, 9);
    assert.equal(user.monthly_indexing_tokens_used, 1300);
  });
});

describe('billing index gate - stress', () => {
  beforeEach(() => {
    process.env.BILLING_SHADOW_LOG = 'false';
  });

  afterEach(() => {
    delete process.env.BILLING_SHADOW_LOG;
    delete globalThis.__knowtation_gateway_blob;
  });

  it('serializes concurrent background-accepted job recordings without losing increments', async () => {
    const blob = installBillingDb(plusUser({ monthly_index_jobs_used: 10 }));
    await Promise.all(Array.from({ length: 5 }, () =>
      recordIndexingTokensAfterBridgeIndex(UID, 202, JSON.stringify({ status: 'background' })),
    ));

    assert.equal(blob.snapshot().users[UID].monthly_index_jobs_used, 15);
  });
});

describe('billing index gate - data integrity', () => {
  beforeEach(() => {
    process.env.BILLING_SHADOW_LOG = 'false';
  });

  afterEach(() => {
    delete process.env.BILLING_SHADOW_LOG;
    delete globalThis.__knowtation_gateway_blob;
  });

  it('counts a cached successful reindex even when no new embedding tokens are used', async () => {
    const blob = installBillingDb(plusUser({
      monthly_index_jobs_used: 12,
      monthly_indexing_tokens_used: 2000,
      pack_indexing_tokens_balance: 20_000_000,
    }));

    await recordIndexingTokensAfterBridgeIndex(UID, 200, JSON.stringify({
      ok: true,
      chunksSkippedCached: 14,
      embedding_input_tokens: 0,
    }));

    const user = blob.snapshot().users[UID];
    assert.equal(user.monthly_index_jobs_used, 13);
    assert.equal(user.monthly_indexing_tokens_used, 2000);
    assert.equal(user.pack_indexing_tokens_balance, 20_000_000);
  });
});

describe('billing index gate - performance', () => {
  beforeEach(() => {
    process.env.BILLING_ENFORCE = 'true';
    process.env.BILLING_SHADOW_LOG = 'false';
  });

  afterEach(() => {
    delete process.env.BILLING_ENFORCE;
    delete process.env.BILLING_SHADOW_LOG;
    delete globalThis.__knowtation_gateway_blob;
  });

  it('checks an allowed reindex gate quickly', async () => {
    installBillingDb(plusUser({ monthly_index_jobs_used: 1 }));
    const start = Date.now();
    const ok = await runBillingGate(makeIndexReq(), makeRes(), getUserId);
    const elapsed = Date.now() - start;

    assert.equal(ok, true);
    assert.ok(elapsed < 500, `index gate took ${elapsed} ms`);
  });
});

describe('billing index gate - security', () => {
  beforeEach(() => {
    process.env.BILLING_ENFORCE = 'true';
    process.env.BILLING_SHADOW_LOG = 'false';
  });

  afterEach(() => {
    delete process.env.BILLING_ENFORCE;
    delete process.env.BILLING_SHADOW_LOG;
    delete globalThis.__knowtation_gateway_blob;
  });

  it('blocks exhausted visible index jobs without leaking secrets or falling back to legacy credits', async () => {
    installBillingDb(plusUser({
      monthly_included_cents: 900,
      monthly_used_cents: 0,
      monthly_index_jobs_used: 50,
      pack_indexing_tokens_balance: 0,
    }));
    const res = makeRes();

    const ok = await runBillingGate(makeIndexReq(), res, getUserId);

    assert.equal(ok, false);
    assert.equal(res.statusCode, 402);
    assert.equal(res.body.code, 'INDEX_JOB_QUOTA_EXHAUSTED');
    const payload = JSON.stringify(res.body);
    assert.ok(!payload.includes(SECRET));
    assert.ok(!payload.includes('node_modules'));
  });

  it('allows monthly index overage when a rollover indexing-token pack exists', async () => {
    installBillingDb(plusUser({
      monthly_used_cents: 900,
      monthly_index_jobs_used: 50,
      pack_indexing_tokens_balance: 20_000_000,
    }));
    const res = makeRes();

    const ok = await runBillingGate(makeIndexReq(), res, getUserId);

    assert.equal(ok, true);
    assert.equal(res.statusCode, null);
  });
});
