/**
 * SEC-SEAM-1 / S10 — operator-declared self-apply-ineligible subjects.
 *
 * Pure parser for `HUB_SELF_APPLY_INELIGIBLE_SUBS` (comma-separated exact `sub` values).
 * Production wires the env through this parser once at module load into
 * {@link SELF_APPLY_INELIGIBLE_SUBS}. Tier 7b exercises empty shapes via the pure
 * parser directly — never by mutating `process.env` and reloading the module.
 *
 * @see docs/SEC-SEAM-1-SESSION-BOUND-IDENTITY-FREEZE.md S10
 */

/**
 * Parse a raw env string into a Set of trimmed non-empty subject ids.
 * Absent / empty / whitespace-and-comma-only inputs yield an empty Set
 * (permissive — an unset variable must not disable the live notes tray).
 *
 * @param {string|undefined|null} raw
 * @returns {Set<string>}
 */
export function parseSelfApplyIneligibleSubs(raw) {
  if (raw == null) return new Set();
  const text = String(raw);
  if (!text.trim()) return new Set();
  return new Set(
    text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/** Module-load Set from `HUB_SELF_APPLY_INELIGIBLE_SUBS` (ships empty under ratified D3). */
export const SELF_APPLY_INELIGIBLE_SUBS = parseSelfApplyIneligibleSubs(
  process.env.HUB_SELF_APPLY_INELIGIBLE_SUBS
);

/**
 * Whether `sub` is on the operator-declared ineligible set (exact match after trim).
 * @param {string|null|undefined} sub
 * @returns {boolean}
 */
export function isSelfApplyIneligibleSub(sub) {
  const s = typeof sub === 'string' ? sub.trim() : '';
  return s !== '' && SELF_APPLY_INELIGIBLE_SUBS.has(s);
}
