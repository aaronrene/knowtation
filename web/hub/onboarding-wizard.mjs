/**
 * Hub onboarding wizard: state + step definitions (hosted vs self-hosted).
 * UI binding lives in hub.js; this module stays testable without a browser DOM.
 */

export const ONBOARDING_LS_KEY = 'knowtation_onboarding_v1';

/** Repo docs on GitHub main (Hub is often opened without a local clone). */
export const DOCS_BASE = 'https://github.com/aaronrene/knowtation/blob/main/docs';

export const AGENT_INTEGRATION_ANCHOR_PROPOSALS = `${DOCS_BASE}/AGENT-INTEGRATION.md#4-proposals-review-before-commit`;

export const IMPORT_SOURCES_URL = `${DOCS_BASE}/IMPORT-SOURCES.md`;

/**
 * Copyable text: user pastes into ChatGPT / Claude / etc. to get export steps for their stack.
 * Grounded in IMPORT-SOURCES.md (chatgpt-export, claude-export, openclaw).
 */
export const LLM_SELF_HELP_EXPORT_PROMPT = [
  'I am importing chats and memory into Knowtation (Markdown vault notes with frontmatter).',
  '',
  'Please give concise, accurate export instructions for my situation:',
  '- OpenAI / ChatGPT: account data export (ZIP or folder with conversations.json) suitable for a `chatgpt-export` style import.',
  '- Anthropic / Claude: privacy export (chats and/or memory) suitable for a `claude-export` style import.',
  '- OpenClaw: any supported export path or files that map to Knowtation `openclaw` import.',
  '',
  'For each product I name, list the exact menu path (as of my stated app version if I add one), the file types I will get (ZIP, JSON, folder layout), and any size or rate limits I should watch for.',
  '',
  'I will upload the result via Knowtation Hub Import or run `knowtation import <source-type> …` from the CLI after export.',
].join('\n');

/** @typedef {'hosted'|'selfhosted'} HostingPath */
/** @typedef {'in_progress'|'dismissed'|'completed'} OnboardingStatus */

/**
 * @typedef {Object} OnboardingStateV1
 * @property {1} v
 * @property {string} userKey
 * @property {HostingPath} hostingPath
 * @property {number} stepIndex
 * @property {OnboardingStatus} status
 * @property {number | null} [dismissedAt]
 * @property {number | null} [completedAt]
 */

/**
 * @param {unknown} raw
 * @returns {OnboardingStateV1 | null}
 */
export function parseOnboardingState(raw) {
  if (raw == null || typeof raw !== 'string') return null;
  try {
    const o = JSON.parse(raw);
    if (!o || o.v !== 1 || typeof o.userKey !== 'string') return null;
    if (o.hostingPath !== 'hosted' && o.hostingPath !== 'selfhosted') return null;
    const status = o.status;
    if (status !== 'in_progress' && status !== 'dismissed' && status !== 'completed') return null;
    const stepIndex = Math.max(0, Math.floor(Number(o.stepIndex) || 0));
    return {
      v: 1,
      userKey: o.userKey,
      hostingPath: o.hostingPath,
      stepIndex,
      status,
      dismissedAt: typeof o.dismissedAt === 'number' ? o.dismissedAt : null,
      completedAt: typeof o.completedAt === 'number' ? o.completedAt : null,
    };
  } catch {
    return null;
  }
}

/** @param {OnboardingStateV1} s */
export function serializeOnboardingState(s) {
  return JSON.stringify(s);
}

/**
 * @param {string} userKey
 * @param {HostingPath} hostingPath
 * @returns {OnboardingStateV1}
 */
export function createFreshState(userKey, hostingPath) {
  return {
    v: 1,
    userKey,
    hostingPath,
    stepIndex: 0,
    status: 'in_progress',
    dismissedAt: null,
    completedAt: null,
  };
}

/**
 * @param {boolean} isHosted
 * @returns {number}
 */
export function getStepCount(isHosted) {
  return isHosted ? 9 : 5;
}

/**
 * Whether to open the wizard automatically after login/settings.
 * @param {OnboardingStateV1 | null} state
 * @param {string} currentUserKey
 * @param {HostingPath} currentHostingPath
 * @returns {boolean}
 */
export function shouldAutoOpenWizard(state, currentUserKey, currentHostingPath) {
  if (!currentUserKey) return false;
  if (!state) return true;
  if (state.userKey !== currentUserKey) return true;
  if (state.hostingPath !== currentHostingPath) return true;
  if (state.status === 'dismissed' || state.status === 'completed') return false;
  return state.status === 'in_progress';
}

