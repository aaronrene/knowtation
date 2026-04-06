/**
 * Pure functions for consolidation UI — shared between hub.js (browser) and test runner (Node).
 * These operate on plain data (no DOM dependency) for testability.
 */

/**
 * Given a settings response, populate a form-field map with daemon config values.
 * @param {object} settings - GET /api/v1/settings response
 * @param {object} form - { field_id: { value?, checked? } } map
 * @returns {string} mode - 'daemon' | 'hosted' | 'off'
 */
export function populateConsolSettingsForm(settings, form) {
  if (!settings || !settings.daemon) return 'off';
  const d = settings.daemon;
  let mode = 'off';
  if (d.enabled) mode = 'daemon';
  else if (settings.hosted_delegating || (settings.vault_path_display || '').toLowerCase() === 'canister') mode = 'hosted';

  if (form['consol-interval']) form['consol-interval'].value = d.interval_minutes ?? 120;
  if (form['consol-idle-only']) form['consol-idle-only'].checked = d.idle_only !== false;
  if (form['consol-idle-threshold']) form['consol-idle-threshold'].value = d.idle_threshold_minutes ?? 15;
  if (form['consol-run-on-start']) form['consol-run-on-start'].checked = Boolean(d.run_on_start);
  if (form['pass-consolidate']) form['pass-consolidate'].checked = d.passes?.consolidate !== false;
  if (form['pass-verify']) form['pass-verify'].checked = d.passes?.verify !== false;
  if (form['pass-discover']) form['pass-discover'].checked = Boolean(d.passes?.discover);
  if (form['consol-llm-provider']) form['consol-llm-provider'].value = d.llm?.provider || '';
  if (form['consol-llm-model']) form['consol-llm-model'].value = d.llm?.model || '';
  if (form['consol-llm-base-url']) form['consol-llm-base-url'].value = d.llm?.base_url || '';
  if (form['consol-lookback-hours']) form['consol-lookback-hours'].value = d.lookback_hours ?? 24;
  if (form['consol-max-events']) form['consol-max-events'].value = d.max_events_per_pass ?? 200;
  if (form['consol-max-topics']) form['consol-max-topics'].value = d.max_topics_per_pass ?? 10;
  if (form['consol-llm-max-tokens']) form['consol-llm-max-tokens'].value = d.llm?.max_tokens ?? 1024;
  if (form['consol-cost-cap']) form['consol-cost-cap'].value = d.max_cost_per_day_usd != null ? d.max_cost_per_day_usd : '';
  if (form['consol-hosted-interval'] != null && d.interval_minutes != null) {
    const v = String(d.interval_minutes);
    const allowed = ['30', '60', '120', '360', '720', '1440', '10080'];
    form['consol-hosted-interval'].value = allowed.includes(v) ? v : '120';
  }

  return mode;
}

/**
 * Build a consolidation settings payload from a form-field map.
 * @param {object} form - { field_id: { value?, checked? } }
 * @param {string} mode - 'daemon' | 'hosted' | 'off'
 * @returns {object} payload matching POST /api/v1/settings/consolidation schema
 */
export function buildConsolSettingsPayload(form, mode) {
  const intervalRaw =
    mode === 'hosted' && form['consol-hosted-interval'] != null
      ? form['consol-hosted-interval'].value
      : form['consol-interval']?.value;
  const llm = {
    provider: form['consol-llm-provider']?.value || '',
    model: form['consol-llm-model']?.value || '',
    base_url: form['consol-llm-base-url']?.value || '',
  };
  if (mode === 'daemon') {
    llm.max_tokens = Math.max(
      64,
      Math.min(8192, Math.floor(Number(form['consol-llm-max-tokens']?.value) || 1024)),
    );
  }
  const payload = {
    mode,
    enabled: mode === 'daemon',
    interval_minutes: Math.max(1, Math.floor(Number(intervalRaw) || 120)),
    idle_only: Boolean(form['consol-idle-only']?.checked),
    idle_threshold_minutes: Math.max(1, Math.floor(Number(form['consol-idle-threshold']?.value) || 15)),
    run_on_start: Boolean(form['consol-run-on-start']?.checked),
    passes: {
      consolidate: Boolean(form['pass-consolidate']?.checked),
      verify: Boolean(form['pass-verify']?.checked),
      discover: Boolean(form['pass-discover']?.checked),
    },
    llm,
    max_cost_per_day_usd: form['consol-cost-cap']?.value === '' ? null : Number(form['consol-cost-cap']?.value) || 0,
  };
  if (mode === 'daemon') {
    payload.lookback_hours = Math.max(
      1,
      Math.min(8760, Math.floor(Number(form['consol-lookback-hours']?.value) || 24)),
    );
    payload.max_events_per_pass = Math.max(
      1,
      Math.min(10000, Math.floor(Number(form['consol-max-events']?.value) || 200)),
    );
    payload.max_topics_per_pass = Math.max(
      1,
      Math.min(500, Math.floor(Number(form['consol-max-topics']?.value) || 10)),
    );
  }
  return payload;
}

/**
 * Render consolidation history events into a container.
 * @param {Array} events - consolidation-type memory events
 * @param {{ innerHTML: string }} container - DOM-like object with innerHTML
 * @returns {number} row count rendered
 */
export function renderConsolidationHistory(events, container) {
  if (!container) return 0;
  if (!events || events.length === 0) {
    container.innerHTML = '<p class="muted">No consolidation history found.</p>';
    return 0;
  }
  let html = '<table class="consol-history-table"><thead><tr><th>Date</th><th>Topics</th><th>Events Merged</th><th>Cost</th><th>Status</th></tr></thead><tbody>';
  events.forEach((ev) => {
    const ts = ev.ts || ev.timestamp || ev.created_at;
    const date = ts ? new Date(ts).toLocaleString() : '—';
    const rawTopics = ev.data?.topics_count;
    const topics = Array.isArray(rawTopics)
      ? rawTopics.length
      : (rawTopics ?? ev.data?.topics?.length ?? '—');
    const merged = ev.data?.total_events ?? ev.data?.event_count ?? '—';
    const cost = ev.data?.cost_usd != null ? '$' + Number(ev.data.cost_usd).toFixed(4) : '—';
    const status = ev.data?.dry_run ? 'dry-run' : (ev.data?.error ? 'error' : 'complete');
    html += `<tr><td>${esc(date)}</td><td>${esc(String(topics))}</td><td>${esc(String(merged))}</td><td>${esc(cost)}</td><td>${esc(status)}</td></tr>`;
  });
  html += '</tbody></table>';
  container.innerHTML = html;
  return events.length;
}

/**
 * Compute cost meter display values.
 * @param {number} costUsd - cost today in USD
 * @param {number|null} capUsd - daily cap in USD (null = no cap)
 * @returns {{ fillPercent: number, display: string, capLabel: string, showMeter: boolean }}
 */
export function formatCostMeter(costUsd, capUsd) {
  const cost = Math.max(0, Number(costUsd) || 0);
  const cap = capUsd != null ? Math.max(0, Number(capUsd) || 0) : null;
  const display = '$' + cost.toFixed(3) + ' today';
  if (cap == null || cap === 0) return { fillPercent: 0, display, capLabel: '', showMeter: false };
  const pct = Math.min(100, (cost / cap) * 100);
  return { fillPercent: pct, display, capLabel: 'cap: $' + cap.toFixed(2), showMeter: true };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
