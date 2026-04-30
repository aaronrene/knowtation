/**
 * Issue #1 Phase D2 — role-based tool access control for hosted MCP.
 * Filters available tools based on user role (viewer, editor, admin, evaluator).
 * Hosted prompts (Track B1–B3): default **viewer**; **`write-from-capture`** is **editor** (implies persisting notes).
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
  'hub_create_proposal',
  'capture',
  'transcribe',
  'vault_sync',
]);

const ADMIN_TOOLS = new Set([
  ...WRITE_TOOLS,
  'index',
  'export',
  'import',
  'import_url',
]);

const ROLE_TOOL_MAP = {
  viewer: READ_TOOLS,
  editor: WRITE_TOOLS,
  /** Same tool surface as editor (incl. hub_create_proposal); bridge hosted-context may report role evaluator. */
  evaluator: WRITE_TOOLS,
  admin: ADMIN_TOOLS,
};

/** Hosted MCP prompt IDs (Track B1 + B2 + B3 memory trio); each maps to canister / bridge routes like tools — no local vault files. */
const HOSTED_PROMPT_IDS = new Set([
  'daily-brief',
  'search-and-synthesize',
  'project-summary',
  'temporal-summary',
  'content-plan',
  'meeting-notes',
  'knowledge-gap',
  'causal-chain',
  'extract-entities',
  'write-from-capture',
  'memory-context',
  'memory-informed-search',
  'resume-session',
]);

/** Minimum role per prompt (`write-from-capture` implies vault write → editor). */
const PROMPT_MIN_ROLE = /** @type {Record<string, 'viewer' | 'editor' | 'admin' | 'evaluator'>} */ ({
  'daily-brief': 'viewer',
  'search-and-synthesize': 'viewer',
  'project-summary': 'viewer',
  'temporal-summary': 'viewer',
  'content-plan': 'viewer',
  'meeting-notes': 'viewer',
  'knowledge-gap': 'viewer',
  'causal-chain': 'viewer',
  'extract-entities': 'viewer',
  'write-from-capture': 'editor',
  'memory-context': 'viewer',
  'memory-informed-search': 'viewer',
  'resume-session': 'viewer',
});

/** evaluator ≥ editor for prompts; admin remains highest for future admin-only prompts. */
const ROLE_RANK = { viewer: 0, editor: 1, evaluator: 2, admin: 3 };

/**
 * Get the set of allowed tool names for a given role.
 * @param {'viewer' | 'editor' | 'admin' | 'evaluator'} role
 * @returns {Set<string>}
 */
export function allowedToolsForRole(role) {
  return ROLE_TOOL_MAP[role] || READ_TOOLS;
}

/**
 * Check whether a specific tool is allowed for the given role.
 * @param {string} toolName
 * @param {'viewer' | 'editor' | 'admin' | 'evaluator'} role
 * @returns {boolean}
 */
export function isToolAllowed(toolName, role) {
  const allowed = allowedToolsForRole(role);
  return allowed.has(toolName);
}

/**
 * Filter a list of tool definitions to only those allowed for the role.
 * @param {{ name: string }[]} tools
 * @param {'viewer' | 'editor' | 'admin' | 'evaluator'} role
 * @returns {{ name: string }[]}
 */
export function filterToolsByRole(tools, role) {
  const allowed = allowedToolsForRole(role);
  return tools.filter((t) => allowed.has(t.name));
}

/**
 * Prompt names exposed for this role (subset of {@link HOSTED_PROMPT_IDS} when min role not met).
 * @param {'viewer' | 'editor' | 'admin' | 'evaluator'} role
 * @returns {Set<string>}
 */
export function allowedPromptsForRole(role) {
  const rank = ROLE_RANK[role] ?? 0;
  const out = new Set();
  for (const name of HOSTED_PROMPT_IDS) {
    const min = PROMPT_MIN_ROLE[name] ?? 'viewer';
    if (rank >= ROLE_RANK[min]) out.add(name);
  }
  return out;
}

/**
 * @param {string} promptName
 * @param {'viewer' | 'editor' | 'admin' | 'evaluator'} role
 */
export function isPromptAllowed(promptName, role) {
  if (!HOSTED_PROMPT_IDS.has(promptName)) return false;
  const min = PROMPT_MIN_ROLE[promptName] ?? 'viewer';
  return (ROLE_RANK[role] ?? 0) >= ROLE_RANK[min];
}