/**
 * @param {boolean} isHosted
 * @param {number} index
 * @returns {{ id: string, title: string, bodyHtml: string } | null}
 */
export function getStepContent(isHosted, index) {
  if (isHosted) {
    const steps = [
      {
        id: 'h0',
        title: 'Your memory home',
        bodyHtml:
          '<p><strong>Knowtation Hub</strong> is where your team’s <strong>indexed vault</strong> lives — Markdown notes, search, optional time/episode/entity fields, and governed agent writes.</p>' +
          '<p class="onboarding-token-line"><strong>Vault / retrieval:</strong> stop re-pasting the same context; use search with limits and snippets so assistants pull only what they need.</p>' +
          '<p class="onboarding-token-line"><strong>Terminal tool output:</strong> shrinking shell logs before a model reads them is <strong>not</strong> the core vault product. Optional <strong>local</strong> add-ons on your coding host can help; Knowtation does <strong>not</strong> run canister-side terminal hooks for log compaction.</p>' +
          '<p class="onboarding-tip">Same honest story as <a href="' +
          DOCS_BASE +
          '/WHY-KNOWTATION.md#two-layers-of-token-savings-say-both-honestly" target="_blank" rel="noopener">Why Knowtation — token layers</a>.</p>',
      },
      {
        id: 'h1',
        title: 'Pick where to start',
        bodyHtml:
          '<p>Both paths are normal. You can switch any time.</p>' +
          '<div class="onboarding-path-grid" role="group" aria-label="Onboarding paths">' +
          '<div class="onboarding-path-card">' +
          '<h3 class="onboarding-path-card-title">Bring my stuff in</h3>' +
          '<p class="onboarding-path-card-body">Imports turn exports into vault notes (<strong>Import</strong> in the header). Good when you already have ChatGPT, Claude, OpenClaw, or file exports ready.</p>' +
          '</div>' +
          '<div class="onboarding-path-card">' +
          '<h3 class="onboarding-path-card-title">Connect my AI first</h3>' +
          '<p class="onboarding-path-card-body">Wire <strong>MCP</strong> or the Hub API so assistants search and (with roles) propose changes. Good when the vault is empty but your IDE or agent runtime is ready.</p>' +
          '</div>' +
          '</div>' +
          '<p class="onboarding-tip">The next screens cover <strong>Integrations</strong>, <strong>imports by platform</strong>, and <strong>proposals</strong> so both orders make sense.</p>',
      },
      {
        id: 'h2',
        title: 'Integrations (MCP + API)',
        bodyHtml:
          '<p>Open <strong>Settings → Integrations</strong> while signed in. Copy the <strong>Hub base URL</strong>, <strong>Bearer token</strong>, and <strong>vault id</strong> for remote MCP (e.g. Cursor <code>knowtation-hosted</code>) or REST calls.</p>' +
          '<p>The Integrations tab shows the same JSON shape as the docs: <code>Authorization: Bearer …</code> and <code>X-Vault-Id</code> on <code>POST …/mcp</code> or <code>/api/v1/search</code>, etc.</p>' +
          '<p class="onboarding-tip"><strong>Copy MCP</strong> and <strong>Copy prime</strong> (small JSON + <code>knowtation://hosted/prime</code> for <code>readResource</code> after connect — no JWT in the prime blob) live on that tab.</p>' +
          '<p class="onboarding-tip">Deep reference: <a href="' +
          DOCS_BASE +
          '/AGENT-INTEGRATION.md" target="_blank" rel="noopener">Agent integration</a> (CLI, MCP, Hub API).</p>',
      },
      {
        id: 'h-imports',
        title: 'Imports by platform',
        bodyHtml:
          '<p>Hub <strong>Import</strong> accepts the same <code>source_type</code> values as the CLI. Three common stacks:</p>' +
          '<ul class="onboarding-import-cards" role="list">' +
          '<li><strong>OpenAI / ChatGPT</strong> — <code>chatgpt-export</code>; ZIP or folder with <code>conversations.json</code> from your account export.</li>' +
          '<li><strong>Anthropic / Claude</strong> — <code>claude-export</code>; chat + memory export ZIP or folder from Privacy / export flows.</li>' +
          '<li><strong>OpenClaw</strong> — <code>openclaw</code>; agent memory + chats per <a href="' +
          IMPORT_SOURCES_URL +
          '#3-supported-import-sources-spec" target="_blank" rel="noopener">Import sources</a>.</li>' +
          '</ul>' +
          '<p class="onboarding-tip">Full matrix: <a href="' +
          IMPORT_SOURCES_URL +
          '" target="_blank" rel="noopener">IMPORT-SOURCES.md</a>.</p>' +
          '<p><strong>LLM self-help:</strong> paste the text below into any assistant and name your product; ask it for exact export menu paths and file shapes.</p>' +
          '<textarea class="onboarding-llm-prompt" data-onboarding-llm-prompt readonly rows="9" aria-label="Copyable prompt for export instructions"></textarea>' +
          '<p class="onboarding-copy-row"><button type="button" class="btn-secondary onboarding-copy-llm-btn">Copy export helper prompt</button></p>',
      },
      {
        id: 'h4',
        title: 'Proposals and the Suggested queue',
        bodyHtml:
          '<p><strong>Agents suggest; humans approve.</strong> Proposed edits stay out of the canonical vault until someone approves them — same speed as direct writes, with a paper trail and roles.</p>' +
          '<p>In the Hub, open the <strong>Suggested</strong> tab (next to Notes and Activity) to review proposals. <strong>Activity</strong> is the timeline; <strong>Discarded</strong> keeps rejected items for reference. You can also start a proposal from a note (<strong>Propose change</strong>) or <strong>New proposal</strong>.</p>' +
          '<p class="onboarding-tip">Contract and API details: <a href="' +
          AGENT_INTEGRATION_ANCHOR_PROPOSALS +
          '" target="_blank" rel="noopener">Agent integration — §4 Proposals</a>.</p>',
      },
      {
        id: 'h5',
        title: 'Your notes live here',
        bodyHtml:
          '<p>After you sign in, your vault is <strong>your private space</strong> in Knowtation. The list may look empty until you add something — that is normal.</p>' +
          '<p class="onboarding-tip">On hosted Knowtation, a <strong>project</strong> is a label on notes to group them (not a disk folder path).</p>',
      },
      {
        id: 'h6',
        title: 'Add your first note or file',
        bodyHtml:
          '<p>Use <strong>+ New note</strong> to write something small (for example a shopping list or a link you want to remember).</p>' +
          '<p>Or use <strong>Import</strong> to bring in a file from your computer.</p>' +
          '<p class="onboarding-tip">Want more detail? Open <strong>How to use</strong> → Knowledge &amp; agents anytime.</p>',
      },
      {
        id: 'h7',
        title: 'Keep a copy (optional)',
        bodyHtml:
          '<p>Your notes are already stored on Knowtation. If you also want a <strong>copy on GitHub</strong> (your account, your repo), use <strong>Settings → Backup</strong> and connect GitHub when you are ready.</p>' +
          '<p class="onboarding-tip">You can skip this until later.</p>',
      },
      {
        id: 'h8',
        title: 'Power tools for agents',
        bodyHtml:
          '<p>Hosted MCP exposes the same operations as the CLI for vault work: <strong>search</strong> (semantic or keyword), <strong>get_note</strong>, <strong>list_notes</strong>, <strong>write</strong>, <strong>propose</strong>, <strong>import</strong>, <strong>index</strong>, and more — with role gates (viewer vs editor vs admin).</p>' +
          '<p><strong>MCP prompts</strong> (composition templates) are registered per your role — use <code>prompts/list</code> after connect for the exact set on <em>this</em> deployment. Inventory (subset): <strong>daily-brief</strong>, <strong>search-and-synthesize</strong>, <strong>project-summary</strong>, <strong>temporal-summary</strong>, <strong>content-plan</strong>, <strong>meeting-notes</strong>, <strong>knowledge-gap</strong>, <strong>causal-chain</strong>, <strong>extract-entities</strong>, <strong>write-from-capture</strong> (editor+), <strong>memory-context</strong>, <strong>memory-informed-search</strong>, <strong>resume-session</strong>. The <strong>Copy prime</strong> JSON points at <code>knowtation://hosted/prime</code>, which repeats the prompt names allowed for your current session.</p>' +
          '<p class="onboarding-tip">One page for tools, REST, CLI, and proposal semantics: <a href="' +
          DOCS_BASE +
          '/AGENT-INTEGRATION.md" target="_blank" rel="noopener">AGENT-INTEGRATION.md</a>.</p>' +
          '<p>That is the whole hosted loop: notes and imports in the vault, integrations for assistants, proposals for safe writes, optional GitHub backup.</p>',
      },
    ];
    return steps[index] || null;
  }
  const steps = [
    {
      id: 's1',
      title: 'Your vault folder',
      bodyHtml:
        '<p>Self-hosted means your notes live in a <strong>folder on your computer</strong>. Knowtation reads and writes Markdown files there.</p>' +
        '<p>In <strong>Settings → Backup</strong>, admins can set the vault path and see the setup checklist. Match the path in <code>config/local.yaml</code> and <code>KNOWTATION_VAULT_PATH</code> in <code>.env</code> so the CLI and Hub agree.</p>' +
        '<p class="onboarding-tip"><a href="https://github.com/aaronrene/knowtation/blob/main/docs/TWO-PATHS-HOSTED-AND-SELF-HOSTED.md#quick-start-self-hosted" target="_blank" rel="noopener">Quick start (self-hosted)</a> in the repo has the exact commands.</p>',
    },
    {
      id: 's2',
      title: 'Semantic search (optional but useful)',
      bodyHtml:
        '<p><strong>Listing notes</strong> works without extra setup. <strong>Search vault</strong> needs an index: run <code>npm run index</code> once from the project root, or click <strong>Re-index</strong> in the Hub after you change config.</p>' +
        '<p class="onboarding-tip">Open <strong>How to use → Setup</strong> for Step 4 (embeddings and sqlite-vec) in plain language.</p>',
    },
    {
      id: 's3',
      title: 'Sign in (OAuth)',
      bodyHtml:
        '<p>The Hub uses Google or GitHub sign-in so it knows who you are. On self-hosted, you register your own OAuth app and put client ID and secret in <code>.env</code>, then restart the Hub.</p>' +
        '<p class="onboarding-tip">If you see “OAuth is not configured”, follow <strong>How to use → Setup → Step 3</strong>.</p>',
    },
    {
      id: 's4',
      title: 'Import, agents, and backup',
      bodyHtml:
        '<p><strong>Import</strong> brings files from other tools. <strong>Settings → Integrations</strong> shows how to connect agents (MCP). <strong>Settings → Backup</strong> walks through GitHub backup when you want version history off-machine.</p>' +
        '<p><strong>Proposals:</strong> agents use the same APIs as humans; review queued changes under the Hub <strong>Suggested</strong> tab before they merge into the vault. See <a href="' +
        AGENT_INTEGRATION_ANCHOR_PROPOSALS +
        '" target="_blank" rel="noopener">Agent integration — §4 Proposals</a>.</p>' +
        '<p class="onboarding-tip">The seven steps under <strong>How to use → Setup</strong> stay the full reference — this wizard is the short path.</p>',
    },
    {
      id: 's5',
      title: 'You are set',
      bodyHtml:
        '<p>Use the tree and search to browse notes, <strong>+ New note</strong> to capture, and <strong>Settings</strong> anytime for backup and integrations.</p>' +
        '<p class="onboarding-tip">Come back to <strong>How to use</strong> whenever you need deeper explanations.</p>',
    },
  ];
  return steps[index] || null;
}

