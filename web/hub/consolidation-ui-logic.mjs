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
  if (form['consol-cost-cap']) form['consol-cost-cap'].value = d.max_cost_per_day_usd != null ? d.max_cost_per_day_usd : '';

  return mode;
}

/**
 * Build a consolidation settings payload from a form-field map.
 * @param {object} form - { field_id: { value?, checked? } }
 * @param {string} mode - 'daemon' | 'hosted' | 'off'
 * @returns {object} payload matching POST /api/v1/settings/consolidation schema
 */
export function buildConsolSettingsPayload(form, mode) {
  return {
    enabled: mode === 'daemon',
    interval_minutes: Math.max(1, Math.floor(Number(form['consol-interval']?.value) || 120)),
    idle_only: Boolean(form['consol-idle-only']?.checked),
    idle_threshold_minutes: Math.max(1, Math.floor(Number(form['consol-idle-threshold']?.value) || 15)),
    run_on_start: Boolean(form['consol-run-on-start']?.checked),
    passes: {
      consolidate: Boolean(form['pass-consolidate']?.checked),
      verify: Boolean(form['pass-verify']?.checked),
      discover: Boolean(form['pass-discover']?.checked),
    },
    llm: {
      provider: form['consol-llm-provider']?.value || '',
      model: form['consol-llm-model']?.value || '',
      base_url: form['consol-llm-base-url']?.value || '',
    },
    max_cost_per_day_usd: form['consol-cost-cap']?.value === '' ? null : Number(form['consol-cost-cap']?.value) || 0,
  };
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
    const date = ev.timestamp ? new Date(ev.timestamp).toLocaleString() : '—';
    const topics = ev.data?.topics_count ?? ev.data?.topics?.length ?? '—';
    const merged = ev.data?.total_events ?? '—';
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
