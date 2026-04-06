/**
 * Tests for netlify/functions/consolidation-scheduler.mjs (Stream 0 — Session 10).
 *
 * Covers:
 *   - isUserDue: enabled=false, never run, not yet due, exactly due, overdue
 *   - runScheduler: skips disabled users
 *   - runScheduler: skips users not yet due
 *   - runScheduler: triggers due users, updates consolidation_last_pass_at
 *   - runScheduler: per-user errors do not abort the rest of the run
 *   - runScheduler: MAX_USERS_PER_RUN cap is respected
 *   - runScheduler: shadow mode (BILLING_ENFORCE=false) logs intent, skips bridge call
 *   - runScheduler: missing SESSION_SECRET throws
 *   - runScheduler: missing BRIDGE_URL throws
 *   - normalizeBillingUser: consolidation_enabled defaults to false
 *   - defaultUserRecord: includes consolidation_enabled=false
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isUserDue, signServiceJwt, runScheduler } from '../netlify/functions/consolidation-scheduler.mjs';
import { normalizeBillingUser, defaultUserRecord } from '../hub/gateway/billing-logic.mjs';
import jwt from 'jsonwebtoken';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SECRET = 'test-session-secret-32-chars-long!';
const BRIDGE = 'https://bridge.example.com';
const NOW_MS = new Date('2026-04-05T12:00:00.000Z').getTime();

function makeUser(overrides = {}) {
  return {
    user_id: 'user_' + Math.random().toString(36).slice(2, 8),
    tier: 'plus',
    consolidation_enabled: true,
    consolidation_interval_minutes: 60,
    consolidation_last_pass_at: null,
    ...overrides,
  };
}

/** Returns a mock billing DB with the given users. */
function makeDb(users) {
  const map = {};
  for (const u of users) map[u.user_id] = { ...u };
  return { users: map, processed_events: [] };
}

/**
 * Builds the standard runScheduler options with mocked loadDb / mutateDb / fetchFn.
 * @param {object[]} users - Initial user list
 * @param {object}   fetchResponses - Map of userId → { ok, json?, text? } to control fetch
 */
function makeOpts(users, fetchResponses = {}) {
  let db = makeDb(users);

  const loadDb = async () => JSON.parse(JSON.stringify(db));

  const mutateDb = async (fn) => {
    const copy = JSON.parse(JSON.stringify(db));
    fn(copy);
    db = copy;
  };

  const getDb = () => db;

  const fetchFn = async (url) => {
    // Derive userId from the URL or use a per-user override keyed by the first matching userId.
    const matchedUser = users.find(u => Object.prototype.hasOwnProperty.call(fetchResponses, u.user_id));
    const override = matchedUser ? fetchResponses[matchedUser.user_id] : null;

    if (override?.throws) throw override.throws;

    const ok = override ? override.ok !== false : true;
    const json = override?.json ?? { topics: 2, total_events: 10, cost_usd: 0.003, pass_id: 'cpass_test' };
    const text = override?.text ?? JSON.stringify(json);

    return {
      ok,
      status: ok ? 200 : (override?.status ?? 500),
      json: async () => json,
      text: async () => text,
    };
  };

  return { loadDb, mutateDb, getDb, fetchFn };
}

// ── isUserDue ─────────────────────────────────────────────────────────────────

describe('isUserDue', () => {
  it('returns false when consolidation_enabled is false', () => {
    const user = makeUser({ consolidation_enabled: false });
    assert.equal(isUserDue(user, NOW_MS), false);
  });

  it('returns false when consolidation_interval_minutes is 0', () => {
    const user = makeUser({ consolidation_interval_minutes: 0 });
    assert.equal(isUserDue(user, NOW_MS), false);
  });

  it('returns false when consolidation_interval_minutes is negative', () => {
    const user = makeUser({ consolidation_interval_minutes: -60 });
    assert.equal(isUserDue(user, NOW_MS), false);
  });

  it('returns false when consolidation_interval_minutes is NaN/null', () => {
    assert.equal(isUserDue(makeUser({ consolidation_interval_minutes: null }), NOW_MS), false);
    assert.equal(isUserDue(makeUser({ consolidation_interval_minutes: NaN }), NOW_MS), false);
  });

  it('returns true when last_pass_at is null (never run)', () => {
    const user = makeUser({ consolidation_last_pass_at: null });
    assert.equal(isUserDue(user, NOW_MS), true);
  });

  it('returns true when last_pass_at is missing', () => {
    const user = makeUser({ consolidation_last_pass_at: undefined });
    assert.equal(isUserDue(user, NOW_MS), true);
  });

  it('returns true when interval has elapsed', () => {
    const lastPass = NOW_MS - 61 * 60_000; // 61 minutes ago, interval = 60 min
    const user = makeUser({
      consolidation_interval_minutes: 60,
      consolidation_last_pass_at: new Date(lastPass).toISOString(),
    });
    assert.equal(isUserDue(user, NOW_MS), true);
  });

  it('returns true at exactly the due moment (lastPass + interval === now)', () => {
    const lastPass = NOW_MS - 60 * 60_000; // exactly 60 minutes ago
    const user = makeUser({
      consolidation_interval_minutes: 60,
      consolidation_last_pass_at: new Date(lastPass).toISOString(),
    });
    assert.equal(isUserDue(user, NOW_MS), true);
  });

  it('returns false when interval has NOT elapsed', () => {
    const lastPass = NOW_MS - 59 * 60_000; // 59 min ago, interval = 60 min
    const user = makeUser({
      consolidation_interval_minutes: 60,
      consolidation_last_pass_at: new Date(lastPass).toISOString(),
    });
    assert.equal(isUserDue(user, NOW_MS), false);
  });

  it('returns false for null user', () => {
    assert.equal(isUserDue(null, NOW_MS), false);
  });
});

