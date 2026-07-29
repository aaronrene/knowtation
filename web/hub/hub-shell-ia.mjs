/**
 * Hub signed-in shell IA helpers (HUB-DASH-IA-b + HUB-DASH-IA-c).
 * Pure functions for Review labels, History segments, Needs-you, badge count,
 * Review inbox polish, Vault search disclosure, and Insights chrome.
 */

export const HUB_HISTORY_SEGMENT_KEY = 'hub_history_segment';
export const HUB_NEEDS_YOU_DISMISS_KEY = 'hub_needs_you_dismissed';

/** User-facing glossary for Hub chrome (internal data-tab values stay unchanged). */
export const HUB_SHELL_LABELS = Object.freeze({
  notes: 'Vault',
  suggested: 'Review',
  activity: 'Activity',
  problem: 'Discarded',
  history: 'History',
  insights: 'Insights',
});

/**
 * Map internal main-tab name to user-facing label.
 * @param {string} tabName
 * @returns {string}
 */
export function hubShellLabelForTab(tabName) {
  const key = String(tabName || '');
  if (Object.prototype.hasOwnProperty.call(HUB_SHELL_LABELS, key)) {
    return HUB_SHELL_LABELS[key];
  }
  return key;
}

/**
 * Normalize History segment to activity | problem (default Activity).
 * @param {unknown} raw
 * @returns {'activity'|'problem'}
 */
export function normalizeHistorySegment(raw) {
  return raw === 'problem' ? 'problem' : 'activity';
}

/**
 * Read last History segment from localStorage (default Activity).
 * @param {{ getItem?: (k: string) => string|null }} [store]
 * @returns {'activity'|'problem'}
 */
export function readHistorySegment(store) {
  const s = store && typeof store.getItem === 'function' ? store : null;
  try {
    return normalizeHistorySegment(s ? s.getItem(HUB_HISTORY_SEGMENT_KEY) : null);
  } catch (_) {
    return 'activity';
  }
}

/**
 * Persist History segment for next visit.
 * @param {'activity'|'problem'|string} segment
 * @param {{ setItem?: (k: string, v: string) => void }} [store]
 */
export function writeHistorySegment(segment, store) {
  const s = store && typeof store.setItem === 'function' ? store : null;
  if (!s) return;
  try {
    s.setItem(HUB_HISTORY_SEGMENT_KEY, normalizeHistorySegment(segment));
  } catch (_) {
    /* ignore quota / private mode */
  }
}

/**
 * Unfiltered proposed count for rail/header badges (not filtered list length).
 * @param {unknown} count
 * @returns {number} integer in 0..100 (API list limit for Hub badge)
 */
export function clampProposedBadgeCount(count) {
  const n = typeof count === 'number' ? count : Number(count);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, Math.floor(n));
}

/**
 * Display string for badge; empty when zero (caller hides element).
 * @param {unknown} count
 * @returns {string}
 */
export function formatProposedBadgeText(count) {
  const n = clampProposedBadgeCount(count);
  return n > 0 ? String(n) : '';
}

/**
 * Whether Needs-you banner should show on Vault home.
 * @param {number} proposedCount
 * @param {boolean} dismissedForSession
 * @returns {boolean}
 */
export function shouldShowNeedsYouBanner(proposedCount, dismissedForSession) {
  return clampProposedBadgeCount(proposedCount) > 0 && !dismissedForSession;
}

/**
 * Copy for Needs-you banner.
 * @param {number} proposedCount
 * @returns {string}
 */
export function needsYouBannerCopy(proposedCount) {
  const n = clampProposedBadgeCount(proposedCount);
  const noun = n === 1 ? 'proposal' : 'proposals';
  return n + ' ' + noun + ' waiting in Review';
}

/**
 * Whether badge should pulse once (count increased).
 * @param {number} prevCount
 * @param {number} nextCount
 * @returns {boolean}
 */
export function shouldPulseReviewBadge(prevCount, nextCount) {
  const prev = clampProposedBadgeCount(prevCount);
  const next = clampProposedBadgeCount(nextCount);
  return next > prev;
}

/**
 * Primary rail order for static contracts.
 * @returns {string[]}
 */
export function hubPrimaryRailOrder() {
  return ['Vault', 'Review', 'History'];
}

/**
 * Critical data-tab values that must remain stable.
 * @returns {string[]}
 */
export function hubCriticalDataTabs() {
  return ['notes', 'suggested', 'activity', 'problem'];
}

