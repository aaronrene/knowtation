/**
 * Hosted calendar store persistence (Netlify Blobs) — INF-KN-3b.
 *
 * Tiers: unit, integration, data-integrity, security.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CALENDAR_STORE_BLOB_KEY,
  calendarOAuthBlobKey,
  hydrateCalendarStoresFromBlob,
  mergeCalendarStoreJson,
  persistCalendarStoresToBlob,
  withCalendarBlobSync,
} from '../hub/bridge/calendar-blob-store.mjs';
import { getCalendarStorePath, saveCalendarStore } from '../lib/calendar/event-store.mjs';
import { writeOAuthTokenVault } from '../lib/calendar/oauth-token-vault.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-blob-inf-kn-3b');

/**
 * @returns {{
 *   get: (k: string, o?: { type?: string, consistency?: string }) => Promise<string|null>,
 *   set: (k: string, v: string) => Promise<void>,
 *   map: Map<string, string>,
 *   getCalls: Array<{ key: string, consistency?: string }>,
 * }}
 */
function makeMockBlobStore() {
  const map = new Map();
  /** @type {Array<{ key: string, consistency?: string }>} */
  const getCalls = [];
  return {
    map,
    getCalls,
    async get(key, opts) {
      getCalls.push({
        key,
        ...(opts?.consistency !== undefined ? { consistency: opts.consistency } : {}),
      });
      const v = map.get(key);
      if (v == null) return null;
      return opts?.type === 'text' || typeof v === 'string' ? v : null;
    },
    async set(key, value) {
      map.set(key, value);
    },
  };
}

describe('INF-KN-3b calendar blob store — unit', () => {
  it('calendarOAuthBlobKey namespaces connector token blobs', () => {
    assert.equal(calendarOAuthBlobKey('conn_abc12345'), 'calendar/oauth/conn_abc12345.enc');
  });

  it('mergeCalendarStoreJson keeps fresher pending OAuth over stale connected blob', () => {
    const blob = JSON.stringify({
      vaults: {
        default: {
          connectors: [{
            connector_id: 'conn_same',
            provider: 'google',
            display_name: 'Old',
            status: 'connected',
            oauth_ref: 'conn_same',
            account_sub: 'sub',
            sync_cursors: {},
            last_sync_at: '2026-07-01T00:00:00.000Z',
            last_sync_error: 'none',
            revoked_at: null,
            oauth_pending: null,
          }],
          source_calendars: [],
          events: [],
        },
      },
    });
    const local = JSON.stringify({
      vaults: {
        default: {
          connectors: [{
            connector_id: 'conn_same',
            provider: 'google',
            display_name: 'Pending',
            status: 'pending',
            oauth_ref: null,
            account_sub: null,
            sync_cursors: {},
            last_sync_at: null,
            last_sync_error: null,
            revoked_at: null,
            oauth_pending: {
              state: 'state-abc',
              code_verifier: 'v',
              return_url: 'https://scooling.netlify.app/settings/calendar/connect/callback',
              expires_at: '2099-01-01T00:00:00.000Z',
            },
          }],
          source_calendars: [],
          events: [],
        },
      },
    });
    const merged = JSON.parse(mergeCalendarStoreJson(local, blob));
    const connector = merged.vaults.default.connectors[0];
    assert.equal(connector.status, 'pending');
    assert.equal(connector.oauth_pending.state, 'state-abc');
  });
});

