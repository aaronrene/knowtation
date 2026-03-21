/**
 * MCP Phase H — progress notifications (notifications/progress) and logging (notifications/message).
 * @see docs/MCP-PHASE-H.md
 */

/**
 * @param {Record<string, unknown>} extra - McpServer tool handler extra (from SDK)
 * @param {{ progress: number, total?: number, message?: string }} params
 */
export async function sendMcpToolProgress(extra, params) {
  const token = extra?._meta?.progressToken;
  if (token === undefined || typeof extra?.sendNotification !== 'function') return;
  try {
    await extra.sendNotification({
      method: 'notifications/progress',
      params: {
        progressToken: token,
        progress: params.progress,
        ...(params.total !== undefined ? { total: params.total } : {}),
        ...(params.message ? { message: params.message } : {}),
      },
    });
  } catch (_) {
    /* client may not support progress */
  }
}

/**
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} mcpServer
 * @param {'debug'|'info'|'notice'|'warning'|'error'|'critical'|'alert'|'emergency'} level
 * @param {unknown} data
 */
export async function sendMcpLog(mcpServer, level, data) {
  if (!mcpServer?.isConnected?.()) return;
  try {
    await mcpServer.sendLoggingMessage({ level, data });
  } catch (_) {}
}
