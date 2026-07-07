/**
 * Local file-backed calendar event store (Calendar Events v0 — Phase 1B).
 *
 * Persists source calendars and normalized events per vault under data_dir.
 * Self-hosted Hub only in v0; hosted canister parity follows later.
 *
 * @see docs/CALENDAR-EVENTS-V0-SPEC.md
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { randomUUID } from 'crypto';
import { parseIcsToEvents } from './ics-normalizer.mjs';
import { buildSourceCalendarDefaults } from './source-calendar-defaults.mjs';

const STORE_FILENAME = 'hub_calendar_store.json';
export const CALENDAR_STORE_FILENAME = STORE_FILENAME;
export const CALENDAR_OAUTH_DIR = 'calendar_oauth';
const MAX_ICS_IMPORT_BYTES = 5 * 1024 * 1024;

/** @typedef {import('./source-calendar-defaults.mjs').AgentContextTier} AgentContextTier */

/**
 * @typedef {Object} StoredSourceCalendar
 * @property {string} source_calendar_id
 * @property {string} connector_id
 * @property {string} display_name
 * @property {string|null} [color]
 * @property {'personal'|'work'|'school'|'other'|null} [user_group]
 * @property {boolean} enabled_for_sync
 * @property {boolean} enabled_for_display
 * @property {boolean} enabled_for_agents
 * @property {AgentContextTier} agent_context_tier_max
 * @property {string} [provider]
 */

/**
 * @typedef {Object} StoredCalendarEvent
 * @property {string} event_id
 * @property {string} source_calendar_id
 * @property {string} external_uid
 * @property {string} start
 * @property {string} end
 * @property {string} timezone
 * @property {string|null} summary
 * @property {boolean} busy
 * @property {'confirmed'|'cancelled'|'tentative'} status
 * @property {string|null} recurrence_rule
 * @property {string[]|null} linked_note_paths
 * @property {string|null} deleted_at
 */

/**
 * @typedef {'pending'|'connected'|'needs_reauth'|'revoked'} ConnectorStatus
 */

/**
 * @typedef {'auth_expired'|'rate_limited'|'provider_error'|'network_error'|'none'} ConnectorSyncError
 */

/**
 * @typedef {Object} StoredCalendarConnector
 * @property {string} connector_id
 * @property {string} provider
 * @property {string} display_name
 * @property {ConnectorStatus} status
 * @property {string|null} [oauth_ref]
 * @property {string|null} [account_sub]
 * @property {Record<string, string>} [sync_cursors]
 * @property {string|null} [last_sync_at]
 * @property {ConnectorSyncError|null} [last_sync_error]
 * @property {string|null} [revoked_at]
 * @property {Object|null} [oauth_pending]
 */

/**
 * @typedef {Object} VaultCalendarStore
 * @property {StoredCalendarConnector[]} [connectors]
 * @property {StoredSourceCalendar[]} source_calendars
 * @property {StoredCalendarEvent[]} events
 */

/**
 * @typedef {Object} CalendarStoreFile
 * @property {Record<string, VaultCalendarStore>} vaults
 */

/**
 * @param {string} dataDir
 * @returns {string}
 */
export function getCalendarStorePath(dataDir) {
  return path.join(dataDir, STORE_FILENAME);
}

/**
 * @param {string} dataDir
 * @returns {CalendarStoreFile}
 */
export function loadCalendarStore(dataDir) {
  const filePath = getCalendarStorePath(dataDir);
  if (!fs.existsSync(filePath)) {
    return { vaults: {} };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.vaults || typeof parsed.vaults !== 'object') {
      return { vaults: {} };
    }
    return /** @type {CalendarStoreFile} */ (parsed);
  } catch {
    return { vaults: {} };
  }
}

/**
 * @param {string} dataDir
 * @param {CalendarStoreFile} store
 */
