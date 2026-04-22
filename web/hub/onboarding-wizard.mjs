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
          '<p><strong>Knowtation Hub</strong> holds your team’s indexed notes — Markdown you own, fast search, and one simple rule for AI: <strong>suggested edits wait for your approval</strong> before they become real notes.</p>' +
          '<details class="how-to-details">' +
          '<summary>More detail — “token savings” (two layers, plain English)</summary>' +
          '<div class="how-to-details-body">' +
          '<p><strong>Vault &amp; search:</strong> Assistants pull short snippets instead of giant paste-ins — that saves context in any tool.</p>' +
          '<p><strong>Terminal chatter:</strong> Shrinking raw shell logs on your laptop is separate optional tooling; it is not what this hosted vault product runs for you.</p>' +
          '<p class="onboarding-tip">Same framing as <a href="' +
          DOCS_BASE +
          '/WHY-KNOWTATION.md#two-layers-of-token-savings-say-both-honestly" target="_blank" rel="noopener">Why Knowtation — token layers</a>.</p>' +
          '</div>' +
          '</details>',
      },
      {
        id: 'h1',
        title: 'What do you want to do first?',
        bodyHtml:
          '<p>For <strong>hosted</strong> Knowtation (what you signed into here), almost everyone starts one of two ways — pick one; you can do the other anytime.</p>' +
          '<div class="onboarding-path-grid" role="group" aria-label="Hosted getting started">' +
          '<div class="onboarding-path-card">' +
          '<h3 class="onboarding-path-card-title">Bring in chats &amp; files</h3>' +
          '<p class="onboarding-path-card-body">Upload exports or files with <strong>Import</strong> (header). Use this when you already have a ChatGPT / Claude / OpenClaw export or documents on your computer.</p>' +
          '</div>' +
          '<div class="onboarding-path-card">' +
          '<h3 class="onboarding-path-card-title">Connect your assistant</h3>' +
          '<p class="onboarding-path-card-body">Open <strong>Settings → Integrations</strong> and paste the copied block into Cursor, Claude Desktop, or another MCP-capable tool so it can search your vault and queue suggested edits.</p>' +
          '</div>' +
          '</div>' +
          '<details class="how-to-details">' +
          '<summary>Self-hosted only — I run Knowtation on my own computer</summary>' +
          '<div class="how-to-details-body">' +
          '<p>If you cloned this repo and run the Hub locally, the <em>ideas</em> are the same (import vs connect tools), but you also manage disk paths, OAuth apps, and config files. Follow <strong>How to use → Setup → Self-hosted setup</strong> and the repo <a href="' +
          DOCS_BASE +
          '/TWO-PATHS-HOSTED-AND-SELF-HOSTED.md#quick-start-self-hosted" target="_blank" rel="noopener">Quick start (self-hosted)</a>.</p>' +
          '</div>' +
          '</details>' +
          '<p class="onboarding-tip">Next: <strong>Integrations</strong>, imports by platform, then <strong>Suggested</strong> (where edits wait for approval).</p>',
      },
      {
        id: 'h2',
        title: 'Integrations (MCP + API)',
        bodyHtml:
          '<p>While signed in, open <strong>Settings → Integrations → Hub API</strong>.</p>' +
          '<p><strong>Copy Hub URL, token &amp; vault</strong> — your private “key card” for tools outside the browser (paste into env vars or MCP config).</p>' +
          '<p><strong>Copy MCP</strong> — a ready-made snippet for common clients.</p>' +
          '<p><strong>Copy prime</strong> — a small <strong>non-secret</strong> JSON reminder (which Hub and vault). Not your password; use it with the key card after your tool connects.</p>' +
          '<details class="how-to-details">' +
          '<summary>Technical details (headers, env names, prime URI)</summary>' +
          '<div class="how-to-details-body">' +
          '<p>Requests use <code>Authorization: Bearer …</code> and <code>X-Vault-Id</code> on <code>POST …/mcp</code>, <code>/api/v1/search</code>, and related routes. The copy button names variables such as <code>KNOWTATION_HUB_URL</code>, <code>KNOWTATION_HUB_TOKEN</code>, and <code>KNOWTATION_HUB_VAULT_ID</code>.</p>' +
          '<p><strong>Copy prime</strong> JSON points at MCP <code>readResource</code> URI <code>knowtation://hosted/prime</code> plus gateway base URL and vault id — <strong>no JWT inside</strong>. After connect, reading that resource can return session context and prompt names for your role.</p>' +
          '</div>' +
          '</details>' +
          '<p class="onboarding-tip">Deep reference: <a href="' +
          DOCS_BASE +
          '/AGENT-INTEGRATION.md" target="_blank" rel="noopener">Agent integration</a> (CLI, MCP, Hub API).</p>',
      },
      {
        id: 'h-imports',
        title: 'Imports by platform',
        bodyHtml:
          '<p>Use <strong>Import</strong> in the header to upload exports. Most people start with one of these:</p>' +
          '<ul class="onboarding-import-cards" role="list">' +
          '<li><strong>OpenAI / ChatGPT</strong> — account data export (ZIP or folder; often includes <code>conversations.json</code>).</li>' +
          '<li><strong>Anthropic / Claude</strong> — privacy / data export (chats and/or memory).</li>' +
          '<li><strong>OpenClaw</strong> — supported agent exports per our import matrix.</li>' +
          '</ul>' +
          '<details class="how-to-details">' +
          '<summary>CLI &amp; API source names</summary>' +
          '<div class="how-to-details-body">' +
          '<p>The Hub and CLI label these as <code>chatgpt-export</code>, <code>claude-export</code>, <code>openclaw</code>, and more. Full list and flags: <a href="' +
          IMPORT_SOURCES_URL +
          '" target="_blank" rel="noopener">Import sources</a>.</p>' +
          '</div>' +
          '</details>' +
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
          '<p>On hosted Knowtation, MCP exposes vault operations your role allows — search and read notes, propose changes (with humans approving in <strong>Suggested</strong>), imports, indexing, memory tools where enabled, and more.</p>' +
          '<p><strong>MCP prompts</strong> are composition templates registered for your session. After you connect, your client can list them (e.g. via <code>prompts/list</code>) — that list is authoritative for this deployment.</p>' +
          '<details class="how-to-details">' +
          '<summary>Technical inventory (prompt names &amp; prime)</summary>' +
          '<div class="how-to-details-body">' +
          '<p>Example prompt names you may see include <strong>daily-brief</strong>, <strong>search-and-synthesize</strong>, <strong>project-summary</strong>, <strong>temporal-summary</strong>, <strong>content-plan</strong>, <strong>meeting-notes</strong>, <strong>knowledge-gap</strong>, <strong>causal-chain</strong>, <strong>extract-entities</strong>, <strong>write-from-capture</strong> (editor+), <strong>memory-context</strong>, <strong>memory-informed-search</strong>, <strong>resume-session</strong> — plus tools such as <strong>search</strong>, <strong>get_note</strong>, <strong>list_notes</strong>, <strong>propose</strong>, <strong>import</strong>, <strong>index</strong>. <strong>Copy prime</strong> JSON references <code>knowtation://hosted/prime</code> and echoes allowed prompt names for your current session.</p>' +
          '</div>' +
          '</details>' +
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
      title: 'Where your notes live',
      bodyHtml:
        '<p>In this <strong>browser Hub</strong>, your note list, Import, and search work without you setting a folder path — that is managed for you.</p>' +
        '<details class="how-to-details">' +
        '<summary>Self-hosted only — folder on your machine</summary>' +
        '<div class="how-to-details-body">' +
        '<p>If you run Knowtation from a clone on your computer, notes live in a real <strong>folder</strong>. Match that path in <code>config/local.yaml</code>, <code>KNOWTATION_VAULT_PATH</code> in <code>.env</code>, and <strong>Settings → Backup</strong> so the CLI and Hub agree.</p>' +
        '<p class="onboarding-tip"><a href="' +
        DOCS_BASE +
        '/TWO-PATHS-HOSTED-AND-SELF-HOSTED.md#quick-start-self-hosted" target="_blank" rel="noopener">Quick start (self-hosted)</a> has the exact commands.</p>' +
        '</div>' +
        '</details>',
    },
    {
      id: 's2',
      title: 'Search and indexing',
      bodyHtml:
        '<p><strong>Browsing and listing notes</strong> works right away. After you import a lot or change search-related settings, use <strong>Re-index</strong> in the toolbar so “meaning” search stays in sync.</p>' +
        '<details class="how-to-details">' +
        '<summary>Self-hosted only — CLI from the repo</summary>' +
        '<div class="how-to-details-body">' +
        '<p>From the project root run <code>npm run index</code>, or use <strong>Re-index</strong> here after embedding or vector config changes. Plain-language steps: <strong>How to use → Setup</strong> (embeddings / sqlite-vec).</p>' +
        '</div>' +
        '</details>' +
        '<p class="onboarding-tip">Open <strong>How to use → Setup</strong> anytime for the full checklist.</p>',
    },
    {
      id: 's3',
      title: 'Signing in',
      bodyHtml:
        '<p>You sign in with <strong>Google or GitHub</strong> so this Hub knows which account and vault are yours.</p>' +
        '<details class="how-to-details">' +
        '<summary>Self-hosted only — your own OAuth app (.env)</summary>' +
        '<div class="how-to-details-body">' +
        '<p>Operators register a Google/GitHub OAuth app and put client ID and secret in <code>.env</code>, then restart the Hub. If you see <strong>OAuth is not configured</strong>, follow <strong>How to use → Setup → Step 3</strong> or ask whoever runs your server.</p>' +
        '</div>' +
        '</details>',
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
