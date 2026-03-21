/**
 * Knowtation MCP — Streamable HTTP (Issue #1 Phase D1).
 * One McpServer + transport per session (Mcp-Session-Id). No vault file watcher (multi-session).
 */

import '../lib/load-env.mjs';
import { randomUUID } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { loadConfig } from '../lib/config.mjs';
import { createKnowtationMcpServer } from './create-server.mjs';

/** @type {Map<string, import('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransport>} */
const transports = new Map();

function resolveListen() {
  try {
    const c = loadConfig();
    return { host: c.mcp.http_host, port: c.mcp.http_port };
  } catch {
    const p = parseInt(process.env.KNOWTATION_MCP_HTTP_PORT || '3334', 10);
    return { host: '127.0.0.1', port: Number.isFinite(p) ? p : 3334 };
  }
}

export async function startKnowtationMcpHttp() {
  const { host, port } = resolveListen();
  const app = createMcpExpressApp({ host });

  app.all('/mcp', async (req, res) => {
    const sessionHeader = req.headers['mcp-session-id'];
    let transport = sessionHeader ? transports.get(String(sessionHeader)) : undefined;
    if (!transport) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
      });
      const mcp = createKnowtationMcpServer();
      await mcp.connect(transport);
    }
    await transport.handleRequest(req, res, req.body);
  });

  return new Promise((resolve, reject) => {
    const srv = app.listen(port, host, () => {
      console.error(`Knowtation MCP (Streamable HTTP) http://${host}:${port}/mcp`);
      resolve(srv);
    });
    srv.on('error', reject);
  });
}