/**
 * Resolve notes browse sub-view (list | calendar | graph/Insights).
 * @param {unknown} view
 * @returns {'list'|'calendar'|'graph'}
 */
export function normalizeNotesView(view) {
  if (view === 'calendar' || view === 'graph') return view;
  return 'list';
}

/**
 * Chrome visibility for Vault search vs Review toolbar vs Insights.
 * Review mode hides note search; Vault list/calendar shows search + browse;
 * Insights (graph) shows neither note search nor proposal filters.
 * @param {string} activeTab notes|suggested|activity|problem
 * @param {string} [notesView] list|calendar|graph
 * @returns {{ noteSearch: boolean, browseToolbar: boolean, proposalFilters: boolean, insights: boolean }}
 */
export function hubChromeVisibility(activeTab, notesView) {
  const tab = String(activeTab || 'notes');
  const view = normalizeNotesView(notesView);
  const isReviewLike = tab === 'suggested' || tab === 'activity' || tab === 'problem';
  const isInsights = tab === 'notes' && view === 'graph';
  const isVaultBrowse = tab === 'notes' && !isInsights;
  return {
    noteSearch: isVaultBrowse,
    browseToolbar: isVaultBrowse,
    proposalFilters: isReviewLike,
    insights: isInsights,
  };
}

/**
 * Relative time for Review row density (compact, English).
 * @param {unknown} iso
 * @param {number} [nowMs]
 * @returns {string}
 */
export function formatRelativeTime(iso, nowMs) {
  const now = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  if (iso == null || iso === '') return '';
  const t = Date.parse(String(iso));
  if (!Number.isFinite(t)) return '';
  let sec = Math.round((now - t) / 1000);
  if (sec < 0) sec = 0;
  if (sec < 45) return 'just now';
  if (sec < 90) return '1m ago';
  const min = Math.round(sec / 60);
  if (min < 60) return min + 'm ago';
  const hr = Math.round(min / 60);
  if (hr < 24) return hr + 'h ago';
  const day = Math.round(hr / 24);
  if (day < 30) return day + 'd ago';
  const mo = Math.round(day / 30);
  if (mo < 12) return mo + 'mo ago';
  const yr = Math.round(day / 365);
  return yr + 'y ago';
}

/**
 * Whether a Review row should show the pending-eval chip.
 * @param {unknown} evaluationStatus
 * @returns {boolean}
 */
export function reviewRowNeedsPendingEvalChip(evaluationStatus) {
  return String(evaluationStatus || '').trim().toLowerCase() === 'pending';
}

/**
 * Split-view position label ("N of M").
 * @param {number} index1Based
 * @param {number} total
 * @returns {string}
 */
export function formatReviewSplitPosition(index1Based, total) {
  const i = Math.floor(Number(index1Based));
  const m = Math.floor(Number(total));
  if (!Number.isFinite(i) || !Number.isFinite(m) || i < 1 || m < 1) return '';
  const n = Math.min(i, m);
  return n + ' of ' + m;
}

/**
 * Advanced filters stay collapsed unless already open or filters are active.
 * @param {boolean} hasActiveFilters
 * @param {boolean} [userOpened]
 * @returns {boolean}
 */
export function shouldExpandVaultAdvancedFilters(hasActiveFilters, userOpened) {
  return Boolean(hasActiveFilters) || Boolean(userOpened);
}

/**
 * Empty Review primary CTA label (expert item 17).
 * @returns {string}
 */
export function emptyReviewPrimaryCtaLabel() {
  return 'New proposal';
}

/**
 * Empty Review secondary CTA label (expert item 17).
 * @returns {string}
 */
export function emptyReviewSecondaryCtaLabel() {
  return 'How Review works';
}

/**
 * Show pending-eval one-click chip when policy requires evaluation.
 * @param {unknown} evaluationRequired
 * @returns {boolean}
 */
export function shouldShowPendingEvalQuickChip(evaluationRequired) {
  return Boolean(evaluationRequired);
}

/**
 * Clamp list keyboard index into [0, length-1] (empty → 0).
 * @param {number} index
 * @param {number} length
 * @returns {number}
 */
export function clampListKeyboardIndex(index, length) {
  const len = Math.floor(Number(length));
  if (!Number.isFinite(len) || len <= 0) return 0;
  const i = Math.floor(Number(index));
  if (!Number.isFinite(i) || i < 0) return 0;
  return Math.min(i, len - 1);
}
