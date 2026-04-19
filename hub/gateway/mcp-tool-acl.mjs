/**
 * Issue #1 Phase D2 — role-based tool access control for hosted MCP.
 * Filters available tools based on user role (viewer, editor, admin).
 * Hosted prompts (Track B1) use the same minimum roles as the upstream tools they call.
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

/** Hosted MCP prompt IDs (B1); each maps to canister list / bridge search / canister get like tools — no local vault. */
const READ_PROMPTS = new Set([
  'daily-brief',
  'search-and-synthesize',
  'project-summary',
  'temporal-summary',
  'content-plan',
]);

/** Minimum role per prompt (all B1 prompts are read-only → viewer). */
const PROMPT_MIN_ROLE = /** @type {Record<string, 'viewer' | 'editor' | 'admin'>} */ ({
  'daily-brief': 'viewer',
  'search-and-synthesize': 'viewer',
  'project-summary': 'viewer',
  'temporal-summary': 'viewer',
  'content-plan': 'viewer',
});

const ROLE_RANK = { viewer: 0, editor: 1, admin: 2 };

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

/**
 * Prompt names exposed for this role (subset of {@link READ_PROMPTS} when min role not met).
 * @param {'viewer' | 'editor' | 'admin'} role
 * @returns {Set<string>}
 */
export function allowedPromptsForRole(role) {
  const rank = ROLE_RANK[role] ?? 0;
  const out = new Set();
  for (const name of READ_PROMPTS) {
    const min = PROMPT_MIN_ROLE[name] ?? 'viewer';
    if (rank >= ROLE_RANK[min]) out.add(name);
  }
  return out;
}

/**
 * @param {string} promptName
 * @param {'viewer' | 'editor' | 'admin'} role
 */
export function isPromptAllowed(promptName, role) {
  if (!READ_PROMPTS.has(promptName)) return false;
  const min = PROMPT_MIN_ROLE[promptName] ?? 'viewer';
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK[min];
}
