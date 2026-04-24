// For hosted deploy: production hostnames below get the Netlify gateway. Localhost is unchanged so
// `npm run hub` keeps same-origin API (Node-only routes like delete-by-project work).
// If your static host reverse-proxies /api/* to that gateway, set:
//   window.HUB_API_BASE_URL = '';
// (empty string → hub.js uses location.origin)
//
// Optional: persistent Node gateway URL for Streamable HTTP MCP (/mcp). Netlify serverless does not host
// stateful /mcp — set this so Copy Hub URL includes KNOWTATION_MCP_URL. Same-origin self-hosted: use
//   window.HUB_MCP_PUBLIC_URL = location.origin + '/mcp'
if (typeof window !== 'undefined' && (window.location.hostname === 'knowtation.store' || window.location.hostname === 'www.knowtation.store')) {
  window.HUB_API_BASE_URL = 'https://knowtation-gateway.netlify.app';
  window.HUB_MCP_PUBLIC_URL = 'https://mcp.knowtation.store/mcp';
}
