/**
 * Hub signed-in shell IA helpers (HUB-DASH-IA-b).
 * Pure functions for Review labels, History segments, Needs-you, and badge count.
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