// ── signServiceJwt ────────────────────────────────────────────────────────────

describe('signServiceJwt', () => {
  it('produces a verifiable JWT with sub = userId and role = service', () => {
    const token = signServiceJwt('user_abc', SECRET);
    const payload = jwt.verify(token, SECRET);
    assert.equal(payload.sub, 'user_abc');
    assert.equal(payload.role, 'service');
  });

  it('expires in approximately 5 minutes', () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signServiceJwt('user_abc', SECRET);
    const payload = jwt.decode(token);
    const ttl = payload.exp - before;
    assert.ok(ttl > 280 && ttl <= 310, `expected ~300s TTL, got ${ttl}s`);
  });
});

// ── runScheduler: guard conditions ────────────────────────────────────────────

describe('runScheduler — guard conditions', () => {
  it('throws when SESSION_SECRET is missing', async () => {
    await assert.rejects(
      () =>
        runScheduler({
          sessionSecret: '',
          bridgeUrl: BRIDGE,
          billingEnforce: true,
          nowMs: NOW_MS,
          loadDb: async () => makeDb([]),
          mutateDb: async () => {},
          fetchFn: async () => {},
        }),
      /SESSION_SECRET/,
    );
  });

  it('throws when BRIDGE_URL is missing', async () => {
    await assert.rejects(
      () =>
        runScheduler({
          sessionSecret: SECRET,
          bridgeUrl: '',
          billingEnforce: true,
          nowMs: NOW_MS,
          loadDb: async () => makeDb([]),
          mutateDb: async () => {},
          fetchFn: async () => {},
        }),
      /BRIDGE_URL/,
    );
  });
});

// ── runScheduler: users with consolidation_enabled=false are skipped ──────────

describe('runScheduler — skips disabled users', () => {
  it('does not call bridge for users with consolidation_enabled=false', async () => {
    const users = [
      makeUser({ consolidation_enabled: false }),
      makeUser({ consolidation_enabled: false }),
    ];
    let fetchCalled = 0;
    const { loadDb, mutateDb } = makeOpts(users);

    const result = await runScheduler({
      sessionSecret: SECRET,
      bridgeUrl: BRIDGE,
      billingEnforce: true,
      nowMs: NOW_MS,
      loadDb,
      mutateDb,
      fetchFn: async () => { fetchCalled++; return { ok: true, json: async () => ({}) }; },
    });

    assert.equal(fetchCalled, 0);
    assert.equal(result.pass_count, 0);
    assert.equal(result.skipped_not_enabled, 2);
    assert.equal(result.skipped_not_due, 0);
  });
});

// ── runScheduler: users not yet due are skipped ───────────────────────────────

describe('runScheduler — skips users not yet due', () => {
  it('does not call bridge for users whose interval has not elapsed', async () => {
    const recentPassAt = new Date(NOW_MS - 30 * 60_000).toISOString(); // 30 min ago, interval 60 min
    const users = [
      makeUser({ consolidation_interval_minutes: 60, consolidation_last_pass_at: recentPassAt }),
      makeUser({ consolidation_interval_minutes: 120, consolidation_last_pass_at: recentPassAt }),
    ];
    let fetchCalled = 0;
    const { loadDb, mutateDb } = makeOpts(users);

    const result = await runScheduler({
      sessionSecret: SECRET,
      bridgeUrl: BRIDGE,
      billingEnforce: true,
      nowMs: NOW_MS,
      loadDb,
      mutateDb,
      fetchFn: async () => { fetchCalled++; return { ok: true, json: async () => ({}) }; },
    });

    assert.equal(fetchCalled, 0);
    assert.equal(result.pass_count, 0);
    assert.equal(result.skipped_not_due, 2);
  });
});

