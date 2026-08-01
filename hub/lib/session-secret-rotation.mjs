/**
 * SEC-KN-P6-ROTATE — dual-secret JWT verify helper for zero-downtime
 * SESSION_SECRET rotation (docs/SEC-KN-P6-ROTATE-FREEZE.md §6.2, P6-C1).
 *
 * During a rotation window the gateway, bridge, and EC2 MCP host each carry:
 *   - SESSION_SECRET            (primary — signs new JWTs, tried first on verify)
 *   - SESSION_SECRET_PREVIOUS   (verify-only — accepted if primary verify fails)
 *
 * Fail-closed rules (frozen):
 *   - No/empty primary → refuse verify (never a silent "previous-only" sign-in).
 *   - previous === primary → previous is ignored (no second verify).
 *   - Signing always uses the primary secret only; this module never signs.
 *   - Errors are swallowed to null; secret material never appears in messages.
 *
 * Non-JWT HMAC/encrypt paths (bridge GitHub-token encrypt, image-proxy HMAC,
 * internal request HMAC) are intentionally OUT of this helper — they stay
 * primary-only (freeze §6.2 / §6.4).
 */

import jwt from 'jsonwebtoken';

/**
 * Verify an HS256 access JWT against the primary secret, falling back to the
 * previous secret during a rotation window.
 *
 * @param {unknown} token - Bearer token string.
 * @param {unknown} primary - Current SESSION_SECRET (signing + first verify).
 * @param {unknown} previous - SESSION_SECRET_PREVIOUS (verify-only), or null/undefined.
 * @returns {object|null} Verified payload, or null when verification fails or
 *   the primary secret is missing (fail closed).
 */
export function verifyJwtWithSecretRotation(token, primary, previous) {
  if (typeof token !== 'string' || token === '') return null;
  if (typeof primary !== 'string' || primary === '') return null;
  try {
    return jwt.verify(token, primary);
  } catch (_) {
    // fall through to the rotation window
  }
  if (typeof previous !== 'string' || previous === '' || previous === primary) return null;
  try {
    return jwt.verify(token, previous);
  } catch (_) {
    return null;
  }
}

/**
 * Resolve the verify-only previous secret from the environment.
 * Kept as a function so call sites share one resolution rule.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string|null}
 */
export function resolveSessionSecretPrevious(env = process.env) {
  const v = env.SESSION_SECRET_PREVIOUS;
  return typeof v === 'string' && v !== '' ? v : null;
}