describe('INF-KN-3b calendar blob store — integration', () => {
  /** @type {string} */
  let dataDir;

  beforeEach(() => {
    dataDir = path.join(tmpRoot, `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('hydrate + persist round-trips calendar store and connected OAuth token blobs', async () => {
    const blobStore = makeMockBlobStore();
    const connectorId = 'conn_test12345678';
    const secret = 'a'.repeat(32);

    saveCalendarStore(dataDir, {
      vaults: {
        default: {
          connectors: [{
            connector_id: connectorId,
            provider: 'google',
            display_name: 'Google Calendar',
            status: 'connected',
            oauth_ref: connectorId,
            account_sub: 'sub-1',
            sync_cursors: {},
            last_sync_at: null,
            last_sync_error: 'none',
            revoked_at: null,
          }],
          source_calendars: [],
          events: [],
        },
      },
    });
    writeOAuthTokenVault(dataDir, connectorId, secret, {
      refresh_token: 'refresh-token',
      scope: 'calendar.readonly',
      token_type: 'Bearer',
      obtained_at: '2026-07-07T12:00:00.000Z',
      account_sub: 'sub-1',
    });

    await persistCalendarStoresToBlob(blobStore, dataDir);
    assert.ok(blobStore.map.has(CALENDAR_STORE_BLOB_KEY));
    assert.ok(blobStore.map.has(calendarOAuthBlobKey(connectorId)));

    fs.rmSync(getCalendarStorePath(dataDir));
    fs.rmSync(path.join(dataDir, 'calendar_oauth'), { recursive: true, force: true });

    await hydrateCalendarStoresFromBlob(blobStore, dataDir);
    assert.ok(fs.existsSync(getCalendarStorePath(dataDir)));
    assert.ok(fs.existsSync(path.join(dataDir, 'calendar_oauth', `${connectorId}.enc`)));
  });

  it('withCalendarBlobSync survives simulated cold start between write and read', async () => {
    const blobStore = makeMockBlobStore();
    const connectorId = 'conn_coldstart12';

    await withCalendarBlobSync({
      blobStore,
      dataDir,
      run: () => {
        saveCalendarStore(dataDir, {
          vaults: {
            default: {
              connectors: [{
                connector_id: connectorId,
                provider: 'google',
                display_name: 'Work',
                status: 'connected',
                oauth_ref: connectorId,
                account_sub: 'sub-2',
                sync_cursors: {},
                last_sync_at: '2026-07-07T12:00:00.000Z',
                last_sync_error: 'none',
                revoked_at: null,
              }],
              source_calendars: [{
                source_calendar_id: 'cal_g_primary',
                connector_id: connectorId,
                display_name: 'Primary',
                color: null,
                user_group: null,
                provider: 'google',
                enabled_for_sync: true,
                enabled_for_display: true,
                enabled_for_agents: false,
                agent_context_tier_max: 0,
              }],
              events: [],
            },
          },
        });
        return { ok: true };
      },
    });

    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const listed = await withCalendarBlobSync({
      blobStore,
      dataDir,
      persist: false,
      run: () => {
        const raw = fs.readFileSync(getCalendarStorePath(dataDir), 'utf8');
        return JSON.parse(raw);
      },
    });

    assert.equal(listed.vaults.default.source_calendars[0].display_name, 'Primary');
  });

  it('does not hydrate OAuth blobs for revoked connectors', async () => {
    const blobStore = makeMockBlobStore();
    const connectorId = 'conn_revoked1234';
    blobStore.map.set(
      calendarOAuthBlobKey(connectorId),
      'stale-blob-should-not-load',
    );
    saveCalendarStore(dataDir, {
      vaults: {
        default: {
          connectors: [{
            connector_id: connectorId,
            provider: 'google',
            display_name: 'Google Calendar',
            status: 'revoked',
            oauth_ref: null,
            account_sub: 'sub-3',
            sync_cursors: {},
            last_sync_at: null,
            last_sync_error: 'none',
            revoked_at: '2026-07-07T12:00:00.000Z',
          }],
          source_calendars: [],
          events: [],
        },
      },
    });
    await persistCalendarStoresToBlob(blobStore, dataDir);

    fs.rmSync(path.join(dataDir, 'calendar_oauth'), { recursive: true, force: true });
    await hydrateCalendarStoresFromBlob(blobStore, dataDir);

    assert.equal(
      fs.existsSync(path.join(dataDir, 'calendar_oauth', `${connectorId}.enc`)),
      false,
    );
  });

  it('hydrateCalendarStoresFromBlob requests strong consistency for calendar store', async () => {
    const blobStore = makeMockBlobStore();
    blobStore.map.set(
      CALENDAR_STORE_BLOB_KEY,
      JSON.stringify({
        vaults: {
          default: {
            connectors: [{
              connector_id: 'conn_pending_oauth',
              provider: 'google',
              display_name: 'Google Calendar',
              status: 'pending',
              oauth_ref: null,
              account_sub: null,
              sync_cursors: {},
              last_sync_at: null,
              last_sync_error: null,
              revoked_at: null,
              oauth_pending: {
                state: 'oauth-state-xyz',
                code_verifier: 'verifier',
                return_url: 'https://scooling.netlify.app/settings/calendar/connect/callback',
                expires_at: '2099-01-01T00:00:00.000Z',
              },
            }],
            source_calendars: [],
            events: [],
          },
        },
      }),
    );

    await hydrateCalendarStoresFromBlob(blobStore, dataDir);

    const storeCall = blobStore.getCalls.find((c) => c.key === CALENDAR_STORE_BLOB_KEY);
    assert.ok(storeCall);
    assert.equal(storeCall.consistency, 'strong');

    const onDisk = JSON.parse(fs.readFileSync(getCalendarStorePath(dataDir), 'utf8'));
    assert.equal(onDisk.vaults.default.connectors[0].oauth_pending.state, 'oauth-state-xyz');
  });

  it('hydrate merges warm-lambda local pending with strong blob so state survives', async () => {
    const blobStore = makeMockBlobStore();
    // Stale eventual edge view (no pending).
    blobStore.map.set(
      CALENDAR_STORE_BLOB_KEY,
      JSON.stringify({
        vaults: {
          default: {
            connectors: [],
            source_calendars: [],
            events: [],
          },
        },
      }),
    );
    // Warm local disk still has the pending written before cold start completes.
    saveCalendarStore(dataDir, {
      vaults: {
        default: {
          connectors: [{
            connector_id: 'conn_warm_pending',
            provider: 'google',
            display_name: 'Google Calendar',
            status: 'pending',
            oauth_ref: null,
            account_sub: null,
            sync_cursors: {},
            last_sync_at: null,
            last_sync_error: null,
            revoked_at: null,
            oauth_pending: {
              state: 'warm-state-123',
              code_verifier: 'cv',
              return_url: 'https://scooling.netlify.app/settings/calendar/connect/callback',
              expires_at: '2099-07-08T00:00:00.000Z',
            },
          }],
          source_calendars: [],
          events: [],
        },
      },
    });

    await hydrateCalendarStoresFromBlob(blobStore, dataDir);
    const onDisk = JSON.parse(fs.readFileSync(getCalendarStorePath(dataDir), 'utf8'));
    assert.equal(onDisk.vaults.default.connectors.length, 1);
    assert.equal(onDisk.vaults.default.connectors[0].oauth_pending.state, 'warm-state-123');
  });
});

describe('INF-KN-3b calendar blob store — security', () => {
  it('calendar store blob key is separate from encrypted OAuth token blob keys', () => {
    assert.equal(CALENDAR_STORE_BLOB_KEY, 'calendar/hub_calendar_store.json');
    assert.ok(!CALENDAR_STORE_BLOB_KEY.includes('.enc'));
    assert.equal(calendarOAuthBlobKey('conn_x'), 'calendar/oauth/conn_x.enc');
    assert.notEqual(CALENDAR_STORE_BLOB_KEY, calendarOAuthBlobKey('conn_x'));
  });
});

describe('INF-KN-3b calendar blob store — data-integrity', () => {
  it('mergeCalendarStoreJson round-trips vault ids without dropping either side', () => {
    const local = JSON.stringify({
      vaults: {
        vault_a: {
          connectors: [{
            connector_id: 'conn_a',
            provider: 'google',
            display_name: 'A',
            status: 'pending',
            oauth_ref: null,
            account_sub: null,
            sync_cursors: {},
            last_sync_at: null,
            last_sync_error: null,
            revoked_at: null,
            oauth_pending: {
              state: 'state-a',
              code_verifier: 'v',
              return_url: 'https://scooling.netlify.app/settings/calendar/connect/callback',
              expires_at: '2099-01-01T00:00:00.000Z',
            },
          }],
          source_calendars: [],
          events: [],
        },
      },
    });
    const blob = JSON.stringify({
      vaults: {
        vault_b: {
          connectors: [{
            connector_id: 'conn_b',
            provider: 'google',
            display_name: 'B',
            status: 'connected',
            oauth_ref: 'conn_b',
            account_sub: 'sub-b',
            sync_cursors: {},
            last_sync_at: '2026-07-08T00:00:00.000Z',
            last_sync_error: 'none',
            revoked_at: null,
          }],
          source_calendars: [],
          events: [],
        },
      },
    });
    const merged = JSON.parse(mergeCalendarStoreJson(local, blob));
    assert.ok(merged.vaults.vault_a);
    assert.ok(merged.vaults.vault_b);
    assert.equal(merged.vaults.vault_a.connectors[0].oauth_pending.state, 'state-a');
    assert.equal(merged.vaults.vault_b.connectors[0].status, 'connected');
  });
});

describe('INF-KN-3b calendar blob store — performance', () => {
  it('mergeCalendarStoreJson stays under 50ms for 200 connectors', () => {
    const connectors = Array.from({ length: 200 }, (_, i) => ({
      connector_id: `conn_${i}`,
      provider: 'google',
      display_name: `C${i}`,
      status: i % 2 === 0 ? 'pending' : 'connected',
      oauth_ref: i % 2 === 0 ? null : `conn_${i}`,
      account_sub: null,
      sync_cursors: {},
      last_sync_at: null,
      last_sync_error: null,
      revoked_at: null,
      oauth_pending: i % 2 === 0
        ? {
            state: `state-${i}`,
            code_verifier: 'v',
            return_url: 'https://scooling.netlify.app/settings/calendar/connect/callback',
            expires_at: '2099-01-01T00:00:00.000Z',
          }
        : null,
    }));
    const payload = JSON.stringify({
      vaults: { default: { connectors, source_calendars: [], events: [] } },
    });
    const started = performance.now();
    const merged = mergeCalendarStoreJson(payload, payload);
    const elapsed = performance.now() - started;
    assert.ok(JSON.parse(merged).vaults.default.connectors.length === 200);
    assert.ok(elapsed < 50, `merge took ${elapsed}ms`);
  });
});

describe('INF-KN-3b calendar blob store — stress', () => {
  it('repeated hydrate+persist does not drop pending oauth state', async () => {
    const dataDir = path.join(tmpRoot, `stress-${Date.now()}`);
    fs.mkdirSync(dataDir, { recursive: true });
    try {
      const blobStore = makeMockBlobStore();
      for (let i = 0; i < 25; i += 1) {
        await withCalendarBlobSync({
          blobStore,
          dataDir,
          run: () => {
            saveCalendarStore(dataDir, {
              vaults: {
                default: {
                  connectors: [{
                    connector_id: 'conn_stress',
                    provider: 'google',
                    display_name: 'G',
                    status: 'pending',
                    oauth_ref: null,
                    account_sub: null,
                    sync_cursors: {},
                    last_sync_at: null,
                    last_sync_error: null,
                    revoked_at: null,
                    oauth_pending: {
                      state: `state-round-${i}`,
                      code_verifier: 'v',
                      return_url: 'https://scooling.netlify.app/settings/calendar/connect/callback',
                      expires_at: '2099-01-01T00:00:00.000Z',
                    },
                  }],
                  source_calendars: [],
                  events: [],
                },
              },
            });
            return { ok: true };
          },
        });
        fs.rmSync(getCalendarStorePath(dataDir), { force: true });
        await hydrateCalendarStoresFromBlob(blobStore, dataDir);
        const onDisk = JSON.parse(fs.readFileSync(getCalendarStorePath(dataDir), 'utf8'));
        assert.equal(onDisk.vaults.default.connectors[0].oauth_pending.state, `state-round-${i}`);
      }
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
