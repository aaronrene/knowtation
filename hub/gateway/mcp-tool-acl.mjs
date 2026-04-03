/**
 * Issue #1 Phase D2 — role-based tool access control for hosted MCP.
 * Filters available tools based on user role (viewer, editor, admin).
 */

const READ_TOOLS = new Set([
  'search',
  'get_note',
  'list_notes',
  'relate',
  'backlinks',
  'extract_tasks',
  'cluster',
  'tag_suggest',
  'summarize',
  'enrich',
]);

const WRITE_TOOLS = new Set([
  ...READ_TOOLS,
  'write',
  'capture',
  'transcribe',
  'vault_sync',
]);

const ADMIN_TOOLS = new Set([
  ...WRITE_TOOLS,
  'index',
  'export',
  'import',
]);

const ROLE_TOOL_MAP = {
  viewer: READ_TOOLS,
  editor: WRITE_TOOLS,
  admin: ADMIN_TOOLS,
};

/**
 * Get the set of allowed tool names for a given role.
 * @param {'viewer' | 'editor' | 'admin'} role
 * @returns {Set<string>}
 */
export function allowedToolsForRole(role) {
  return ROLE_TOOL_MAP[role] || READ_TOOLS;
}

/**
 * Check whether a specific tool is allowed for the given role.
 * @param {string} toolName
 * @param {'viewer' | 'editor' | 'admin'} role
 * @returns {boolean}
 */
export function isToolAllowed(toolName, role) {
  const allowed = allowedToolsForRole(role);
  return allowed.has(toolName);
}

/**
 * Filter a list of tool definitions to only those allowed for the role.
 * @param {{ name: string }[]} tools
 * @param {'viewer' | 'editor' | 'admin'} role
 * @returns {{ name: string }[]}
 */
export function filterToolsByRole(tools, role) {
  const allowed = allowedToolsForRole(role);
  return tools.filter((t) => allowed.has(t.name));
}
