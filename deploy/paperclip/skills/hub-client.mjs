/**
 * Knowtation hosted Hub HTTP client used by Paperclip skills.
 *
 * This is a thin, dependency-free wrapper around globalThis.fetch that:
 *   - injects Authorization, X-Vault-Id, and X-User-Id headers on every call
 *   - normalizes error responses (always throws { code, status, message, body })
 *   - applies an exponential backoff (3 attempts) on 5xx and ECONN errors
 *   - never logs tokens; tokens come from process.env at call time
 *
 * Why not the MCP SDK directly?
 *   Paperclip already speaks MCP at the agent layer. These skills are the
 *   *implementation* layer one level below — they call the Hub's REST API
 *   directly so unit tests can assert exact request shape without spinning
 *   up an MCP transport.
 *
 * @typedef {object} HubClientOptions
 * @property {string} baseUrl       Knowtation Hub base URL (no trailing slash).
 * @property {string} jwt           Hub JWT (Authorization: Bearer <jwt>).
 * @property {string} vaultId       X-Vault-Id header value.
 * @property {string} [userId]      Optional X-User-Id (defaults to 'paperclip').
 * @property {number} [maxAttempts] Retry cap. Default 3. Set to 1 to disable retry.
 * @property {number} [retryBaseMs] Base backoff. Default 250.
 * @property {typeof fetch} [fetch] Inject for testing. Defaults to globalThis.fetch.
 */

/**
 * @param {HubClientOptions} opts
 * @returns {{
 *   search: (body: object) => Promise<any>,
 *   getNote: (path: string) => Promise<any>,
 *   putNote: (path: string, body: object) => Promise<any>,
 *   listNotes: (query: object) => Promise<any>,
 * }}
 */
export function createHubClient(opts) {
  const {
    baseUrl,
    jwt,
    vaultId,
    userId = 'paperclip',
    maxAttempts = 3,
    retryBaseMs = 250,
    fetch: fetchImpl = globalThis.fetch,
  } = opts;

  if (!baseUrl || typeof baseUrl !== 'string') {
    throw new Error('createHubClient: baseUrl is required (string)');
  }
  if (!jwt || typeof jwt !== 'string') {
    throw new Error('createHubClient: jwt is required (string)');
  }
  if (!vaultId || typeof vaultId !== 'string') {
    throw new Error('createHubClient: vaultId is required (string)');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('createHubClient: fetch implementation missing');
  }

  const trimmedBase = baseUrl.replace(/\/+$/, '');

  function headers() {
    return {
      Authorization: `Bearer ${jwt}`,
      'X-Vault-Id': vaultId,
      'X-User-Id': userId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /**
   * Call the Hub with retries. Throws a structured error on non-2xx.
   * @param {string} path absolute path (e.g. '/api/v1/search')
   * @param {object} init { method, body? }
   * @returns {Promise<any>}
   */
  async function request(path, init) {
    const url = `${trimmedBase}${path}`;
    const body = init.body != null ? JSON.stringify(init.body) : undefined;
    let lastErr;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let res;
      try {
        res = await fetchImpl(url, {
          method: init.method,
          headers: headers(),
          body,
        });
      } catch (e) {
        lastErr = Object.assign(new Error(`hub_fetch_failed: ${e.message ?? e}`), {
          code: 'HUB_FETCH_FAILED',
          cause: e,
        });
        if (attempt < maxAttempts) {
          await sleep(retryBaseMs * 2 ** (attempt - 1));
          continue;
        }
        throw lastErr;
      }

      if (res.status >= 500 && attempt < maxAttempts) {
        await sleep(retryBaseMs * 2 ** (attempt - 1));
        continue;
      }

      let parsed;
      try {
        parsed = await res.json();
      } catch (_e) {
        parsed = null;
      }

      if (!res.ok) {
        const err = new Error(
          `hub_${res.status}: ${parsed?.error || parsed?.message || res.statusText || 'request failed'}`
        );
        Object.assign(err, {
          code: parsed?.code || `HUB_${res.status}`,
          status: res.status,
          body: parsed,
        });
        throw err;
      }

      return parsed;
    }

    throw lastErr;
  }

  return {
    search(body) {
      return request('/api/v1/search', { method: 'POST', body });
    },
    getNote(path) {
      const safe = encodeURIComponent(path);
      return request(`/api/v1/notes/${safe}`, { method: 'GET' });
    },
    putNote(path, body) {
      const safe = encodeURIComponent(path);
      return request(`/api/v1/notes/${safe}`, { method: 'PUT', body });
    },
    listNotes(query) {
      const qs = new URLSearchParams(
        Object.fromEntries(
          Object.entries(query ?? {}).filter(([_k, v]) => v != null && v !== '')
        )
      ).toString();
      return request(`/api/v1/notes${qs ? `?${qs}` : ''}`, { method: 'GET' });
    },
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Validate that a project slug is one of the three Knowtation projects.
 * Paperclip has a company-per-project model; skills validate the project at the boundary
 * so a misconfigured agent can't write Born Free content into the Knowtation vault.
 * @param {string} project
 * @returns {'born-free' | 'store-free' | 'knowtation'}
 */
export function assertProject(project) {
  const allowed = ['born-free', 'store-free', 'knowtation'];
  if (!allowed.includes(project)) {
    throw Object.assign(
      new Error(`unknown_project: '${project}' is not in [${allowed.join(', ')}]`),
      { code: 'UNKNOWN_PROJECT' }
    );
  }
  return /** @type {'born-free' | 'store-free' | 'knowtation'} */ (project);
}