// ── runScheduler: due users are triggered and last_pass_at updated ────────────

describe('runScheduler — triggers due users and updates last_pass_at', () => {
  it('calls bridge for each due user and stamps consolidation_last_pass_at', async () => {
    const overdueAt = new Date(NOW_MS - 90 * 60_000).toISOString(); // 90 min ago, interval 60 min
    const userA = makeUser({ consolidation_interval_minutes: 60, consolidation_last_pass_at: overdueAt });
    const userB = makeUser({ consolidation_interval_minutes: 60, consolidation_last_pass_at: null });
    const users = [userA, userB];

    const fetchedUrls = [];
    const fetchedTokenSubs = [];

    const { loadDb, mutateDb, getDb } = makeOpts(users);

    const fetchFn = async (url, init) => {
      fetchedUrls.push(url);
      const authHeader = init?.headers?.Authorization ?? '';
      const token = authHeader.replace('Bearer ', '');
      const payload = jwt.verify(token, SECRET);
      fetchedTokenSubs.push(payload.sub);

      return {
        ok: true,
        json: async () => ({ topics: 3, total_events: 15, cost_usd: 0.004, pass_id: 'cpass_xyz' }),
        text: async () => '',
      };
    };

    const result = await runScheduler({
      sessionSecret: SECRET,
      bridgeUrl: BRIDGE,
      billingEnforce: true,
      nowMs: NOW_MS,
      loadDb,
      mutateDb,
      fetchFn,
    });

    assert.equal(result.pass_count, 2);
    assert.equal(result.errors.length, 0);
    assert.equal(fetchedUrls.length, 2);
    assert.ok(fetchedUrls.every(u => u === `${BRIDGE}/api/v1/memory/consolidate`));

    // Each JWT must carry the correct user ID.
    assert.ok(fetchedTokenSubs.includes(userA.user_id));
    assert.ok(fetchedTokenSubs.includes(userB.user_id));

    // consolidation_last_pass_at must be updated in the DB for both users.
    const finalDb = getDb();
    const expectedTs = new Date(NOW_MS).toISOString();
    assert.equal(finalDb.users[userA.user_id].consolidation_last_pass_at, expectedTs);
    assert.equal(finalDb.users[userB.user_id].consolidation_last_pass_at, expectedTs);
  });

  it('sets Content-Type: application/json on the bridge request', async () => {
    const user = makeUser({ consolidation_last_pass_at: null });
    let capturedHeaders = null;
    const { loadDb, mutateDb } = makeOpts([user]);

    await runScheduler({
      sessionSecret: SECRET,
      bridgeUrl: BRIDGE,
      billingEnforce: true,
      nowMs: NOW_MS,
      loadDb,
      mutateDb,
      fetchFn: async (_url, init) => {
        capturedHeaders = init?.headers ?? {};
        return { ok: true, json: async () => ({}), text: async () => '' };
      },
    });

    assert.equal(capturedHeaders['Content-Type'], 'application/json');
  });

  it('POST body includes lookback and caps from billing user record', async () => {
    const user = makeUser({
      consolidation_last_pass_at: null,
      consolidation_lookback_hours: 48,
      consolidation_max_events_per_pass: 99,
      consolidation_max_topics_per_pass: 4,
      consolidation_llm_max_tokens: 2048,
    });
    let parsed = null;
    const { loadDb, mutateDb } = makeOpts([user]);

    await runScheduler({
      sessionSecret: SECRET,
      bridgeUrl: BRIDGE,
      billingEnforce: true,
      nowMs: NOW_MS,
      loadDb,
      mutateDb,
      fetchFn: async (_url, init) => {
        parsed = JSON.parse(init.body);
        return { ok: true, json: async () => ({ topics: [], total_events: 0 }), text: async () => '' };
      },
    });

    assert.equal(parsed.lookback_hours, 48);
    assert.equal(parsed.max_events_per_pass, 99);
    assert.equal(parsed.max_topics_per_pass, 4);
    assert.equal(parsed.llm.max_tokens, 2048);
    assert.equal(parsed.passes.consolidate, true);
    assert.equal(parsed.passes.verify, true);
  });
});

// ── runScheduler: per-user errors do not abort the run ────────────────────────

