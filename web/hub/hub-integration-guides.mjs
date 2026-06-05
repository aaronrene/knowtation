/**
 * Settings → Integrations tile guides: setup text and copyable commands.
 * Used by hub.js to open the integration detail modal on tile click.
 */

export const IMPORT_SOURCES_DOC =
  'https://github.com/aaronrene/knowtation/blob/main/docs/IMPORT-SOURCES.md';
export const CAPTURE_CONTRACT_DOC =
  'https://github.com/aaronrene/knowtation/blob/main/docs/CAPTURE-CONTRACT.md';
export const MESSAGING_DOC =
  'https://github.com/aaronrene/knowtation/blob/main/docs/MESSAGING-INTEGRATION.md';
export const TEAMS_DOC =
  'https://github.com/aaronrene/knowtation/blob/main/docs/TEAMS-AND-COLLABORATION.md';
export const HERMES_MEMORY_DOC =
  'https://hermes-agent.nousresearch.com/docs/user-guide/features/memory';

export const MODEL_ROUTING_DOC =
  'https://github.com/aaronrene/knowtation/blob/main/docs/COMPANION-APP-MODEL-ROUTING-AND-ENRICHMENT-ARCHITECTURE.md';
export const OPENROUTER_DOC = 'https://openrouter.ai/docs';

/**
 * @typedef {'capture' | 'import' | 'provider'} IntegrationKind
 * @typedef {{ type: 'text', html: string } | { type: 'code', label?: string, code: string }} IntegrationSection
 * @typedef {{
 *   id: string,
 *   icon: string,
 *   name: string,
 *   desc: string,
 *   kind: IntegrationKind,
 *   sourceType?: string,
 *   sections: IntegrationSection[],
 *   docUrl?: string,
 *   docLabel?: string,
 *   hubImport?: boolean,
 * }} IntegrationGuide
 */

