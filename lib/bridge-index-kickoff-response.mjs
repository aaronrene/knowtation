/**
 * Validate that an HTTP response from the `bridge-index-background` Netlify
 * Function actually came back with the only status it can legitimately produce
 * on a successful kickoff: 202.
 *
 * Why this exists (May 2026 hotfix): the catch-all redirect in
 * `deploy/bridge/netlify.toml` (`from = "/*" force = true`) was intercepting
 * `/.netlify/functions/bridge-index-background` requests because Netlify's
 * normal exemption for `/.netlify/...` paths is BYPASSED when `force = true`.
 * The redirect rewrote the URL to the regular `bridge` function, which had no
 * matching Express route and returned 404. `await fetch(url)` resolves
 * successfully on a 404 (since 404 is a valid HTTP response, not a network
 * error), so the kickoff caller silently believed the background job started
 * and returned `202 status:"background"` to the browser. The actual indexing
 * never ran. The job lock then sat for its full 16-min TTL blocking any retry.
 *
 * This helper is deliberately a tiny pure function so it stays trivially
 * unit-testable without spinning up Express, Netlify, or fetch mocks.
 *
 * @param {{ status?: number } | null | undefined} response - The fetch Response
 *   (or compatible shape with a numeric `status`).
 * @param {string | null | undefined} body - The response body text (already
 *   read by the caller via `response.text()`). Used only for diagnostic logs.
 * @throws {Error} when `response` is missing/malformed or `response.status !== 202`.
 */
export function assertBackgroundKickoffOk(response, body) {
  if (!response || typeof response.status !== 'number') {
    throw new Error(
      'background kickoff: invalid response from /.netlify/functions/bridge-index-background',
    );
  }
  if (response.status !== 202) {
    const snippet = typeof body === 'string' ? body.slice(0, KICKOFF_BODY_SNIPPET_MAX) : '';
    const tail = snippet ? ` — body: ${snippet}` : '';
    throw new Error(
      `background kickoff: expected HTTP 202 from /.netlify/functions/bridge-index-background, got HTTP ${response.status}${tail}`,
    );
  }
}

/**
 * Cap the diagnostic body snippet length to keep Lambda log lines bounded
 * (Netlify charges by GB-seconds and CloudWatch enforces a 256 KB/event cap).
 * 500 chars is enough to identify any reasonable error response without
 * dumping multi-KB HTML error pages.
 */
export const KICKOFF_BODY_SNIPPET_MAX = 500;