describe('runScheduler — per-user errors do not abort the run', () => {
  it('logs error for the failing user and continues processing remaining users', async () => {
    const failUser = makeUser({ consolidation_last_pass_at: null });
    const okUser = makeUser({ consolidation_last_pass_at: null });
    const { loadDb, mutateDb, getDb } = makeOpts([failUser, okUser]);

    let callCount = 0;
    const fetchFn = async (_url, init) => {
      callCount++;
      // Identify which user by decoding the JWT sub claim.
      const auth = init?.headers?.Authorization ?? '';
      const token = auth.replace('Bearer ', '');
      const payload = jwt.decode(token);

      if (payload?.sub === failUser.user_id) {
        return { ok: false, status: 500, json: async () => ({}), text: async () => 'internal error' };
      }
      return { ok: true, json: async () => ({ topics: 1, total_events: 5, cost_usd: 0.001, pass_id: 'cpass_ok' }), text: async () => '' };
    };

    const result = await runScheduler({
      sessionSecret: SECRET,
      bridgeUrl: BRIDGE,
      billingEnforce: true,
      nowMs: NOW_MS,
      loadDb,
      mutateDb,
      fetchFn,
    });

    // Both users were attempted.
    assert.equal(callCount, 2);
    // One succeeded, one failed.
    assert.equal(result.pass_count, 1);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].user_id, failUser.user_id);
    assert.ok(result.errors[0].error.includes('500'));

    // The successful user's last_pass_at must be updated.
    const finalDb = getDb();
    assert.equal(finalDb.users[okUser.user_id].consolidation_last_pass_at, new Date(NOW_MS).toISOString());
    // The failed user's last_pass_at must NOT be updated.
    assert.equal(finalDb.users[failUser.user_id].consolidation_last_pass_at, null);
  });

  it('handles fetch throwing (network error) without aborting the run', async () => {
    const netErrUser = makeUser({ consolidation_last_pass_at: null });
    const okUser = makeUser({ consolidation_last_pass_at: null });
    const { loadDb, mutateDb } = makeOpts([netErrUser, okUser]);

    const fetchFn = async (_url, init) => {
      const auth = init?.headers?.Authorization ?? '';
      const payload = jwt.decode(auth.replace('Bearer ', ''));
      if (payload?.sub === netErrUser.user_id) throw new Error('ECONNREFUSED');
      return { ok: true, json: async () => ({ topics: 1, total_events: 3, cost_usd: 0.001, pass_id: 'p1' }), text: async () => '' };
    };

    const result = await runScheduler({
      sessionSecret: SECRET,
      bridgeUrl: BRIDGE,
      billingEnforce: true,
      nowMs: NOW_MS,
      loadDb,
      mutateDb,
      fetchFn,
    });

    assert.equal(result.pass_count, 1);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0].error.includes('ECONNREFUSED'));
  });
});

// ── runScheduler: MAX_USERS_PER_RUN cap ───────────────────────────────────────

describe('runScheduler — MAX_USERS_PER_RUN cap is respected', () => {
  it('only processes up to maxUsersPerRun users even when more are due', async () => {
    const users = Array.from({ length: 10 }, () => makeUser({ consolidation_last_pass_at: null }));
    let fetchCalled = 0;
    const { loadDb, mutateDb } = makeOpts(users);

    const result = await runScheduler({
      sessionSecret: SECRET,
      bridgeUrl: BRIDGE,
      billingEnforce: true,
      maxUsersPerRun: 3,
      nowMs: NOW_MS,
      loadDb,
      mutateDb,
      fetchFn: async () => {
        fetchCalled++;
        return { ok: true, json: async () => ({ topics: 1, total_events: 5, cost_usd: 0.001, pass_id: 'px' }), text: async () => '' };
      },
    });

    assert.equal(fetchCalled, 3);
    assert.equal(result.pass_count, 3);
    assert.equal(result.capped, 7); // 10 due − 3 processed = 7 capped
  });

  it('processes all users when count is below the cap', async () => {
    const users = Array.from({ length: 2 }, () => makeUser({ consolidation_last_pass_at: null }));
    let fetchCalled = 0;
    const { loadDb, mutateDb } = makeOpts(users);

    const result = await runScheduler({
      sessionSecret: SECRET,
      bridgeUrl: BRIDGE,
      billingEnforce: true,
      maxUsersPerRun: 20,
      nowMs: NOW_MS,
      loadDb,
      mutateDb,
      fetchFn: async () => {
        fetchCalled++;
        return { ok: true, json: async () => ({}), text: async () => '' };
      },
    });

    assert.equal(fetchCalled, 2);
    assert.equal(result.capped, 0);
  });
});

// ── runScheduler: shadow mode (BILLING_ENFORCE !== 'true') ────────────────────