/** @type {Record<string, IntegrationGuide>} */
export const INTEGRATION_GUIDES = Object.freeze({
  openrouter: {
    id: 'openrouter',
    icon: '🧭',
    name: 'OpenRouter',
    desc: 'BYO key; one API, many models',
    kind: 'provider',
    docUrl: OPENROUTER_DOC,
    docLabel: 'OpenRouter docs',
    sections: [
      {
        type: 'text',
        html:
          'OpenRouter is a <strong>bring-your-own-key</strong> model lane (OpenAI-compatible): you pay OpenRouter directly, so it is <strong>never metered against Knowtation packs</strong>. Use it to reach many models (OpenAI, Anthropic, Llama, Mistral, …) through one key. A failed OpenRouter call is <strong>not</strong> silently re-routed to a managed provider — your note text stays on the lane you chose.',
      },
      {
        type: 'text',
        html:
          'Select <strong>OpenRouter</strong> under <strong>Settings → Integrations → AI model provider</strong> (self-hosted admins; or set <code>KNOWTATION_CHAT_PROVIDER=openrouter</code> as an operator env lock). The key and model live in server env, never in this UI.',
      },
      {
        type: 'code',
        label: 'Server env',
        code: [
          'KNOWTATION_CHAT_PROVIDER=openrouter',
          'OPENROUTER_API_KEY=sk-or-...',
          '# optional model (default openai/gpt-4o-mini):',
          'OPENROUTER_CHAT_MODEL=anthropic/claude-3.5-haiku',
          '# optional attribution headers:',
          'OPENROUTER_SITE_URL=https://your-hub.example',
          'OPENROUTER_APP_TITLE=Knowtation',
        ].join('\n'),
      },
    ],
  },
  slack: {
    id: 'slack',
    icon: '💬',
    name: 'Slack',
    desc: 'Team chat → Inbox',
    kind: 'capture',
    docUrl: MESSAGING_DOC,
    docLabel: 'MESSAGING-INTEGRATION.md',
    sections: [
      {
        type: 'text',
        html:
          'Run the Slack adapter on your Hub host. It verifies Slack signatures and forwards messages to <code>POST /api/v1/capture</code>.',
      },
      {
        type: 'code',
        label: 'Adapter',
        code: [
          'export CAPTURE_URL=https://your-hub.example/api/v1/capture',
          'export SLACK_SIGNING_SECRET=your_slack_signing_secret',
          '# Optional when Hub sets CAPTURE_WEBHOOK_SECRET:',
          'export CAPTURE_WEBHOOK_SECRET=your_shared_secret',
          'node scripts/capture-slack-adapter.mjs --port 3132',
        ].join('\n'),
      },
      {
        type: 'code',
        label: 'Capture body (JSON)',
        code: '{"body": "message text", "source": "slack", "project": "optional-slug"}',
      },
    ],
  },
  discord: {
    id: 'discord',
    icon: '🎮',
    name: 'Discord',
    desc: 'Server messages → Inbox',
    kind: 'capture',
    docUrl: MESSAGING_DOC,
    docLabel: 'MESSAGING-INTEGRATION.md',
    sections: [
      {
        type: 'text',
        html:
          'Run the Discord adapter and point your bot or webhook at it. Messages are POSTed to the Hub capture endpoint.',
      },
      {
        type: 'code',
        label: 'Adapter',
        code: [
          'export CAPTURE_URL=https://your-hub.example/api/v1/capture',
          'export CAPTURE_WEBHOOK_SECRET=your_shared_secret',
          'node scripts/capture-discord-adapter.mjs --port 3133',
        ].join('\n'),
      },
      {
        type: 'code',
        label: 'Capture body (JSON)',
        code: '{"body": "message text", "source": "discord"}',
      },
    ],
  },
  telegram: {
    id: 'telegram',
    icon: '✈️',
    name: 'Telegram',
    desc: 'Bot or webhook → Inbox',
    kind: 'capture',
    docUrl: MESSAGING_DOC,
    docLabel: 'MESSAGING-INTEGRATION.md',
    sections: [
      {
        type: 'text',
        html:
          'Use the Telegram adapter, or any bot that POSTs JSON to <code>/api/v1/capture</code> with <code>source: telegram</code>.',
      },
      {
        type: 'code',
        label: 'Adapter',
        code: [
          'export CAPTURE_URL=https://your-hub.example/api/v1/capture',
          'export CAPTURE_WEBHOOK_SECRET=your_shared_secret',
          'node scripts/capture-telegram-adapter.mjs --port 3134',
        ].join('\n'),
      },
      {
        type: 'code',
        label: 'Capture body (JSON)',
        code: '{"body": "message text", "source": "telegram"}',
      },
    ],
  },
  whatsapp: {
    id: 'whatsapp',
    icon: '📱',
    name: 'WhatsApp',
    desc: 'Automation → Inbox',
    kind: 'capture',
    docUrl: MESSAGING_DOC,
    docLabel: 'MESSAGING-INTEGRATION.md',
    sections: [
      {
        type: 'text',
        html:
          'Knowtation has no first-party WhatsApp adapter. Use <strong>Zapier</strong>, <strong>n8n</strong>, or Meta Cloud API automation to POST message text to your Hub capture URL.',
      },
      {
        type: 'code',
        label: 'HTTP POST target',
        code: 'POST https://your-hub.example/api/v1/capture',
      },
      {
        type: 'code',
        label: 'Capture body (JSON)',
        code: '{"body": "message text", "source": "whatsapp"}',
      },
    ],
  },
  'chatgpt-export': {
    id: 'chatgpt-export',
    icon: '🤖',
    name: 'ChatGPT',
    desc: 'ZIP or folder export',
    kind: 'import',
    sourceType: 'chatgpt-export',
    hubImport: true,
    docUrl: IMPORT_SOURCES_DOC,
    sections: [
      {
        type: 'text',
        html:
          'In ChatGPT: <strong>Settings → Data controls → Export data</strong>. Download the ZIP (contains <code>conversations.json</code>) and import the extracted folder or ZIP.',
      },
      {
        type: 'code',
        label: 'CLI',
        code:
          'knowtation import chatgpt-export /path/to/export-folder --output-dir imports/chatgpt --tags chatgpt',
      },
    ],
  },
  'claude-export': {
    id: 'claude-export',
    icon: '🧠',
    name: 'Claude',
    desc: 'Chat + memory export',
    kind: 'import',
    sourceType: 'claude-export',
    hubImport: true,
    docUrl: IMPORT_SOURCES_DOC,
    sections: [
      {
        type: 'text',
        html:
          'Export from <strong>Claude → Settings → Privacy → Export data</strong> (chats and/or memory). Accepts Anthropic export folders or third-party JSON/Markdown exports.',
      },
      {
        type: 'code',
        label: 'CLI',
        code:
          'knowtation import claude-export /path/to/claude-export --project myproject --tags claude',
      },
    ],
  },
  'mem0-export': {
    id: 'mem0-export',
    icon: '💾',
    name: 'Mem0',
    desc: 'JSON memory export',
    kind: 'import',
    sourceType: 'mem0-export',
    hubImport: true,
    docUrl: IMPORT_SOURCES_DOC,
    sections: [
      {
        type: 'text',
        html: 'Export memories from Mem0 (<code>create_memory_export</code> / <code>get_memory_export</code>). One vault note per memory entry.',
      },
      {
        type: 'code',
        label: 'CLI',
        code: 'knowtation import mem0-export ./mem0-export.json --project memories --tags mem0',
      },
    ],
  },
  notion: {
    id: 'notion',
    icon: '📝',
    name: 'Notion',
    desc: 'API; page IDs + key',
    kind: 'import',
    sourceType: 'notion',
    hubImport: true,
    docUrl: IMPORT_SOURCES_DOC,
    sections: [
      {
        type: 'text',
        html:
          'Create a Notion integration, share pages with it, then pass comma-separated page IDs. Requires <code>NOTION_API_KEY</code> on the machine running the import.',
      },
      {
        type: 'code',
        label: 'CLI',
        code: [
          'export NOTION_API_KEY=your_integration_secret',
          'knowtation import notion "page-uuid-1,page-uuid-2" --output-dir imports/notion',
        ].join('\n'),
      },
    ],
  },
  'jira-export': {
    id: 'jira-export',
    icon: '🎫',
    name: 'Jira',
    desc: 'CSV export',
    kind: 'import',
    sourceType: 'jira-export',
    hubImport: true,
    docUrl: IMPORT_SOURCES_DOC,
    sections: [
      {
        type: 'text',
        html: 'Export issues from Jira as CSV. One note per issue with full row JSON preserved for search.',
      },
      {
        type: 'code',
        label: 'CLI',
        code: 'knowtation import jira-export ./jira-export.csv --output-dir imports/jira --tags jira',
      },
    ],
  },
  notebooklm: {
    id: 'notebooklm',
    icon: '📓',
    name: 'NotebookLM',
    desc: 'Markdown or JSON',
    kind: 'import',
    sourceType: 'notebooklm',
    hubImport: true,
    docUrl: IMPORT_SOURCES_DOC,
    sections: [
      {
        type: 'text',
        html: 'Import a folder of Markdown files or a JSON export with sources/conversations.',
      },
      {
        type: 'code',
        label: 'CLI',
        code: 'knowtation import notebooklm ./notebooklm-export-folder --output-dir imports/notebooklm',
      },
    ],
  },
  gdrive: {
    id: 'gdrive',
    icon: '📁',
    name: 'Google Drive',
    desc: 'Markdown folder',
    kind: 'import',
    sourceType: 'gdrive',
    hubImport: true,
    docUrl: IMPORT_SOURCES_DOC,
    sections: [
      {
        type: 'text',
        html: 'Point at a folder of <code>.md</code> files (export Docs to Markdown or sync with pandoc).',
      },
      {
        type: 'code',
        label: 'CLI',
        code: 'knowtation import gdrive /path/to/docs-as-markdown --output-dir imports/gdrive',
      },
    ],
  },
  'linear-export': {
    id: 'linear-export',
    icon: '📋',
    name: 'Linear',
    desc: 'CSV export',
    kind: 'import',
    sourceType: 'linear-export',
    hubImport: true,
    docUrl: IMPORT_SOURCES_DOC,
    sections: [
      {
        type: 'text',
        html: 'Export from Linear (<strong>Command menu → Export data → CSV</strong>). One note per issue.',
      },
      {
        type: 'code',
        label: 'CLI',
        code: 'knowtation import linear-export ./linear-export.csv --output-dir imports/linear',
      },
    ],
  },
  mif: {
    id: 'mif',
    icon: '🔗',
    name: 'MIF',
    desc: 'Memory Interchange Format',
    kind: 'import',
    sourceType: 'mif',
    hubImport: true,
    docUrl: IMPORT_SOURCES_DOC,
    sections: [
      {
        type: 'text',
        html:
          '<a href="https://mif-spec.dev/" target="_blank" rel="noopener noreferrer">Memory Interchange Format</a> — copy <code>.memory.md</code> or normalize JSON-LD exports into the vault.',
      },
      {
        type: 'code',
        label: 'CLI',
        code: 'knowtation import mif ./my-memories.memory.md --output-dir imports/mif',
      },
    ],
  },
  markdown: {
    id: 'markdown',
    icon: '📄',
    name: 'Markdown',
    desc: 'File or folder',
    kind: 'import',
    sourceType: 'markdown',
    hubImport: true,
    docUrl: IMPORT_SOURCES_DOC,
    sections: [
      {
        type: 'text',
        html: 'Generic Markdown import for a single file or folder tree. Hub supports ZIP, multi-file, and folder drop.',
      },
      {
        type: 'code',
        label: 'CLI',
        code: [
          'knowtation import markdown ./my-notes.md --output-dir imports/notes',
          'knowtation import markdown ./exported-folder --project myproject',
        ].join('\n'),
      },
    ],
  },
  audio: {
    id: 'audio',
    icon: '🎙️',
    name: 'Audio',
    desc: 'Whisper transcription',
    kind: 'import',
    sourceType: 'audio',
    hubImport: true,
    docUrl: IMPORT_SOURCES_DOC,
    sections: [
      {
        type: 'text',
        html:
          'Self-hosted Hub transcribes with OpenAI Whisper (<strong>~25&nbsp;MB</strong> per file). Requires <code>OPENAI_API_KEY</code>. Larger files may transcode when <code>ffmpeg</code> is available.',
      },
      {
        type: 'code',
        label: 'CLI',
        code: 'knowtation import audio ./recording.m4a --project myproject --output-dir media/audio',
      },
    ],
  },
  'wallet-csv': {
    id: 'wallet-csv',
    icon: '💰',
    name: 'Wallet CSV',
    desc: 'Tx history; 11 formats',
    kind: 'import',
    sourceType: 'wallet-csv',
    hubImport: true,
    docUrl: IMPORT_SOURCES_DOC,
    sections: [
      {
        type: 'text',
        html:
          'Auto-detects Coinbase, Kraken, Binance, MetaMask/Etherscan, Phantom, Ledger Live, and more. One note per transaction row.',
      },
      {
        type: 'code',
        label: 'CLI',
        code: 'knowtation import wallet-csv ./wallet-export.csv --tags payment,on-chain',
      },
    ],
  },
  'supabase-memory': {
    id: 'supabase-memory',
    icon: '🗄️',
    name: 'Supabase',
    desc: 'Memory table import',
    kind: 'import',
    sourceType: 'supabase-memory',
    docUrl: IMPORT_SOURCES_DOC,
    sections: [
      {
        type: 'text',
        html:
          'Import rows from a Supabase memory table (CLI / bridge). Connection credentials must live in server env — never paste secrets into the Hub UI.',
      },
      {
        type: 'code',
        label: 'CLI pattern',
        code: 'knowtation import supabase-memory <connection-or-table-ref> --project memories',
      },
    ],
  },
  openclaw: {
    id: 'openclaw',
    icon: '🦞',
    name: 'OpenClaw',
    desc: 'Agent memory + chats',
    kind: 'import',
    sourceType: 'openclaw',
    docUrl: IMPORT_SOURCES_DOC,
    sections: [
      {
        type: 'text',
        html:
          'Import agent conversations and memory from <a href="https://github.com/openclaw/openclaw" target="_blank" rel="noopener noreferrer">OpenClaw</a>. Point at an export folder or memory dump; one note per conversation or memory entry with <code>source: openclaw</code>.',
      },
      {
        type: 'code',
        label: 'CLI',
        code:
          'knowtation import openclaw /path/to/openclaw-export --output-dir imports/openclaw --tags openclaw',
      },
      {
        type: 'text',
        html:
          'For live capture from channels (Slack, WhatsApp, etc.), run OpenClaw with Knowtation Hub MCP — copy URL, JWT, and vault id from <strong>Hub API</strong> below.',
      },
    ],
  },
  hermes: {
    id: 'hermes',
    icon: '🪶',
    name: 'Hermes Agent',
    desc: 'Agent memory + profile',
    kind: 'import',
    docUrl: HERMES_MEMORY_DOC,
    docLabel: 'Hermes memory docs',
    sections: [
      {
        type: 'text',
        html:
          '<a href="https://github.com/NousResearch/hermes-agent" target="_blank" rel="noopener noreferrer">Hermes Agent</a> stores built-in memory in <code>~/.hermes/memories/MEMORY.md</code> and <code>USER.md</code>. Export a snapshot or copy those files into Knowtation.',
      },
      {
        type: 'code',
        label: 'Export from Hermes',
        code: [
          'hermes memory export --output ~/hermes-memory-backup.json',
          '# Or full portable backup (config + memory + skills):',
          'hermes backup',
        ].join('\n'),
      },
      {
        type: 'code',
        label: 'Import into Knowtation',
        code: [
          'knowtation import markdown ~/.hermes/memories/MEMORY.md \\',
          '  --output-dir imports/hermes --tags hermes,memory',
          'knowtation import markdown ~/.hermes/memories/USER.md \\',
          '  --output-dir imports/hermes --tags hermes,user-profile',
        ].join('\n'),
      },
      {
        type: 'text',
        html:
          'Wire Hermes to your vault for ongoing reads/writes: <strong>Settings → Integrations → Hub API</strong> → copy env vars into Hermes MCP config. External memory providers (Mem0, Honcho, etc.) can be mirrored the same way after export.',
      },
    ],
  },
  imports: {
    id: 'imports',
    icon: '📥',
    name: 'Imports',
    desc: 'Local files & team uploads',
    kind: 'import',
    hubImport: true,
    docUrl: IMPORT_SOURCES_DOC,
    docLabel: 'IMPORT-SOURCES.md',
    sections: [
      {
        type: 'text',
        html: '<strong>Local (your machine)</strong> — Use the Hub <strong>Import</strong> button: pick a source type, drop files or a folder, or upload a ZIP (~100&nbsp;MB per request). For large batches or automation, use the CLI.',
      },
      {
        type: 'code',
        label: 'CLI (local files)',
        code: [
          'knowtation import markdown ./my-folder --output-dir inbox',
          'knowtation import chatgpt-export ./export.zip --tags import',
        ].join('\n'),
      },
      {
        type: 'text',
        html:
          '<strong>Team (shared vault)</strong> — Admins invite editors in <strong>Settings → Team</strong>. Teammates sign in to the same Hub, use <strong>Import</strong> or CLI with shared Hub credentials, and notes land in the team vault. Restrict vaults per person under <strong>Vault access</strong>. See TEAMS-AND-COLLABORATION.md.',
      },
      {
        type: 'code',
        label: 'Team Hub env (from Integrations → Hub API)',
        code: [
          'KNOWTATION_HUB_URL=https://your-hub.example',
          'KNOWTATION_HUB_TOKEN=<JWT after sign-in>',
          'KNOWTATION_HUB_VAULT_ID=default',
        ].join('\n'),
      },
    ],
  },
});

