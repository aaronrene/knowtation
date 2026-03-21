#!/usr/bin/env node
/**
 * Knowtation MCP — stdio transport (default). See mcp/server.mjs for HTTP routing.
 */
import '../lib/load-env.mjs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../lib/config.mjs';
import { createKnowtationMcpServer } from './create-server.mjs';
import { startVaultResourceWatcher } from './resource-subscriptions.mjs';

const server = createKnowtationMcpServer();

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  try {
    const config = loadConfig();
    startVaultResourceWatcher(server, config.vault_path);
  } catch (_) {
    /* invalid config: tools will fail until fixed */
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