/**
 * Secondary actions for wizard footer (handled in hub.js).
 * @typedef {{ id: string, label: string }} OnboardingAction
 * @param {boolean} isHosted
 * @param {number} index
 * @returns {OnboardingAction[]}
 */
export function getStepSecondaryActions(isHosted, index) {
  if (isHosted) {
    if (index === 0) return [{ id: 'openWhyTokenDoc', label: 'Why Knowtation (tokens)' }];
    if (index === 1) return [{ id: 'openImportModal', label: 'Open Import' }, { id: 'openSettingsIntegrations', label: 'Settings → Integrations' }];
    if (index === 2) return [{ id: 'openSettingsIntegrations', label: 'Open Settings → Integrations' }];
    if (index === 3) return [{ id: 'openImportModal', label: 'Open Import' }, { id: 'openImportSourcesDoc', label: 'Import sources (docs)' }];
    if (index === 4) return [{ id: 'focusSuggestedTab', label: 'Open Suggested tab' }, { id: 'openAgentDocProposals', label: 'Read §4 Proposals (docs)' }];
    if (index === 5) return [{ id: 'projectsHelp', label: 'How projects work' }];
    if (index === 6) return [{ id: 'howToKnowledge', label: 'How to use: Knowledge & agents' }];
    if (index === 7) return [{ id: 'openSettingsBackup', label: 'Open Settings → Backup' }];
    if (index === 8) return [{ id: 'openAgentIntegrationDoc', label: 'Open AGENT-INTEGRATION.md' }];
    return [];
  }
  if (index === 0) return [{ id: 'openSettingsBackup', label: 'Open Settings → Backup' }];
  if (index === 1) return [{ id: 'howToSetup4', label: 'How to use: Setup (search)' }];
  if (index === 2) return [{ id: 'howToSetup3', label: 'How to use: Setup (sign in)' }];
  if (index === 3) {
    return [
      { id: 'openSettingsIntegrations', label: 'Settings → Integrations' },
      { id: 'openSettingsBackup', label: 'Settings → Backup' },
      { id: 'openAgentDocProposals', label: '§4 Proposals (docs)' },
    ];
  }
  return [];
}