export function saveCalendarStore(dataDir, store) {
  const filePath = getCalendarStorePath(dataDir);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @returns {VaultCalendarStore}
 */
export function getVaultCalendarStore(dataDir, vaultId, store = loadCalendarStore(dataDir)) {
  if (!store.vaults[vaultId]) {
    store.vaults[vaultId] = { connectors: [], source_calendars: [], events: [] };
  }
  const vault = store.vaults[vaultId];
  if (!Array.isArray(vault.connectors)) {
    vault.connectors = [];
  }
  return vault;
}

/**
 * @param {string} sourceCalendarId
 * @param {string} externalUid
 * @returns {string}
 */
export function buildEventId(sourceCalendarId, externalUid) {
  const digest = crypto.createHash('sha256')
    .update(`${sourceCalendarId}:${externalUid}`, 'utf8')
    .digest('hex')
    .slice(0, 24);
  return `evt_${digest}`;
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @returns {StoredSourceCalendar[]}
 */
export function listSourceCalendars(dataDir, vaultId) {
  return getVaultCalendarStore(dataDir, vaultId).source_calendars.slice();
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} sourceCalendarId
 * @returns {StoredSourceCalendar|undefined}
 */
export function getSourceCalendar(dataDir, vaultId, sourceCalendarId) {
  return getVaultCalendarStore(dataDir, vaultId)
    .source_calendars
    .find((c) => c.source_calendar_id === sourceCalendarId);
}

/**
 * @param {StoredSourceCalendar} calendar
 * @returns {object}
 */
export function sourceCalendarForClient(calendar) {
  return {
    source_calendar_id: calendar.source_calendar_id,
    connector_id: calendar.connector_id,
    display_name: calendar.display_name,
    color: calendar.color ?? null,
    user_group: calendar.user_group ?? null,
    enabled_for_sync: calendar.enabled_for_sync,
    enabled_for_display: calendar.enabled_for_display,
    enabled_for_agents: calendar.enabled_for_agents,
    agent_context_tier_max: calendar.agent_context_tier_max,
    provider: calendar.provider ?? 'ics_file',
  };
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{
 *   icsText: string,
 *   displayName?: string,
 *   sourceCalendarId?: string,
 *   connectorId?: string,
 *   defaultTimezone?: string,
 * }} input
 * @returns {{ source_calendar_id: string, connector_id: string, imported: number, updated: number }}
 */
export function importIcsIntoVault(dataDir, vaultId, input) {
  const icsText = input.icsText;
  if (typeof icsText !== 'string' || !icsText.trim()) {
    throw new TypeError('icsText is required');
  }
  if (icsText.length > MAX_ICS_IMPORT_BYTES) {
    throw new RangeError(`ICS import exceeds ${MAX_ICS_IMPORT_BYTES} bytes`);
  }

  const store = loadCalendarStore(dataDir);
  if (!store.vaults[vaultId]) {
    store.vaults[vaultId] = { source_calendars: [], events: [] };
  }
  const vaultStore = store.vaults[vaultId];

  let sourceCalendarId = typeof input.sourceCalendarId === 'string' ? input.sourceCalendarId.trim() : '';
  let connectorId = typeof input.connectorId === 'string' ? input.connectorId.trim() : '';
  let sourceCalendar = sourceCalendarId
    ? vaultStore.source_calendars.find((c) => c.source_calendar_id === sourceCalendarId)
    : undefined;

  if (sourceCalendarId && !sourceCalendar) {
    throw new Error(`Source calendar not found: ${sourceCalendarId}`);
  }

  if (!sourceCalendar) {
    sourceCalendarId = `cal_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    connectorId = connectorId || `conn_ics_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    sourceCalendar = {
      source_calendar_id: sourceCalendarId,
      connector_id: connectorId,
      display_name: (input.displayName ?? 'Imported calendar').trim().slice(0, 120) || 'Imported calendar',
      color: null,
      user_group: null,
      provider: 'ics_file',
      ...buildSourceCalendarDefaults(),
    };
    vaultStore.source_calendars.push(sourceCalendar);
  } else {
    connectorId = sourceCalendar.connector_id;
  }

  const normalized = parseIcsToEvents(icsText, {
    defaultTimezone: input.defaultTimezone ?? 'UTC',
  });

  let imported = 0;
  let updated = 0;
  const byId = new Map(vaultStore.events.map((e) => [e.event_id, e]));

  for (const row of normalized) {
    const eventId = buildEventId(sourceCalendarId, row.external_uid);
    const existing = byId.get(eventId);
    const stored = {
      event_id: eventId,
      source_calendar_id: sourceCalendarId,
      external_uid: row.external_uid,
      start: row.start,
      end: row.end,
      timezone: row.timezone,
      summary: row.summary,
      busy: row.busy,
      status: row.status,
      recurrence_rule: row.recurrence_rule,
      linked_note_paths: existing?.linked_note_paths ?? null,
      deleted_at: existing?.deleted_at ?? null,
    };

    if (existing) {
      Object.assign(existing, stored);
      updated += 1;
    } else {
      vaultStore.events.push(stored);
      byId.set(eventId, stored);
      imported += 1;
    }
  }

  saveCalendarStore(dataDir, store);
  return {
    source_calendar_id: sourceCalendarId,
    connector_id: connectorId,
    imported,
    updated,
  };
}

/**
 * Query stored events overlapping a UTC range.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {{
 *   fromIso: string,
 *   toIso: string,
 *   sourceCalendarIds?: string[],
 *   displayOnly?: boolean,
 * }} query
 * @returns {StoredCalendarEvent[]}
 */
export function queryStoredEvents(dataDir, vaultId, query) {
  const vaultStore = getVaultCalendarStore(dataDir, vaultId);
  const fromMs = Date.parse(query.fromIso);
  const toMs = Date.parse(query.toIso);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) {
    throw new RangeError('Invalid timeline range');
  }

  const allowedCalendars = new Set(
    vaultStore.source_calendars
      .filter((c) => {
        if (query.displayOnly && !c.enabled_for_display) return false;
        return true;
      })
      .map((c) => c.source_calendar_id),
  );

  const filterIds = query.sourceCalendarIds?.length
    ? new Set(query.sourceCalendarIds.filter((id) => allowedCalendars.has(id)))
    : allowedCalendars;

  return vaultStore.events.filter((event) => {
    if (!filterIds.has(event.source_calendar_id)) return false;
    if (event.deleted_at) return false;
    const startMs = Date.parse(event.start);
    const endMs = Date.parse(event.end);
    return startMs < toMs && endMs > fromMs;
  });
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @returns {StoredCalendarConnector[]}
 */
export function listConnectors(dataDir, vaultId) {
  return getVaultCalendarStore(dataDir, vaultId).connectors.slice();
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} connectorId
 * @returns {StoredCalendarConnector|undefined}
 */
export function getConnector(dataDir, vaultId, connectorId) {
  return getVaultCalendarStore(dataDir, vaultId)
    .connectors
    .find((c) => c.connector_id === connectorId);
}

/**
 * @param {StoredCalendarConnector} connector
 * @returns {object}
 */
export function connectorForClient(connector, sourceCalendarCount) {
  return {
    connector_id: connector.connector_id,
    provider: connector.provider,
    display_name: connector.display_name,
    status: connector.status,
    last_sync_at: connector.last_sync_at ?? null,
    last_sync_error: connector.last_sync_error ?? null,
    source_calendar_count: sourceCalendarCount,
  };
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {StoredCalendarConnector} connector
 */
export function saveConnector(dataDir, vaultId, connector) {
  const store = loadCalendarStore(dataDir);
  const vault = getVaultCalendarStore(dataDir, vaultId, store);
  const idx = vault.connectors.findIndex((c) => c.connector_id === connector.connector_id);
  if (idx === -1) {
    vault.connectors.push(connector);
  } else {
    vault.connectors[idx] = connector;
  }
  saveCalendarStore(dataDir, store);
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} connectorId
 * @returns {number}
 */
export function countSourceCalendarsForConnector(dataDir, vaultId, connectorId) {
  return getVaultCalendarStore(dataDir, vaultId)
    .source_calendars
    .filter((c) => c.connector_id === connectorId)
    .length;
}

/**
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} connectorId
 * @param {string} externalGoogleId
 * @param {string} displayName
 * @returns {StoredSourceCalendar}
 */
export function upsertGoogleSourceCalendar(dataDir, vaultId, connectorId, externalGoogleId, displayName) {
  const store = loadCalendarStore(dataDir);
  const vault = getVaultCalendarStore(dataDir, vaultId, store);
  const sourceCalendarId = `cal_g_${externalGoogleId.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 96)}`;
  let existing = vault.source_calendars.find((c) => c.source_calendar_id === sourceCalendarId);
  if (!existing) {
    existing = {
      source_calendar_id: sourceCalendarId,
      connector_id: connectorId,
      display_name: displayName.slice(0, 120) || 'Google calendar',
      color: null,
      user_group: null,
      provider: 'google',
      ...buildSourceCalendarDefaults(),
    };
    vault.source_calendars.push(existing);
  } else {
    existing.display_name = displayName.slice(0, 120) || existing.display_name;
  }
  saveCalendarStore(dataDir, store);
  return existing;
}

/**
 * Upsert normalized Google events into the vault store.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} sourceCalendarId
 * @param {import('./google-event-normalizer.mjs').NormalizedCalendarEvent[]} normalized
 * @returns {{ imported: number, updated: number, tombstoned: number }}
 */
export function upsertNormalizedEvents(dataDir, vaultId, sourceCalendarId, normalized) {
  const store = loadCalendarStore(dataDir);
  const vault = getVaultCalendarStore(dataDir, vaultId, store);
  let imported = 0;
  let updated = 0;
  let tombstoned = 0;
  const byId = new Map(vault.events.map((e) => [e.event_id, e]));
  const now = new Date().toISOString();

  for (const row of normalized) {
    const eventId = buildEventId(sourceCalendarId, row.external_uid);
    const existing = byId.get(eventId);
    if (row.status === 'cancelled') {
      if (existing) {
        existing.deleted_at = now;
        existing.status = 'cancelled';
        tombstoned += 1;
      }
      continue;
    }
    const stored = {
      event_id: eventId,
      source_calendar_id: sourceCalendarId,
      external_uid: row.external_uid,
      start: row.start,
      end: row.end,
      timezone: row.timezone,
      summary: row.summary,
      busy: row.busy,
      status: row.status,
      recurrence_rule: row.recurrence_rule,
      linked_note_paths: existing?.linked_note_paths ?? null,
      deleted_at: null,
    };
    if (existing) {
      Object.assign(existing, stored);
      updated += 1;
    } else {
      vault.events.push(stored);
      byId.set(eventId, stored);
      imported += 1;
    }
  }

  saveCalendarStore(dataDir, store);
  return { imported, updated, tombstoned };
}

/**
 * Delete all events and source calendars belonging to one connector.
 *
 * @param {string} dataDir
 * @param {string} vaultId
 * @param {string} connectorId
 * @returns {number} events deleted
 */
export function purgeConnectorData(dataDir, vaultId, connectorId) {
  const store = loadCalendarStore(dataDir);
  const vault = getVaultCalendarStore(dataDir, vaultId, store);
  const calendarIds = new Set(
    vault.source_calendars
      .filter((c) => c.connector_id === connectorId)
      .map((c) => c.source_calendar_id),
  );
  const before = vault.events.length;
  vault.events = vault.events.filter((e) => !calendarIds.has(e.source_calendar_id));
  vault.source_calendars = vault.source_calendars.filter((c) => c.connector_id !== connectorId);
  saveCalendarStore(dataDir, store);
  return before - vault.events.length;
}