/** @returns {string[]} */
export function listIntegrationGuideIds() {
  return Object.keys(INTEGRATION_GUIDES);
}

/**
 * @param {string} id
 * @returns {IntegrationGuide | null}
 */
export function getIntegrationGuide(id) {
  if (!id || typeof id !== 'string') return null;
  return INTEGRATION_GUIDES[id] ?? null;
}

/**
 * Escape plain text for safe HTML insertion.
 * @param {string} s
 */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render guide sections to HTML (text sections are pre-sanitized author HTML; code is escaped).
 * @param {IntegrationGuide} guide
 * @returns {string}
 */
export function renderIntegrationGuideHtml(guide) {
  const parts = [];
  for (const section of guide.sections) {
    if (section.type === 'text') {
      parts.push(`<p class="integ-guide-text">${section.html}</p>`);
      continue;
    }
    const label = section.label ? `<span class="integ-guide-code-label">${escapeHtml(section.label)}</span>` : '';
    parts.push(
      `<div class="integ-guide-code-block">${label}<pre><code>${escapeHtml(section.code)}</code></pre>` +
        `<button type="button" class="btn-secondary btn-copy-small integ-guide-copy" data-copy="${escapeHtml(section.code)}">Copy</button></div>`,
    );
  }
  if (guide.docUrl) {
    const label = guide.docLabel || 'Full documentation';
    parts.push(
      `<p class="integ-guide-doc"><a href="${escapeHtml(guide.docUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a></p>`,
    );
  }
  return parts.join('\n');
}

/**
 * Bind click handlers on integration tiles inside a root element.
 * @param {ParentNode} root
 * @param {{ onOpen: (guide: IntegrationGuide) => void }} handlers
 */
export function wireIntegrationTiles(root, handlers) {
  if (!root || !handlers || typeof handlers.onOpen !== 'function') return;
  const tiles = root.querySelectorAll('[data-integ-id]');
  for (const tile of tiles) {
    tile.addEventListener('click', () => {
      const id = tile.getAttribute('data-integ-id');
      const guide = id ? getIntegrationGuide(id) : null;
      if (guide) handlers.onOpen(guide);
    });
  }
}
