#!/usr/bin/env node
/**
 * Knowtation MCP entry: stdio (default) or Streamable HTTP when MCP_TRANSPORT=http
 * (or KNOWTATION_MCP_TRANSPORT=http). Run: node mcp/server.mjs | knowtation mcp
 */

import '../lib/load-env.mjs';

const useHttp =
  process.env.MCP_TRANSPORT === 'http' || process.env.KNOWTATION_MCP_TRANSPORT === 'http';

if (useHttp) {
  const { startKnowtationMcpHttp } = await import('./http-server.mjs');
  startKnowtationMcpHttp().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
} else {
  await import('./stdio-main.mjs');
}