describe('runScheduler — shadow mode', () => {
  it('does not call bridge when billingEnforce=false, but counts the pass', async () => {
    const user = makeUser({ consolidation_last_pass_at: null });
    let fetchCalled = 0;
    const { loadDb, mutateDb, getDb } = makeOpts([user]);

    const result = await runScheduler({
      sessionSecret: SECRET,
      bridgeUrl: BRIDGE,
      billingEnforce: false,
      nowMs: NOW_MS,
      loadDb,
      mutateDb,
      fetchFn: async () => { fetchCalled++; return { ok: true, json: async () => ({}) }; },
    });

    assert.equal(fetchCalled, 0, 'bridge must not be called in shadow mode');
    assert.equal(result.pass_count, 1, 'shadow pass is still counted');
    assert.equal(result.shadow_mode, true);

    // last_pass_at must NOT be updated in shadow mode.
    const finalDb = getDb();
    assert.equal(finalDb.users[user.user_id].consolidation_last_pass_at, null);
  });

  it('reports shadow_mode=false when billingEnforce=true', async () => {
    const { loadDb, mutateDb } = makeOpts([]);
    const result = await runScheduler({
      sessionSecret: SECRET,
      bridgeUrl: BRIDGE,
      billingEnforce: true,
      nowMs: NOW_MS,
      loadDb,
      mutateDb,
      fetchFn: async () => ({ ok: true, json: async () => ({}) }),
    });
    assert.equal(result.shadow_mode, false);
  });
});

// ── runScheduler: mixed enabled/disabled/due/not-due ─────────────────────────

describe('runScheduler — mixed user states', () => {
  it('correctly partitions skipped_not_enabled, skipped_not_due, and triggered users', async () => {
    const recentAt = new Date(NOW_MS - 30 * 60_000).toISOString();
    const overdueAt = new Date(NOW_MS - 90 * 60_000).toISOString();

    const disabled = makeUser({ consolidation_enabled: false });
    const notDue = makeUser({ consolidation_interval_minutes: 60, consolidation_last_pass_at: recentAt });
    const due1 = makeUser({ consolidation_interval_minutes: 60, consolidation_last_pass_at: overdueAt });
    const due2 = makeUser({ consolidation_interval_minutes: 60, consolidation_last_pass_at: null });

    const { loadDb, mutateDb } = makeOpts([disabled, notDue, due1, due2]);

    const result = await runScheduler({
      sessionSecret: SECRET,
      bridgeUrl: BRIDGE,
      billingEnforce: true,
      nowMs: NOW_MS,
      loadDb,
      mutateDb,
      fetchFn: async () => ({ ok: true, json: async () => ({ topics: 1, total_events: 2, cost_usd: 0.001, pass_id: 'p' }), text: async () => '' }),
    });

    assert.equal(result.skipped_not_enabled, 1); // disabled
    assert.equal(result.skipped_not_due, 1);      // notDue
    assert.equal(result.pass_count, 2);            // due1 + due2
    assert.equal(result.errors.length, 0);
  });
});

// ── billing-logic: consolidation_enabled field ────────────────────────────────

describe('normalizeBillingUser — consolidation_enabled', () => {
  it('defaults consolidation_enabled to false when field is missing', () => {
    const u = { user_id: 'u1', monthly_consolidation_jobs_used: 0 };
    normalizeBillingUser(u);
    assert.equal(u.consolidation_enabled, false);
  });

  it('preserves consolidation_enabled=true if already set', () => {
    const u = { user_id: 'u1', consolidation_enabled: true, monthly_consolidation_jobs_used: 0 };
    normalizeBillingUser(u);
    assert.equal(u.consolidation_enabled, true);
  });

  it('preserves consolidation_enabled=false if explicitly set', () => {
    const u = { user_id: 'u1', consolidation_enabled: false, monthly_consolidation_jobs_used: 0 };
    normalizeBillingUser(u);
    assert.equal(u.consolidation_enabled, false);
  });
});

describe('defaultUserRecord — consolidation_enabled', () => {
  it('includes consolidation_enabled=false in the default record', () => {
    const u = defaultUserRecord('u_test');
    assert.equal(Object.prototype.hasOwnProperty.call(u, 'consolidation_enabled'), true);
    assert.equal(u.consolidation_enabled, false);
  });

  it('includes consolidation_last_pass_at=null', () => {
    const u = defaultUserRecord('u_test');
    assert.equal(u.consolidation_last_pass_at, null);
  });

  it('includes consolidation_interval_minutes=null', () => {
    const u = defaultUserRecord('u_test');
    assert.equal(u.consolidation_interval_minutes, null);
  });
});
