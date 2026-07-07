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
  persistCalendarStoresToBlob,
  withCalendarBlobSync,
} from '../hub/bridge/calendar-blob-store.mjs';
import { getCalendarStorePath, saveCalendarStore } from '../lib/calendar/event-store.mjs';
import { writeOAuthTokenVault } from '../lib/calendar/oauth-token-vault.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-calendar-blob-inf-kn-3b');

/** @returns {{ get: (k: string, o?: { type?: string }) => Promise<string|null>, set: (k: string, v: string) => Promise<void>, map: Map<string, string> }} */
function makeMockBlobStore() {
  const map = new Map();
  return {
    map,
    async get(key, opts) {
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
});
