/**
 * MCP Sampling helpers (Issue #1 Phase F).
 * Generic wrapper around Server#createMessage for all sampling use cases.
 * Falls back to null when the client does not advertise sampling capability.
 */

/** @param {unknown} result @returns {string} */
export function samplingResultToText(result) {
  const c = result?.content;
  if (!c) return '';
  if (typeof c === 'object' && !Array.isArray(c) && c.type === 'text' && typeof c.text === 'string') {
    return c.text;
  }
  if (Array.isArray(c)) {
    return c
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

/**
 * Check whether the connected MCP client supports sampling.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
 * @returns {boolean}
 */
export function clientSupportsSampling(mcpServer) {
  const caps = mcpServer.server.getClientCapabilities?.();
  return Boolean(caps?.sampling);
}

/**
 * Delegate an LLM completion to the MCP client via sampling.
 * Returns trimmed text on success, or null when sampling is unavailable / fails.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
 * @param {{ system: string, user: string, maxTokens?: number }} opts
 * @returns {Promise<string | null>}
 */
export async function trySampling(mcpServer, opts) {
  if (!clientSupportsSampling(mcpServer)) return null;
  const maxTokens = Math.max(1, Math.min(8192, Math.floor(opts.maxTokens ?? 512)));
  try {
    const result = await mcpServer.server.createMessage({
      systemPrompt: opts.system,
      messages: [{ role: 'user', content: { type: 'text', text: opts.user } }],
      maxTokens,
      includeContext: 'none',
    });
    const text = samplingResultToText(result).trim();
    return text.length > 0 ? text : null;
  } catch (_) {
    return null;
  }
}

/**
 * Like trySampling but expects a JSON response. Parses and returns the object,
 * or null when sampling is unavailable, fails, or produces invalid JSON.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
 * @param {{ system: string, user: string, maxTokens?: number }} opts
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function trySamplingJson(mcpServer, opts) {
  const raw = await trySampling(mcpServer, {
    ...opts,
    system: opts.system + '\n\nRespond ONLY with valid JSON. No markdown fences, no explanation.',
  });
  if (!raw) return null;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(cleaned);
  } catch (_) {
    return null;
  }
}
