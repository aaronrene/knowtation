/**
 * Hub onboarding wizard: state + step definitions (hosted vs self-hosted).
 * UI binding lives in hub.js; this module stays testable without a browser DOM.
 */

export const ONBOARDING_LS_KEY = 'knowtation_onboarding_v1';

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
  return isHosted ? 4 : 5;
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
        id: 'h1',
        title: 'Your notes live here',
        bodyHtml:
          '<p>After you sign in, your vault is <strong>your private space</strong> in Knowtation. The list may look empty until you add something—that is normal.</p>' +
          '<p class="onboarding-tip">On hosted Knowtation, a <strong>project</strong> is just a label you put on notes to group them. Optional: learn more in one click.</p>',
      },
      {
        id: 'h2',
        title: 'Add your first note or file',
        bodyHtml:
          '<p>Use <strong>+ New note</strong> to write something small (for example a shopping list or a link you want to remember).</p>' +
          '<p>Or use <strong>Import</strong> to bring in a file from your computer.</p>' +
          '<p class="onboarding-tip">Want more detail? Open <strong>How to use</strong> → Knowledge &amp; agents anytime.</p>',
      },
      {
        id: 'h3',
        title: 'Keep a copy (optional)',
        bodyHtml:
          '<p>Your notes are already stored safely on Knowtation. If you also want a <strong>copy on GitHub</strong> (your account, your repo), use <strong>Settings → Backup</strong> and connect GitHub when you are ready.</p>' +
          '<p class="onboarding-tip">You can skip this step until later. Nothing is lost if you skip.</p>',
      },
      {
        id: 'h4',
        title: 'Use Knowtation with ChatGPT, Cursor, or other tools',
        bodyHtml:
          '<p>Agents connect through <strong>MCP</strong> (a standard way apps talk to your vault). In <strong>Settings → Integrations</strong> you will find the server URL and token to paste into your tool.</p>' +
          '<p class="onboarding-tip">Full setup tips live in the repo under <code>docs/AGENT-INTEGRATION.md</code>—open from Integrations when you need it.</p>',
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
          '<p class="onboarding-tip">The seven steps under <strong>How to use → Setup</strong> stay the full reference—this wizard is the short path.</p>',
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
    if (index === 0) return [{ id: 'projectsHelp', label: 'How projects work' }];
    if (index === 1) return [{ id: 'howToKnowledge', label: 'How to use: Knowledge & agents' }];
    if (index === 2) return [{ id: 'openSettingsBackup', label: 'Open Settings → Backup' }];
    if (index === 3) return [{ id: 'openSettingsIntegrations', label: 'Open Settings → Integrations' }];
    return [];
  }
  if (index === 0) return [{ id: 'openSettingsBackup', label: 'Open Settings → Backup' }];
  if (index === 1) return [{ id: 'howToSetup4', label: 'How to use: Setup (search)' }];
  if (index === 2) return [{ id: 'howToSetup3', label: 'How to use: Setup (sign in)' }];
  if (index === 3) return [{ id: 'openSettingsIntegrations', label: 'Settings → Integrations' }, { id: 'openSettingsBackup', label: 'Settings → Backup' }];
  return [];
}
