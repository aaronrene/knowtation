/**
 * Knowtation Hub UI — list, calendar, overview, quick add, presets. Phase 11C.
 */

(function () {
  const params = new URLSearchParams(location.search);
  // Build-time or deployment config: set window.HUB_API_BASE_URL (e.g. from config.js). Empty string = same origin (when static host proxies /api to the gateway).
  const apiBase = (function resolveApiBase() {
    if (typeof window === 'undefined') return 'http://localhost:3333';
    const paramApi = params.get('api');
    if (paramApi != null && String(paramApi).trim()) {
      return String(paramApi).trim().replace(/\/$/, '');
    }
    const hostname = location.hostname || '';
    const isLocalDev =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname === '::1';
    // Self-hosted dev: always call the same origin as the page (npm run hub). Stale localStorage
    // hub_api_url often points at a hosted gateway and causes HTML 404 for Node-only routes.
    if (isLocalDev) {
      return (location.origin || 'http://localhost:3333').replace(/\/$/, '');
    }
    if (Object.prototype.hasOwnProperty.call(window, 'HUB_API_BASE_URL')) {
      const v = window.HUB_API_BASE_URL;
      if (v == null) {
        return (
          localStorage.getItem('hub_api_url') ||
          location.origin ||
          'http://localhost:3333'
        ).replace(/\/$/, '');
      }
      const s = String(v).trim();
      if (s === '') return (location.origin || 'http://localhost:3333').replace(/\/$/, '');
      return s.replace(/\/$/, '');
    }
    return (localStorage.getItem('hub_api_url') || location.origin || 'http://localhost:3333').replace(/\/$/, '');
  })();
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  /** Used to defer onboarding until invite consume has run (see scheduleMaybeShowOnboardingWizard). */
  const pageLoadHadInviteQuery = Boolean(params.get('invite'));
  let token = hashParams.get('token') || params.get('token') || localStorage.getItem('hub_token');
  if (token) {
    localStorage.setItem('hub_token', token);
    if (hashParams.has('token')) {
      history.replaceState({}, '', location.pathname + location.search);
    } else if (params.has('token')) {
      const u = new URL(location.href);
      u.searchParams.delete('token');
      history.replaceState({}, '', u.toString());
    }
  }

  /** Latest GET /api/v1/settings used for Backup tab (hosted repo field + sync body). */
  let lastBackupSettingsPayload = null;

  const PRESETS_KEY = 'hub_view_presets';
  const el = (id) => document.getElementById(id);
  const app = el('app');
  const main = el('main');
  const loginRequired = el('login-required');
  const btnLoginGoogle = el('btn-login-google');
  const btnLoginGithub = el('btn-login-github');
  const btnLogout = el('btn-logout');
  const btnNewNote = el('btn-new-note');
  const btnImport = el('btn-import');
  const btnHeaderSuggested = el('btn-header-suggested');
  const btnHowToUse = el('btn-how-to-use');
  const btnSettings = el('btn-settings');
  const browseToolbar = el('browse-toolbar');
  const userName = el('user-name');
  const oauthNotConfigured = el('oauth-not-configured');
  const loginIntro = el('login-intro');
  const searchQuery = el('search-query');
  const filterProject = el('filter-project');
  const filterTag = el('filter-tag');
  const filterFolder = el('filter-folder');
  const filterSince = el('filter-since');
  const filterUntil = el('filter-until');
  const filterContentScope = el('filter-content-scope');
  const filterNetwork = el('filter-network');
  const filterWallet = el('filter-wallet');
  const searchMode = el('search-mode');
  const btnSearch = el('btn-search');
  const btnClearSearch = el('btn-clear-search');
  const btnApplyFilters = el('btn-apply-filters');
  const btnReindex = el('btn-reindex');
  const notesList = el('notes-list');
  const notesTotal = el('notes-total');
  /** True when the last unfiltered browse list (loadNotes, no list filters) returned zero notes. */
  let hubBrowseListEmptyUnfiltered = false;
  const filterChipsEl = el('filter-chips');
  const presetsListEl = el('presets-list');
  const presetNameInput = el('preset-name');
  const hubBetaNote = el('hub-beta-note');
  if (hubBetaNote && window.location.hostname !== 'knowtation.store' && window.location.hostname !== 'www.knowtation.store') hubBetaNote.classList.add('hidden');

  let providers = null;
  let calendarMonth = new Date();
  let currentNotePathForCopy = '';
  /** @type {{ path: string, body: string, frontmatter: Record<string, string> } | null} */
  let currentOpenNote = null;

  /** Hide the detail drawer (does not clear currentOpenNote). */
  function hideDetailPanelChrome() {
    const dp = el('detail-panel');
    if (dp) {
      dp.classList.add('hidden');
      dp.classList.remove('detail-panel-proposal-wide');
    }
  }

  /** User dismisses the drawer (Escape, Close): clear open-note state. */
  function closeDetailPanel() {
    currentOpenNote = null;
    hideDetailPanelChrome();
  }

  let listSelectedIndex = 0;
  /** @type {import('chart.js').Chart[]} */
  let chartInstances = [];

  const FILTER_CHIPS_EXPANDED_KEY = 'hub_filter_chips_expanded';
  let filterChipsExpanded = false;
  try {
    filterChipsExpanded = localStorage.getItem(FILTER_CHIPS_EXPANDED_KEY) === '1';
  } catch (_) {
    filterChipsExpanded = false;
  }

  const ACCENT_STORAGE_KEY = 'hub_accent_color';
  const THEME_STORAGE_KEY = 'hub_theme';
  const COLOR_PALETTE_STORAGE_KEY = 'hub_color_palette';
  const DEFAULT_ACCENT = '#89cff0';
  const DEFAULT_THEME = 'dark';
  const DEFAULT_COLOR_PALETTE = 'default';
  const VALID_COLOR_PALETTES = new Set([
    'default',
    'ocean',
    'forest',
    'sunset',
    'lavender',
    'ember',
    'arctic',
    'slate',
    'midnight',
    'sakura',
    'sand',
    'mint',
  ]);
  const loadingHtml = '<div class="loading-state" aria-live="polite">Loading…</div>';
  function applyAccent(hex) {
    if (hex) {
      document.documentElement.style.setProperty('--accent', hex);
      try {
        localStorage.setItem(ACCENT_STORAGE_KEY, hex);
      } catch (_) {}
    }
  }
  function applyTheme(theme) {
    const value = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', value === 'dark' ? '' : value);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch (_) {}
  }
  function applyColorPalette(id) {
    const p =
      id && VALID_COLOR_PALETTES.has(String(id)) ? String(id) : DEFAULT_COLOR_PALETTE;
    if (p === DEFAULT_COLOR_PALETTE) {
      document.documentElement.removeAttribute('data-palette');
    } else {
      document.documentElement.setAttribute('data-palette', p);
    }
    try {
      localStorage.setItem(COLOR_PALETTE_STORAGE_KEY, p);
    } catch (_) {}
  }
  function currentColorPalette() {
    const a = document.documentElement.getAttribute('data-palette');
    if (a && VALID_COLOR_PALETTES.has(a) && a !== DEFAULT_COLOR_PALETTE) return a;
    return DEFAULT_COLOR_PALETTE;
  }
  (function initThemeAndAccent() {
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme === 'light') applyTheme('light');
      const savedAccent = localStorage.getItem(ACCENT_STORAGE_KEY);
      if (savedAccent) applyAccent(savedAccent);
      const savedPalette = localStorage.getItem(COLOR_PALETTE_STORAGE_KEY);
      if (savedPalette) applyColorPalette(savedPalette);
    } catch (_) {}
  })();

  function headers() {
    const h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    const vid = getCurrentVaultId();
    if (vid) h['X-Vault-Id'] = vid;
    return h;
  }

  async function api(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    // GET/HEAD: retry up to 2×. POST/PATCH/DELETE: retry once only on pure network failures
    // (before any HTTP response), which means the server never received the request so retrying
    // is safe. Never retry on HTTP error responses (4xx/5xx) — those were received and processed.
    const maxNetworkRetries = (method === 'GET' || method === 'HEAD') ? 2 : 1;
    let res;
    let networkRetries = maxNetworkRetries;
    for (;;) {
      try {
        res = await fetch(apiBase + path, {
          ...opts,
          cache: opts.cache != null ? opts.cache : 'no-store',
          headers: { ...headers(), ...opts.headers },
        });
        break;
      } catch (e) {
        const m = e && e.message ? String(e.message) : String(e);
        if ((m === 'Failed to fetch' || m.includes('NetworkError')) && networkRetries > 0) {
          networkRetries--;
          await new Promise(resolve => setTimeout(resolve, (maxNetworkRetries - networkRetries) * 2000));
          continue;
        }
        if (m === 'Failed to fetch' || m.includes('NetworkError')) {
          throw new Error(
            'Could not reach the API (' +
              apiBase +
              '). Check gateway status, CORS (HUB_CORS_ORIGIN), ad blockers, and Netlify limits.',
          );
        }
        throw e instanceof Error ? e : new Error(m);
      }
    }
    if (res.status === 401) {
      token = null;
      localStorage.removeItem('hub_token');
      if (app) app.classList.add('login-screen');
      main.classList.add('hidden');
      loginRequired.classList.remove('hidden');
      browseToolbar.classList.add('hidden');
      btnNewNote.classList.add('hidden');
      if (btnImport) btnImport.classList.add('hidden');
      if (btnHeaderSuggested) btnHeaderSuggested.classList.add('hidden');
      if (btnHowToUse) btnHowToUse.classList.add('hidden');
      if (btnSettings) btnSettings.classList.add('hidden');
      showLoginChrome();
      throw new Error('Unauthorized');
    }
    let text = await res.text();
    if (text.length > 0 && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      const t = text.trim();
      if (/^<!DOCTYPE/i.test(t) || /<html/i.test(t)) {
        throw new Error(
          `Server returned a web page (${res.status}) instead of API JSON. Restart the Hub (\`npm run hub\`) after pulling. On localhost, the UI must use the same origin as Node Hub (not a hosted gateway); use \`?api=\` only if you intentionally point at another API base.`,
        );
      }
      throw new Error(
        'Response was not valid JSON (' +
          res.status +
          '). Start of body: ' +
          t.slice(0, 120) +
          (t.length > 120 ? '...' : ''),
      );
    }
    if (!res.ok) {
      const label = data?.error || res.statusText;
      const detail = data?.message != null && String(data.message).trim() ? String(data.message).trim() : '';
      const combined = detail ? `${label}: ${detail}` : label;
      const err = new Error(combined);
      if (data && data.code) err.code = data.code;
      throw err;
    }
    return data;
  }

  /** Busy state for buttons during slow API calls (clear feedback on hosted). */
  function setButtonBusy(btn, busy, labelWhenBusy) {
    if (!btn || btn.nodeType !== 1) return;
    const busyText = labelWhenBusy || 'Working…';
    if (busy) {
      if (btn.dataset.knowtationBtnRestLabel == null) {
        btn.dataset.knowtationBtnRestLabel = btn.textContent;
      }
      btn.textContent = busyText;
      btn.disabled = true;
      btn.classList.add('btn-busy');
      btn.setAttribute('aria-busy', 'true');
    } else {
      if (btn.dataset.knowtationBtnRestLabel != null) {
        btn.textContent = btn.dataset.knowtationBtnRestLabel;
        delete btn.dataset.knowtationBtnRestLabel;
      }
      btn.classList.remove('btn-busy');
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
    }
  }

  async function withButtonBusy(btn, labelWhenBusy, fn) {
    if (!btn) return fn();
    setButtonBusy(btn, true, labelWhenBusy);
    try {
      return await fn();
    } finally {
      setButtonBusy(btn, false);
    }
  }

  const HOSTED_BACKUP_REPO_LS = 'knowtation_hosted_backup_repo';
  /** If set, `resolveApiBase` uses this instead of `location.origin` — can point local Hub UI at Netlify by mistake. */
  const HUB_API_URL_LS = 'hub_api_url';

  const VAULT_ID_LS = 'hub_vault_id';
  /** @see `web/hub/hub-client-import-zip.mjs` — 4B sequential import cap. */
  const HUB_IMPORT_MAX_SEQUENTIAL = 200;
  const importFileEl = el('import-file');
  const importFileFolderEl = el('import-file-folder');
  const importFolderHintEl = el('import-folder-hint');
  const importBatchCancelBtn = el('import-batch-cancel');
  const importBatchAriaEl = el('import-batch-aria');
  /** @type {AbortController | null} */
  let importBatchAbort = null;
  const btnImportChooseFolder = el('btn-import-choose-folder');

  function setImportBatchAria(s) {
    if (importBatchAriaEl) importBatchAriaEl.textContent = s || '';
  }

  function normalizeUrlOrigin(base) {
    try {
      const s = String(base || '').trim().replace(/\/$/, '');
      if (!s) return '';
      const u = new URL(s.startsWith('http') ? s : 'https://' + s);
      return u.origin;
    } catch (_) {
      return '';
    }
  }

  function isLocalHubHostname() {
    const h = location.hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  }

  /** Local Hub tab but `apiBase` targets another origin (e.g. Netlify) — causes “Could not reach the API … knowtation-gateway…”. */
  function localApiBaseFootgunActive() {
    if (!isLocalHubHostname()) return false;
    const pageO = normalizeUrlOrigin(location.origin);
    const apiO = normalizeUrlOrigin(apiBase);
    if (!pageO || !apiO) return false;
    return pageO !== apiO;
  }

  function refreshApiBaseFootgunBanner() {
    const b = el('hub-api-base-footgun-banner');
    if (!b) return;
    if (!localApiBaseFootgunActive()) {
      b.classList.add('hidden');
      b.innerHTML = '';
      return;
    }
    let lsHint = false;
    try {
      lsHint = Boolean(localStorage.getItem(HUB_API_URL_LS));
    } catch (_) {}
    const qsHint = Boolean(params.get('api'));
    b.classList.remove('hidden');
    const hint =
      (lsHint ? ' <code>localStorage.' + HUB_API_URL_LS + '</code> is set.' : '') +
      (qsHint ? ' This URL has an <code>?api=</code> override.' : '');
    b.innerHTML =
      '<p><strong>Wrong API for this tab.</strong> This page is on <code>' +
      escapeHtml(location.origin) +
      '</code> but the Hub calls <code>' +
      escapeHtml(apiBase) +
      '</code> for requests (settings, backup, notes).' +
      hint +
      ' For self-hosted <code>npm run hub</code>, clear the override so the API matches this origin, then reload.</p>' +
      '<p><button type="button" class="btn-secondary" id="hub-api-footgun-clear">Clear API override &amp; reload</button></p>';
    const clearBtn = el('hub-api-footgun-clear');
    if (clearBtn) {
      clearBtn.onclick = () => {
        try {
          localStorage.removeItem(HUB_API_URL_LS);
        } catch (_) {}
        const u = new URL(location.href);
        u.searchParams.delete('api');
        window.location.href = u.toString();
      };
    }
  }

  function getCurrentVaultId() {
    try {
      return localStorage.getItem(VAULT_ID_LS) || 'default';
    } catch (_) {
      return 'default';
    }
  }

  function setCurrentVaultId(id) {
    try {
      localStorage.setItem(VAULT_ID_LS, id);
    } catch (_) {}
  }

  function updateVaultSwitcher(vaultList, allowedVaultIds) {
    const wrap = el('vault-switcher-wrap');
    const select = el('vault-switcher');
    if (!wrap || !select) return;
    const rows = Array.isArray(vaultList) ? vaultList : [];
    const byId = new Map(rows.map((v) => [String(v.id), v]));
    let allowed =
      Array.isArray(allowedVaultIds) && allowedVaultIds.length
        ? allowedVaultIds.map(String)
        : rows.length
          ? rows.map((v) => String(v.id))
          : ['default'];
    allowed = [...new Set(allowed)];
    const options = allowed.map((id) => {
      const v = byId.get(id);
      return { id, label: v && (v.label || v.id) ? String(v.label || v.id) : id };
    });
    select.innerHTML = options
      .map((v) => '<option value="' + escapeHtml(v.id) + '">' + escapeHtml(v.label) + '</option>')
      .join('');
    select.value = getCurrentVaultId();
    if (!allowed.includes(select.value)) select.value = allowed[0] || 'default';
    setCurrentVaultId(select.value);
    wrap.classList.toggle('hidden', options.length <= 1);
    if (allowed.length >= 2 && options.length === 1) {
      select.title =
        'This Hub has more vaults. To use them, copy your User ID from Settings → Backup into Vault access on Settings → Vaults, then save and refresh.';
    } else {
      select.title = '';
    }
    select.onchange = () => {
      setCurrentVaultId(select.value);
      loadFacets();
      loadNotes();
      loadProposals();
    };
  }

  function applyHostedUiFromSettings(s) {
    if (!s || typeof s !== 'object') return;
    const hosted = String(s.vault_path_display || '').toLowerCase() === 'canister';
    window.__hubIsHosted = hosted;
    const btn = el('btn-projects-help');
    if (btn) btn.classList.toggle('hidden', !hosted);
  }

  function normalizeGithubRepoSlug(raw) {
    let t = (raw || '').trim();
    if (!t) return '';
    t = t.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
    const parts = t.split('/').filter(Boolean);
    if (parts.length >= 2) return parts[0] + '/' + parts[1];
    return t;
  }

  /** Hosted (canister): any logged-in user may sync to their own GitHub; self-hosted still requires admin. */
  function settingsSyncDisabled(s, vg, isHosted) {
    const isAdmin = s.role === 'admin';
    const hostedGitBackup = isHosted && s.github_connect_available;
    if (hostedGitBackup) {
      const inputEl = el('settings-hosted-repo');
      const inputRepo = normalizeGithubRepoSlug(inputEl && inputEl.value);
      const slug = inputRepo || normalizeGithubRepoSlug(localStorage.getItem(HOSTED_BACKUP_REPO_LS)) || normalizeGithubRepoSlug(s.repo);
      return !s.github_connected || !slug;
    }
    return !vg.enabled || !vg.has_remote || !isAdmin;
  }

  /** After Connect GitHub, blob read-after-write can lag; retry settings until github_connected or timeout. */
  async function fetchSettingsForBackupModal() {
    const pendingRaw = sessionStorage.getItem('knowtation_github_connect_pending');
    const pendingTs = pendingRaw ? parseInt(pendingRaw, 10) : NaN;
    const pendingFresh = Number.isFinite(pendingTs) && Date.now() - pendingTs < 120000;
    if (!pendingFresh) {
      if (pendingRaw) sessionStorage.removeItem('knowtation_github_connect_pending');
      return api('/api/v1/settings');
    }
    let s;
    for (let attempt = 0; attempt < 8; attempt++) {
      s = await api('/api/v1/settings');
      if (s.github_connected || !s.github_connect_available) break;
      if (attempt < 7) await new Promise((r) => setTimeout(r, 600));
    }
    sessionStorage.removeItem('knowtation_github_connect_pending');
    return s;
  }

  /** Align with hub/server effectiveRole: viewer read-only; member maps to editor for writes. */
  function hubUserCanWriteNotes() {
    const r = window.__hubUserRole;
    return r === 'editor' || r === 'admin' || r === 'member';
  }

  /** Proposal Enrich (AI): evaluators may run it without note-write roles; editors/admins/members still qualify. */
  function hubUserMayEnrichProposal() {
    const r = window.__hubUserRole;
    return r === 'editor' || r === 'admin' || r === 'member' || r === 'evaluator';
  }

  function hubUserIsAdmin() {
    return window.__hubUserRole === 'admin';
  }

  /** Delete vault: self-hosted admins only; hosted matches “create vault” (writer + workspace owner when set). */
  function hubUserMayDeleteVault() {
    if (!hubUserCanWriteNotes()) return false;
    if (isHostedHubFromSettings()) {
      const ws = lastBackupSettingsPayload;
      const ownerId =
        ws && ws.workspace_owner_id != null && String(ws.workspace_owner_id).trim() !== ''
          ? String(ws.workspace_owner_id).trim()
          : '';
      const me = ws && ws.user_id != null ? String(ws.user_id) : '';
      if (ownerId && me && me !== ownerId) return false;
      return true;
    }
    return hubUserIsAdmin();
  }

  function populateSettingsDeleteVaultSelect(s) {
    const sel = el('settings-delete-vault-select');
    if (!sel) return;
    const vaultList = (s && Array.isArray(s.vault_list) && s.vault_list) || [];
    const allowedRaw = s && Array.isArray(s.allowed_vault_ids) ? s.allowed_vault_ids : null;
    const allowedSet = allowedRaw && allowedRaw.length > 0 ? new Set(allowedRaw.map(String)) : null;
    const opts = vaultList.filter((v) => {
      if (!v || v.id == null) return false;
      const id = String(v.id).trim();
      if (!id || id === 'default') return false;
      if (allowedSet && !allowedSet.has(id)) return false;
      return true;
    });
    sel.innerHTML =
      opts.length === 0
        ? '<option value="">(no extra vaults)</option>'
        : '<option value="">— Choose vault —</option>' +
          opts
            .map(
              (v) =>
                '<option value="' +
                escapeHtml(String(v.id)) +
                '">' +
                escapeHtml(String(v.label != null && v.label !== '' ? v.label : v.id)) +
                '</option>',
            )
            .join('');
  }

  function refreshVaultDeleteSubsection() {
    const wrap = el('settings-danger-zone-vault');
    if (!wrap) return;
    const s = lastBackupSettingsPayload;
    if (!s || !hubUserMayDeleteVault()) {
      wrap.classList.add('hidden');
      return;
    }
    populateSettingsDeleteVaultSelect(s);
    const vaultList = (s.vault_list) || [];
    const extra = vaultList.filter((v) => v && String(v.id).trim() && String(v.id).trim() !== 'default');
    if (extra.length === 0) {
      wrap.classList.add('hidden');
      return;
    }
    wrap.classList.remove('hidden');
  }

  function refreshDeleteProjectPanelVisibility() {
    const panel = el('settings-danger-zone-panel');
    if (panel) panel.classList.toggle('hidden', !hubUserCanWriteNotes());
    refreshVaultDeleteSubsection();
  }

  /** Apply GET /api/v1/settings payload to header vault switcher, hosted flag, and cached backup modal state. */
  function applySettingsPayloadToHubChrome(s) {
    if (!s || typeof s !== 'object') return;
    lastBackupSettingsPayload = s;
    if (s.role) window.__hubUserRole = String(s.role);
    refreshDeleteProjectPanelVisibility();
    refreshNewProposalTabVisibility();
    const allowed = (s.allowed_vault_ids || []).map(String);
    const current = String(getCurrentVaultId());
    if (allowed.length && !allowed.includes(current)) {
      setCurrentVaultId(allowed[0] || 'default');
    }
    updateVaultSwitcher(s.vault_list || [], s.allowed_vault_ids || []);
    applyHostedUiFromSettings(s);
    window.__hubProposalEnrich = Boolean(s.proposal_enrich_enabled);
    window.__hubProposalEvaluationRequired = Boolean(s.proposal_evaluation_required);
    window.__hubProposalReviewHints = Boolean(s.proposal_review_hints_enabled);
    window.__hubEvaluatorMayApprove = Boolean(s.hub_evaluator_may_approve);
    window.__hubProposalRubricItems = Array.isArray(s.proposal_rubric?.items) ? s.proposal_rubric.items : [];
    const metaSelf = el('settings-bulk-metadata-self-only');
    if (metaSelf) metaSelf.classList.remove('hidden');
    applyMuseBridgePanel(s);
  }

  /** Settings → Integrations: Muse thin bridge status + self-hosted admin URL field. */
  function applyMuseBridgePanel(s) {
    if (!s || typeof s !== 'object') return;
    const mb = s.muse_bridge;
    const statusEl = el('settings-muse-status');
    const envHint = el('settings-muse-env-hint');
    const input = el('settings-muse-url');
    const saveBtn = el('btn-settings-muse-save');
    const msg = el('settings-muse-msg');
    if (msg) {
      msg.textContent = '';
      msg.className = 'settings-msg';
    }
    if (!mb) {
      if (statusEl) statusEl.textContent = '—';
      if (input) {
        input.value = '';
        input.disabled = true;
      }
      if (saveBtn) saveBtn.classList.add('hidden');
      return;
    }
    const isHosted = String(s.vault_path_display || '').toLowerCase() === 'canister';
    const isAdmin = s.role === 'admin';
    if (statusEl) {
      statusEl.textContent =
        mb.enabled && mb.origin
          ? 'Server status: linked — ' + mb.origin
          : 'Server status: Muse link not configured for this Hub.';
    }
    if (envHint) {
      envHint.classList.toggle('hidden', !mb.env_override_active);
      envHint.textContent = mb.env_override_active
        ? 'This Hub process has MUSE_URL set in its environment; that value overrides config/local.yaml. Change or unset it on the server to edit the field below.'
        : '';
    }
    if (input) {
      input.value = mb.yaml_url_for_edit != null ? String(mb.yaml_url_for_edit) : '';
      const canEdit = !isHosted && isAdmin && mb.url_editable === true;
      input.disabled = !canEdit;
      input.title = canEdit
        ? ''
        : isHosted
          ? 'Knowtation Cloud: the Muse base URL is set by the operator, not here.'
          : !isAdmin
            ? 'Only admins can save the Muse URL.'
            : 'Unset MUSE_URL in the Hub environment to allow saving from Settings.';
    }
    if (saveBtn) {
      const show = !isHosted && isAdmin && mb.url_editable === true;
      saveBtn.classList.toggle('hidden', !show);
    }
  }

  function showLoginChrome() {
    btnLogout.classList.add('hidden');
    userName.textContent = '';
    if (!providers) return;
    if (providers.google) btnLoginGoogle.classList.remove('hidden');
    if (providers.github) btnLoginGithub.classList.remove('hidden');
    if (!providers.google && !providers.github) {
      oauthNotConfigured.classList.remove('hidden');
      if (loginIntro) loginIntro.classList.add('hidden');
    }
  }

  /** Onboarding wizard — logic module: ./onboarding-wizard.mjs */
  let onboardingModulePromise = null;
  function loadOnboardingModule() {
    if (!onboardingModulePromise) {
      onboardingModulePromise = import('./onboarding-wizard.mjs?v=20260424');
    }
    return onboardingModulePromise;
  }

  function getOnboardingUserKey() {
    if (!token) return '';
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return String(payload.sub || payload.email || 'unknown');
    } catch (_) {
      return 'unknown';
    }
  }

  /**
   * Choose the 9-step hosted wizard vs the short self-hosted wizard.
   * Canister vault from API = hosted. Production Hub hostname = hosted even if settings
   * have not hydrated yet (avoids showing disk-path steps on knowtation.store).
   */
  function wizardHostedFromContext(settingsPayload) {
    const s = settingsPayload !== undefined ? settingsPayload : lastBackupSettingsPayload;
    const vd = String(s && s.vault_path_display ? s.vault_path_display : '').toLowerCase();
    if (vd === 'canister') return true;
    try {
      const h = typeof location !== 'undefined' && location.hostname ? String(location.hostname).toLowerCase() : '';
      if (h === 'knowtation.store' || h === 'www.knowtation.store') return true;
    } catch (_) {}
    return false;
  }

  function persistOnboardingProgress(mod, partial) {
    const userKey = getOnboardingUserKey();
    const isHosted = wizardHostedFromContext();
    const hostingPath = isHosted ? 'hosted' : 'selfhosted';
    let st = mod.parseOnboardingState(localStorage.getItem(mod.ONBOARDING_LS_KEY));
    if (!st || st.userKey !== userKey || st.hostingPath !== hostingPath) {
      st = mod.createFreshState(userKey, hostingPath);
    }
    Object.assign(st, partial);
    localStorage.setItem(mod.ONBOARDING_LS_KEY, mod.serializeOnboardingState(st));
  }

  let onboardingWizardBindingsDone = false;
  let onboardingRenderStep = function () {};

  function closeOnboardingWizardResume() {
    const modal = el('modal-onboarding');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
  }

  function closeOnboardingWizardDismiss() {
    loadOnboardingModule()
      .then((mod) => {
        persistOnboardingProgress(mod, { status: 'dismissed', dismissedAt: Date.now() });
        updateEmptyVaultStripVisibility();
      })
      .catch(function () {});
    const modal = el('modal-onboarding');
    if (modal) modal.classList.add('hidden');
  }

  function bindOnboardingWizardOnce(mod) {
    if (onboardingWizardBindingsDone) return;
    onboardingWizardBindingsDone = true;
    const modal = el('modal-onboarding');
    const closeBtn = el('modal-onboarding-close');
    const backdrop = el('modal-onboarding-backdrop');
    const btnSkip = el('btn-onboarding-skip');
    const btnBack = el('btn-onboarding-back');
    const btnNext = el('btn-onboarding-next');
    const body = el('onboarding-step-body');
    const progress = el('onboarding-progress');
    const live = el('onboarding-live');
    const secondary = el('onboarding-secondary-actions');

    function handleSecondaryAction(id) {
      /* Keep onboarding open underneath: Settings / How to use / Projects stack on top (DOM order + z-index). Close the top modal to return to the guide. */
      if (id === 'projectsHelp') {
        openProjectsHelpModal();
        return;
      }
      if (id === 'howToKnowledge') {
        openHowToUse('knowledge-agents');
        return;
      }
      if (id === 'openSettingsBackup') {
        openSettings();
        return;
      }
      if (id === 'openSettingsIntegrations') {
        openSettingsIntegrationsTab();
        return;
      }
      if (id === 'howToSetup4') {
        openHowToUse('setup', 'how-to-step-selfhosted-index');
        return;
      }
      if (id === 'howToSetup3') {
        openHowToUse('setup', 'how-to-step-selfhosted-oauth');
        return;
      }
      if (id === 'openWhyTokenDoc') {
        window.open(
          'https://github.com/aaronrene/knowtation/blob/main/docs/TOKEN-SAVINGS.md',
          '_blank',
          'noopener,noreferrer',
        );
        return;
      }
      if (id === 'openImportModal') {
        closeOnboardingWizardResume();
        openImportModal();
        return;
      }
      if (id === 'openImportSourcesDoc') {
        window.open(
          'https://github.com/aaronrene/knowtation/blob/main/docs/IMPORT-SOURCES.md',
          '_blank',
          'noopener,noreferrer',
        );
        return;
      }
      if (id === 'openAgentDocProposals' || id === 'openAgentIntegrationDoc') {
        window.open(
          id === 'openAgentDocProposals'
            ? 'https://github.com/aaronrene/knowtation/blob/main/docs/AGENT-INTEGRATION.md#4-proposals-review-before-commit'
            : 'https://github.com/aaronrene/knowtation/blob/main/docs/AGENT-INTEGRATION.md',
          '_blank',
          'noopener,noreferrer',
        );
        return;
      }
      if (id === 'focusSuggestedTab') {
        closeOnboardingWizardResume();
        switchHubMainTab('suggested');
        return;
      }
    }

    onboardingRenderStep = function renderOnboardingStep() {
      const userKey = getOnboardingUserKey();
      const isHosted = wizardHostedFromContext();
      const hostingPath = isHosted ? 'hosted' : 'selfhosted';
      let st = mod.parseOnboardingState(localStorage.getItem(mod.ONBOARDING_LS_KEY));
      if (!st || st.userKey !== userKey || st.hostingPath !== hostingPath) {
        st = mod.createFreshState(userKey, hostingPath);
      }
      const total = mod.getStepCount(isHosted);
      const idx = Math.min(Math.max(0, st.stepIndex), total - 1);
      const content = mod.getStepContent(isHosted, idx);
      if (body) body.innerHTML = content ? content.bodyHtml : '';
      if (content && content.id === 'h-imports' && body) {
        const ta = body.querySelector('[data-onboarding-llm-prompt]');
        if (ta) ta.value = mod.LLM_SELF_HELP_EXPORT_PROMPT;
      }

      if (progress) {
        progress.innerHTML = '';
        for (let i = 0; i < total; i++) {
          const d = document.createElement('span');
          d.className = 'onboarding-dot' + (i === idx ? ' onboarding-dot-active' : '');
          d.title = 'Step ' + (i + 1) + ' of ' + total;
          progress.appendChild(d);
        }
      }
      if (live && content) live.textContent = content.title + ', step ' + (idx + 1) + ' of ' + total;

      if (btnBack) btnBack.disabled = idx <= 0;
      if (btnNext) btnNext.textContent = idx >= total - 1 ? 'Done' : 'Next';

      if (secondary) {
        secondary.innerHTML = '';
        mod.getStepSecondaryActions(isHosted, idx).forEach((a) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn-link btn-link-small';
          b.textContent = a.label;
          b.addEventListener('click', () => handleSecondaryAction(a.id));
          secondary.appendChild(b);
        });
      }
    };

    if (btnBack) {
      btnBack.addEventListener('click', () => {
        const st = mod.parseOnboardingState(localStorage.getItem(mod.ONBOARDING_LS_KEY));
        if (!st || st.status !== 'in_progress') return;
        persistOnboardingProgress(mod, { status: 'in_progress', stepIndex: Math.max(0, st.stepIndex - 1) });
        onboardingRenderStep();
      });
    }
    if (btnNext) {
      btnNext.addEventListener('click', () => {
        const userKey = getOnboardingUserKey();
        const isHosted = wizardHostedFromContext();
        const hostingPath = isHosted ? 'hosted' : 'selfhosted';
        let st = mod.parseOnboardingState(localStorage.getItem(mod.ONBOARDING_LS_KEY)) || mod.createFreshState(userKey, hostingPath);
        if (st.userKey !== userKey || st.hostingPath !== hostingPath) st = mod.createFreshState(userKey, hostingPath);
        const total = mod.getStepCount(isHosted);
        if (st.stepIndex >= total - 1) {
          persistOnboardingProgress(mod, { status: 'completed', completedAt: Date.now(), stepIndex: total - 1 });
          if (modal) modal.classList.add('hidden');
          return;
        }
        persistOnboardingProgress(mod, { status: 'in_progress', stepIndex: st.stepIndex + 1 });
        onboardingRenderStep();
      });
    }
    if (btnSkip) btnSkip.addEventListener('click', closeOnboardingWizardDismiss);
    if (closeBtn) closeBtn.addEventListener('click', closeOnboardingWizardResume);
    if (backdrop) backdrop.addEventListener('click', closeOnboardingWizardResume);

    modal.addEventListener('click', (ev) => {
      const copyBtn = ev.target && ev.target.closest && ev.target.closest('.onboarding-copy-llm-btn');
      if (!copyBtn || !body) return;
      const ta = body.querySelector('[data-onboarding-llm-prompt]');
      const txt = ta && ta.value ? String(ta.value) : '';
      if (!txt || !navigator.clipboard || !navigator.clipboard.writeText) return;
      ev.preventDefault();
      void navigator.clipboard.writeText(txt).then(() => {
        if (typeof showToast === 'function') showToast('Copied export helper prompt');
      });
    });
  }

  async function openOnboardingWizard(opts) {
    const restart = opts && opts.restart;
    const mod = await loadOnboardingModule();
    bindOnboardingWizardOnce(mod);
    const userKey = getOnboardingUserKey();
    const isHosted = wizardHostedFromContext();
    const hostingPath = isHosted ? 'hosted' : 'selfhosted';
    if (restart) {
      localStorage.setItem(mod.ONBOARDING_LS_KEY, mod.serializeOnboardingState(mod.createFreshState(userKey, hostingPath)));
    } else {
      let st = mod.parseOnboardingState(localStorage.getItem(mod.ONBOARDING_LS_KEY));
      if (!st || st.userKey !== userKey || st.hostingPath !== hostingPath) {
        localStorage.setItem(mod.ONBOARDING_LS_KEY, mod.serializeOnboardingState(mod.createFreshState(userKey, hostingPath)));
      }
    }
    const modal = el('modal-onboarding');
    if (modal) modal.classList.remove('hidden');
    onboardingRenderStep();
    const btnNext = el('btn-onboarding-next');
    if (btnNext) setTimeout(() => btnNext.focus(), 50);
  }

  async function scheduleMaybeShowOnboardingWizard(s) {
    if (!token) return;
    if (params.get('open') === 'billing') return;
    try {
      const mod = await loadOnboardingModule();
      const userKey = getOnboardingUserKey();
      const isHosted = wizardHostedFromContext(s);
      const hostingPath = isHosted ? 'hosted' : 'selfhosted';
      let st = mod.parseOnboardingState(localStorage.getItem(mod.ONBOARDING_LS_KEY));
      if (st && st.userKey !== userKey) st = null;
      if (st && st.hostingPath !== hostingPath) st = null;
      if (!mod.shouldAutoOpenWizard(st, userKey, hostingPath)) return;
      const delayMs = pageLoadHadInviteQuery ? 2200 : 0;
      setTimeout(() => {
        void openOnboardingWizard({ restart: false });
      }, delayMs);
    } catch (_) {}
  }

  function showMain() {
    if (app) app.classList.remove('login-screen');
    loginRequired.classList.add('hidden');
    main.classList.remove('hidden');
    btnHowToUse.classList.remove('hidden');
    if (btnSettings) btnSettings.classList.remove('hidden');
    browseToolbar.classList.remove('hidden');
    if (token) {
      btnLoginGoogle.classList.add('hidden');
      btnLoginGithub.classList.add('hidden');
      oauthNotConfigured.classList.add('hidden');
      btnLogout.classList.remove('hidden');
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        userName.textContent = payload.name || payload.sub || 'Logged in';
        window.__hubUserRole = payload.role || 'member';
        const isViewer = window.__hubUserRole === 'viewer';
        if (btnNewNote) btnNewNote.classList.toggle('hidden', isViewer);
        if (btnImport) btnImport.classList.toggle('hidden', isViewer);
        if (btnHeaderSuggested) btnHeaderSuggested.classList.remove('hidden');
        refreshDeleteProjectPanelVisibility();
      } catch (_) {
        userName.textContent = 'Logged in';
        window.__hubUserRole = 'member';
        if (btnNewNote) btnNewNote.classList.remove('hidden');
        if (btnImport) btnImport.classList.remove('hidden');
        if (btnHeaderSuggested) btnHeaderSuggested.classList.remove('hidden');
        refreshDeleteProjectPanelVisibility();
      }
    } else {
      if (btnNewNote) btnNewNote.classList.add('hidden');
      if (btnImport) btnImport.classList.add('hidden');
      if (btnHeaderSuggested) btnHeaderSuggested.classList.add('hidden');
    }
  }

  function loginUrl(provider) {
    const u = apiBase + '/api/v1/auth/login?provider=' + provider;
    const invite = params.get('invite');
    return invite ? u + '&invite=' + encodeURIComponent(invite) : u;
  }
  // Pre-warm the gateway Lambda before navigating to the OAuth URL.
  // Without this, a cold start (12-30 s) causes ERR_CONNECTION_CLOSED in the browser
  // because a direct window.location.href navigation has no retry mechanism.
  // We fire a cheap /api/v1/auth/providers fetch first; once it returns the Lambda is
  // guaranteed warm, and the OAuth redirect hits a hot instance.
  async function oauthNavigate(provider, btn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Connecting…';
    try {
      // Allow up to 22 s for the cold start; the button stays in "Connecting…" state
      // during this time so the user knows something is happening.
      await fetch(apiBase + '/api/v1/auth/providers', {
        cache: 'no-store',
        signal: AbortSignal.timeout(22000),
      });
    } catch (_) {
      // Fetch failed — navigate anyway; the Lambda may still be starting up and the
      // OAuth handler itself has the full 26 s budget once TCP is established.
    }
    window.location.href = loginUrl(provider);
    // Navigation is underway; restore button state in case the browser returns here.
    setTimeout(() => { btn.disabled = false; btn.textContent = original; }, 5000);
  }
  btnLoginGoogle.onclick = (e) => oauthNavigate('google', e.currentTarget);
  btnLoginGithub.onclick = (e) => oauthNavigate('github', e.currentTarget);

  btnLogout.onclick = () => {
    token = null;
    localStorage.removeItem('hub_token');
    if (app) app.classList.add('login-screen');
    main.classList.add('hidden');
    browseToolbar.classList.add('hidden');
    btnNewNote.classList.add('hidden');
    if (btnImport) btnImport.classList.add('hidden');
    if (btnHeaderSuggested) btnHeaderSuggested.classList.add('hidden');
    if (btnHowToUse) btnHowToUse.classList.add('hidden');
    if (btnSettings) btnSettings.classList.add('hidden');
    closeOnboardingWizardResume();
    loginRequired.classList.remove('hidden');
    if (loginIntro) loginIntro.classList.remove('hidden');
    showLoginChrome();
  };

  async function initProviders() {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(apiBase + '/api/v1/auth/providers', { cache: 'no-store' });
        if (!r.ok) throw new Error('providers');
        providers = await r.json();
        break;
      } catch (_) {
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 3000));
          continue;
        }
        providers = { google: false, github: false };
        oauthNotConfigured.classList.remove('hidden');
        if (loginIntro) loginIntro.classList.add('hidden');
        const first = oauthNotConfigured.querySelector('p');
        if (first) {
          const isHosted = location.origin !== 'http://localhost:3333' && location.origin !== 'http://127.0.0.1:3333';
          const sameOrigin = apiBase === location.origin || apiBase === location.origin + '/';
          if (isHosted && sameOrigin) {
            first.innerHTML =
              '<strong>Could not load OAuth status.</strong> The Hub at <code>' + escapeHtml(location.origin) +
              '</code> is calling itself for the API, but the API runs on the <strong>gateway</strong>. Set <code>window.HUB_API_BASE_URL</code> in <code>web/hub/config.js</code> to your gateway URL (e.g. <code>https://knowtation-gateway.netlify.app</code>), then commit and redeploy so 4Everland serves the updated config.';
          } else if (isHosted && !sameOrigin) {
            first.innerHTML =
              '<strong>Could not reach the gateway.</strong> Sign-in with Google or GitHub will appear once the gateway at <code>' + escapeHtml(apiBase) +
              '</code> is deployed and allows this site (check <strong>HUB_CORS_ORIGIN</strong> includes <code>' + escapeHtml(location.origin) + '</code>). If the gateway is still deploying on Netlify, wait a few minutes and refresh.';
          } else {
            first.innerHTML =
              '<strong>Could not load OAuth status.</strong> Is the Hub running at <code>' +
              escapeHtml(apiBase) +
              '</code>? Open this page from the same machine as <code>npm run hub</code> (e.g. <code>http://localhost:3333/</code>).';
          }
        }
        return;
      }
    }

    if (!providers.google && !providers.github) {
      oauthNotConfigured.classList.remove('hidden');
      if (loginIntro) loginIntro.classList.add('hidden');
    } else {
      oauthNotConfigured.classList.add('hidden');
      if (loginIntro) loginIntro.classList.remove('hidden');
      if (providers.google) btnLoginGoogle.classList.remove('hidden');
      if (providers.github) btnLoginGithub.classList.remove('hidden');
    }
  }

  if (token) {
    if (params.get('invite')) {
      (async () => {
        const inviteToken = params.get('invite');
        let lastErr;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await api('/api/v1/invites/consume', { method: 'POST', body: JSON.stringify({ token: inviteToken }) });
            const u = new URL(location.href);
            u.searchParams.delete('invite');
            u.searchParams.set('invite_accepted', '1');
            history.replaceState({}, '', u.toString());
            if (typeof showToast === 'function') showToast("You've been added. Your role is shown in Settings.");
            return;
          } catch (e) {
            lastErr = e;
            const code = e && e.code;
            const msg = String(e && e.message ? e.message : e || '');
            const staleInvite =
              code === 'NOT_FOUND' ||
              code === 'EXPIRED' ||
              /not found|already used|expired/i.test(msg);
            if (staleInvite) {
              const u = new URL(location.href);
              u.searchParams.delete('invite');
              history.replaceState({}, '', u.toString());
              if (code === 'EXPIRED' && typeof showToast === 'function') {
                showToast('This invite link has expired. Ask an admin for a new one if you need access.', true);
              }
              return;
            }
            if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
          }
        }
        if (typeof showToast === 'function') showToast(lastErr?.message || 'Invite could not be applied.', true);
      })();
    }
    showMain();
    getImageProxyToken().catch(function () {});
    (async function ensureVaultAndSwitcherThenLoad() {
      let settingsPayload = null;
      try {
        settingsPayload = await api('/api/v1/settings');
        applySettingsPayloadToHubChrome(settingsPayload);
      } catch (_) {}
      syncHubListSortUI('notes');
      setProposalFiltersBarVisible(false);
      refreshNewProposalTabVisibility();
      loadFacets();
      loadNotes();
      loadProposals();
      loadActivity();
      renderPresets();
      if (settingsPayload) void scheduleMaybeShowOnboardingWizard(settingsPayload);
    })();
    initProviders();
    if (params.get('open') === 'billing') {
      const checkoutSuccess = params.get('checkout') === 'success';
      // Clean up params before opening so back-button doesn't re-trigger.
      const u = new URL(location.href);
      u.searchParams.delete('open');
      u.searchParams.delete('checkout');
      history.replaceState({}, '', u.toString());
      // Small delay so the main Hub has rendered before the modal opens.
      setTimeout(() => {
        openSettingsBillingTab();
        if (checkoutSuccess && typeof showToast === 'function') {
          showToast('Subscription activated — welcome to your new plan!');
        }
      }, 400);
    }
    if (params.get('github_connected') === '1') {
      sessionStorage.setItem('knowtation_github_connect_pending', String(Date.now()));
      setTimeout(() => {
        if (typeof showToast === 'function') showToast('GitHub connected. Push will use the stored token.');
        const u = new URL(location.href);
        u.searchParams.delete('github_connected');
        history.replaceState({}, '', u.toString());
      }, 500);
    } else if (params.get('github_connect_error')) {
      setTimeout(() => {
        const code = params.get('github_connect_error');
        const msg =
          code === 'blob_storage'
            ? 'GitHub connect: could not save your token to storage. Check bridge Netlify logs or try again in a moment.'
            : 'GitHub connect: ' + code;
        if (typeof showToast === 'function') showToast(msg, true);
        const u = new URL(location.href);
        u.searchParams.delete('github_connect_error');
        history.replaceState({}, '', u.toString());
      }, 500);
    }
  } else {
    if (app) app.classList.add('login-screen');
    main.classList.add('hidden');
    loginRequired.classList.remove('hidden');
    btnNewNote.classList.add('hidden');
    if (btnImport) btnImport.classList.add('hidden');
    const inviteBanner = el('login-invite-banner');
    if (inviteBanner && params.get('invite')) {
      inviteBanner.textContent = "You've been invited. Sign in to join.";
      inviteBanner.classList.remove('hidden');
    }
    initProviders();
  }
  refreshApiBaseFootgunBanner();
  if (token && (params.get('invite_accepted') === '1' || hashParams.get('invite_accepted') === '1')) {
    setTimeout(() => {
      if (typeof showToast === 'function') showToast("You've been added. Your role is shown in Settings.");
      const u = new URL(location.href);
      u.searchParams.delete('invite_accepted');
      history.replaceState({}, '', u.pathname + u.search);
    }, 500);
  }

  function dateSlice(d) {
    if (!d || typeof d !== 'string') return '';
    return d.trim().slice(0, 10);
  }

  /** Hosted canister returns frontmatter as a JSON string; self-hosted often uses an object. List metadata (date, title, …) is flattened on self-hosted list responses — mirror that here. Keep in sync with lib/parse-frontmatter-json.mjs. */
  function materializeFrontmatter(fm) {
    if (fm == null) return {};
    if (typeof fm === 'object' && !Array.isArray(fm)) return fm;
    if (typeof fm === 'string') {
      let cur = fm.replace(/^\uFEFF/, '').trim();
      if (!cur) return {};
      for (let i = 0; i < 8; i++) {
        try {
          const o = JSON.parse(cur);
          if (o !== null && typeof o === 'object' && !Array.isArray(o)) return o;
          if (typeof o === 'string') {
            const next = o.trim();
            if (next === cur) return {};
            cur = next;
            continue;
          }
          return {};
        } catch {
          if (cur.length >= 2 && cur.charCodeAt(0) === 34) {
            try {
              const inner = JSON.parse(cur);
              if (typeof inner === 'string') {
                cur = inner.trim();
                continue;
              }
            } catch {
              /* fall through */
            }
          }
          return {};
        }
      }
      return {};
    }
    return {};
  }

  function tagsFromFrontmatter(fm) {
    const raw = fm && fm.tags;
    if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
    if (typeof raw === 'string' && raw.trim()) {
      return raw
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  }

  /** Local calendar YYYY-MM-DD (user's browser timezone) from epoch ms. */
  function isoDateLocalFromMs(ms) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + mo + '-' + day;
  }

  /**
   * Calendar bucket for Hub list/calendar/overview.
   * - Plain date `YYYY-MM-DD` (no time): use as-is (civil date from frontmatter).
   * - ISO datetimes: use the local calendar day so evening Pacific does not appear as "tomorrow" in UTC.
   */
  function calendarDisplayDayKey(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const ms = Date.parse(s);
    if (Number.isNaN(ms)) return s.slice(0, 10);
    return isoDateLocalFromMs(ms);
  }

  /** When frontmatter is empty, infer YYYY-MM-DD from `note-<epochMs>.md` quick-capture paths (hosted legacy rows). */
  function inferredDisplayDateFromNotePath(notePath) {
    if (!notePath || typeof notePath !== 'string') return null;
    const base = notePath.split('/').pop() || '';
    const m = /^note-(\d{10,})\.md$/i.exec(base);
    if (!m) return null;
    const ms = Number(m[1]);
    if (!Number.isFinite(ms)) return null;
    return isoDateLocalFromMs(ms);
  }

  /** YYYY-MM-DD for calendar, overview, and range filters when `date` is unset (hosted notes often only have knowtation_edited_at). */
  function listItemDisplayDate(n, fm) {
    if (n.date != null && String(n.date).trim()) return calendarDisplayDayKey(n.date) || String(n.date).trim().slice(0, 10);
    if (fm.date != null && String(fm.date).trim()) return calendarDisplayDayKey(fm.date) || String(fm.date).trim().slice(0, 10);
    const ke = fm.knowtation_edited_at ?? n.knowtation_edited_at;
    if (ke != null && String(ke).trim()) return calendarDisplayDayKey(ke) || String(ke).trim().slice(0, 10);
    const inferred = inferredDisplayDateFromNotePath(n.path);
    return inferred || null;
  }

  function noteSortOrCalendarDay(n) {
    const raw = n.date || n.updated || '';
    return calendarDisplayDayKey(raw) || dateSlice(raw);
  }

  const HUB_SORT_STORAGE_NOTES = 'hub_list_sort_notes';
  const HUB_SORT_STORAGE_PROPOSALS = 'hub_list_sort_proposals';
  const HUB_SORT_NOTES_OPTS = [
    { v: 'date_desc', l: 'Newest first' },
    { v: 'date_asc', l: 'Oldest first' },
    { v: 'year_desc', l: 'Year (newest first)' },
    { v: 'year_asc', l: 'Year (oldest first)' },
    { v: 'path_asc', l: 'Path A–Z' },
    { v: 'title_asc', l: 'Title A–Z' },
  ];
  const HUB_SORT_PROP_OPTS = [
    { v: 'updated_desc', l: 'Newest first' },
    { v: 'updated_asc', l: 'Oldest first' },
    { v: 'path_asc', l: 'Path A–Z' },
    { v: 'status_asc', l: 'Status A–Z' },
  ];

  function hubListSortGetSelect() {
    return el('hub-list-sort');
  }

  function syncHubListSortUI(activeTab) {
    const sel = hubListSortGetSelect();
    if (!sel) return;
    const isNotes = activeTab === 'notes';
    const opts = isNotes ? HUB_SORT_NOTES_OPTS : HUB_SORT_PROP_OPTS;
    const key = isNotes ? HUB_SORT_STORAGE_NOTES : HUB_SORT_STORAGE_PROPOSALS;
    let saved = '';
    try {
      saved = localStorage.getItem(key) || '';
    } catch (_) {}
    sel.innerHTML = opts.map((o) => '<option value="' + o.v + '">' + o.l + '</option>').join('');
    if (!saved || !opts.some((o) => o.v === saved)) saved = opts[0].v;
    sel.value = saved;
  }

  function setProposalFiltersBarVisible(show) {
    const bar = el('proposal-filters-bar');
    if (bar) bar.classList.toggle('hidden', !show);
  }

  function refreshNewProposalTabVisibility() {
    const btn = el('btn-new-proposal');
    if (!btn) return;
    const tab = document.querySelector('.tabs .tab.active')?.dataset?.tab;
    const show = tab === 'suggested' && hubUserCanWriteNotes();
    btn.classList.toggle('hidden', !show);
  }

  function applySortedNotesClient(notes) {
    const tab = document.querySelector('.tabs .tab.active')?.dataset?.tab;
    if (tab !== 'notes') return notes;
    const S = globalThis.HubListSort;
    const sel = hubListSortGetSelect();
    const mode = sel && sel.value ? sel.value : 'date_desc';
    if (!S || typeof S.sortNotesList !== 'function') return notes;
    return S.sortNotesList(notes, mode, noteSortOrCalendarDay);
  }

  function applySortedProposalsClient(list) {
    const S = globalThis.HubListSort;
    const sel = hubListSortGetSelect();
    const mode = sel && sel.value ? sel.value : 'updated_desc';
    if (!S || typeof S.sortProposalsList !== 'function') return list;
    return S.sortProposalsList(list, mode);
  }

  function normalizeHubListItem(n) {
    if (!n || typeof n !== 'object') return n;
    const fm = materializeFrontmatter(n.frontmatter);
    const tags = Array.isArray(n.tags) && n.tags.length ? n.tags.map(String) : tagsFromFrontmatter(fm);
    const displayDate = listItemDisplayDate(n, fm);
    const updated =
      n.updated != null
        ? String(n.updated)
        : fm.knowtation_edited_at != null
          ? String(fm.knowtation_edited_at)
          : null;
    return {
      ...n,
      frontmatter: fm,
      title: n.title != null ? n.title : fm.title != null ? String(fm.title) : null,
      project: n.project != null ? n.project : fm.project != null ? String(fm.project) : null,
      tags,
      date: displayDate,
      updated,
    };
  }

  function facetsAreEmpty(f) {
    if (!f || typeof f !== 'object') return true;
    const pl = f.projects && f.projects.length;
    const tl = f.tags && f.tags.length;
    const fl = f.folders && f.folders.length;
    return !pl && !tl && !fl;
  }

  async function deriveFacetsFromNotes() {
    const out = await api('/api/v1/notes?limit=500&offset=0');
    const projects = new Set();
    const tags = new Set();
    const folders = new Set();
    for (const raw of out.notes || []) {
      const n = normalizeHubListItem(raw);
      if (n.path) {
        const seg = String(n.path).split('/')[0];
        if (seg) folders.add(seg);
      }
      if (n.project) projects.add(String(n.project));
      (n.tags || []).forEach((t) => tags.add(String(t)));
    }
    return {
      projects: [...projects].sort((a, b) => a.localeCompare(b)),
      tags: [...tags].sort((a, b) => a.localeCompare(b)),
      folders: [...folders].sort((a, b) => a.localeCompare(b)),
    };
  }

  async function fetchFacetsResolved() {
    let facets = await api('/api/v1/notes/facets');
    if (facetsAreEmpty(facets)) facets = await deriveFacetsFromNotes();
    return facets;
  }

  function hubRowIsApprovalLog(n) {
    if (!n || !n.path) return false;
    const path = String(n.path).replace(/\\/g, '/');
    if (path === 'approvals' || path.startsWith('approvals/')) return true;
    const k =
      n.frontmatter && n.frontmatter.kind != null ? n.frontmatter.kind : n.kind != null ? n.kind : null;
    return String(k) === 'approval_log';
  }

  /** Hosted canister ignores list query filters; mirror lib/list-notes.mjs on the client after normalizeHubListItem. */
  function applyVaultListFilters(notes, opts) {
    let out = notes.slice();
    if (opts.folder) {
      const f = String(opts.folder).replace(/\\/g, '/').replace(/\/$/, '') || String(opts.folder);
      const prefix = f + '/';
      out = out.filter((n) => n.path === f || (n.path && String(n.path).startsWith(prefix)));
    }
    if (opts.project) {
      const p = normSlug(opts.project);
      out = out.filter(
        (n) =>
          normSlug(String(n.project || '')) === p || normSlug(String(n.frontmatter?.project || '')) === p,
      );
    }
    if (opts.tag) {
      const t = normSlug(opts.tag);
      out = out.filter((n) => (n.tags || []).some((x) => normSlug(String(x)) === t));
    }
    if (opts.since) {
      const s = dateSlice(opts.since);
      if (s) out = out.filter((n) => noteSortOrCalendarDay(n) >= s);
    }
    if (opts.until) {
      const u = dateSlice(opts.until);
      if (u) out = out.filter((n) => noteSortOrCalendarDay(n) <= u);
    }
    const cs = opts.content_scope;
    if (cs === 'notes') {
      out = out.filter((n) => !hubRowIsApprovalLog(n));
    } else if (cs === 'approval_logs') {
      out = out.filter((n) => hubRowIsApprovalLog(n));
    }
    // Phase 12 — blockchain filters (client-side safety net; gateway also filters on hosted)
    if (opts.network) {
      const net = String(opts.network).trim().toLowerCase();
      out = out.filter((n) => {
        const v = n.frontmatter?.network ?? n.network;
        return v != null && String(v).trim().toLowerCase() === net;
      });
    }
    if (opts.wallet_address) {
      const wa = String(opts.wallet_address).trim().toLowerCase();
      out = out.filter((n) => {
        const v = n.frontmatter?.wallet_address ?? n.wallet_address;
        return v != null && String(v).trim().toLowerCase() === wa;
      });
    }
    if (opts.payment_status) {
      const ps = String(opts.payment_status).trim().toLowerCase();
      out = out.filter((n) => {
        const v = n.frontmatter?.payment_status ?? n.payment_status;
        return v != null && String(v).trim().toLowerCase() === ps;
      });
    }
    return out;
  }

  /** Match lib/hub-provenance.mjs — strip before merge; server re-applies provenance on write. */
  const HUB_RESERVED_FM_KEYS = new Set([
    'knowtation_editor',
    'knowtation_edited_at',
    'author_kind',
    'knowtation_proposed_by',
    'knowtation_approved_by',
  ]);

  function stripReservedHubFm(fm) {
    const out = {};
    if (!fm || typeof fm !== 'object' || Array.isArray(fm)) return out;
    for (const [k, v] of Object.entries(fm)) {
      if (HUB_RESERVED_FM_KEYS.has(k)) continue;
      out[k] = v;
    }
    return out;
  }

  /**
   * ICP canister extractJsonString only saw `"frontmatter":"..."`; object-shaped frontmatter stored as `{}`.
   * Nesting frontmatter as a JSON string in the outer payload is always safe; gateway still merges provenance.
   */
  function stringifyNotePostPayload(path, body, frontmatter) {
    const fmStr =
      typeof frontmatter === 'string'
        ? frontmatter
        : JSON.stringify(frontmatter && typeof frontmatter === 'object' && !Array.isArray(frontmatter) ? frontmatter : {});
    return JSON.stringify({ path, body, frontmatter: fmStr });
  }

  const DETAIL_EDIT_FM_KEYS = [
    'title',
    'date',
    'project',
    'tags',
    'causal_chain_id',
    'entity',
    'episode_id',
    'follows',
  ];

  function mergedFrontmatterForDetailSave() {
    const base = stripReservedHubFm(materializeFrontmatter(currentOpenNote.frontmatter));
    const preserved = {};
    for (const [k, v] of Object.entries(base)) {
      if (!DETAIL_EDIT_FM_KEYS.includes(k)) preserved[k] = v;
    }
    const dateVal =
      el('detail-edit-date') && el('detail-edit-date').value ? el('detail-edit-date').value.trim() : ymd(new Date());
    const title = (el('detail-edit-title') && el('detail-edit-title').value) || '';
    const tTitle = title.trim();
    const project = ((el('detail-edit-project') && el('detail-edit-project').value) || '').trim();
    const tags = ((el('detail-edit-tags') && el('detail-edit-tags').value) || '').trim();
    const causalChain = el('detail-edit-causal-chain') && el('detail-edit-causal-chain').value.trim();
    const entityRaw = el('detail-edit-entity') && el('detail-edit-entity').value.trim();
    const entity = entityRaw ? entityRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const episode = el('detail-edit-episode') && el('detail-edit-episode').value.trim();
    const followsRaw = el('detail-edit-follows') && el('detail-edit-follows').value.trim();
    const follows = followsRaw
      ? followsRaw.includes(',')
        ? followsRaw.split(',').map((s) => s.trim()).filter(Boolean)
        : followsRaw
      : undefined;
    const out = { ...preserved, date: dateVal };
    if (tTitle) out.title = tTitle;
    else delete out.title;
    if (project) out.project = project;
    else delete out.project;
    if (tags) out.tags = tags;
    else delete out.tags;
    if (causalChain) out.causal_chain_id = causalChain;
    else delete out.causal_chain_id;
    if (entity.length) out.entity = entity;
    else delete out.entity;
    if (episode) out.episode_id = episode;
    else delete out.episode_id;
    if (follows) out.follows = follows;
    else delete out.follows;
    return out;
  }

  function fillDetailEditFieldsFromFrontmatter(fm) {
    const f = fm && typeof fm === 'object' && !Array.isArray(fm) ? fm : {};
    if (el('detail-edit-title')) el('detail-edit-title').value = f.title != null ? String(f.title) : '';
    if (el('detail-edit-body')) el('detail-edit-body').value = currentOpenNote.body || '';
    if (el('detail-edit-date')) el('detail-edit-date').value = f.date != null ? String(f.date).slice(0, 10) : '';
    if (el('detail-edit-project')) el('detail-edit-project').value = f.project != null ? String(f.project) : '';
    const tags = f.tags;
    const tagsStr = Array.isArray(tags) ? tags.join(', ') : tags != null ? String(tags) : '';
    if (el('detail-edit-tags')) el('detail-edit-tags').value = tagsStr;
    if (el('detail-edit-causal-chain')) el('detail-edit-causal-chain').value = f.causal_chain_id != null ? String(f.causal_chain_id) : '';
    const ent = f.entity;
    const entStr = Array.isArray(ent) ? ent.join(', ') : ent != null ? String(ent) : '';
    if (el('detail-edit-entity')) el('detail-edit-entity').value = entStr;
    if (el('detail-edit-episode')) el('detail-edit-episode').value = f.episode_id != null ? String(f.episode_id) : '';
    const fol = f.follows;
    const folStr = Array.isArray(fol) ? fol.join(', ') : fol != null ? String(fol) : '';
    if (el('detail-edit-follows')) el('detail-edit-follows').value = folStr;
  }

  async function loadFacets() {
    try {
      const savedProject = filterProject.value;
      const savedTag = filterTag.value;
      const savedFolder = filterFolder.value;
      const savedNetwork = filterNetwork ? filterNetwork.value : '';
      const savedWallet = filterWallet ? filterWallet.value : '';
      const facets = await fetchFacetsResolved();
      filterProject.innerHTML = '<option value="">All projects</option>' + (facets.projects || []).map((p) => '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>').join('');
      filterTag.innerHTML = '<option value="">All tags</option>' + (facets.tags || []).map((t) => '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>').join('');
      filterFolder.innerHTML = '<option value="">All folders</option>' + (facets.folders || []).map((f) => '<option value="' + escapeHtml(f) + '">' + escapeHtml(f) + '</option>').join('');
      if (facets.projects?.includes(savedProject)) filterProject.value = savedProject;
      if (facets.tags?.includes(savedTag)) filterTag.value = savedTag;
      if (facets.folders?.includes(savedFolder)) filterFolder.value = savedFolder;
      // Phase 12 — blockchain filter dropdowns (hidden when no data)
      if (filterNetwork) {
        const nets = facets.networks || [];
        filterNetwork.innerHTML = '<option value="">All networks</option>' + nets.map((n) => '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + '</option>').join('');
        filterNetwork.classList.toggle('hidden', nets.length === 0);
        if (nets.includes(savedNetwork)) filterNetwork.value = savedNetwork;
      }
      if (filterWallet) {
        const wallets = facets.wallets || [];
        filterWallet.innerHTML = '<option value="">All wallets</option>' + wallets.map((w) => '<option value="' + escapeHtml(w) + '">' + escapeHtml(w) + '</option>').join('');
        filterWallet.classList.toggle('hidden', wallets.length === 0);
        if (wallets.includes(savedWallet)) filterWallet.value = savedWallet;
      }
      renderFilterChips(facets);
    } catch (_) {
      renderFilterChips(null);
    }
  }

  function normSlug(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /** True when any list filter used by loadNotes / Quick chips is set. */
  function listFacetFiltersActive() {
    if (filterProject.value) return true;
    if (filterTag.value) return true;
    if (filterFolder.value) return true;
    if (filterNetwork && filterNetwork.value) return true;
    if (filterWallet && filterWallet.value) return true;
    const fps = el('filter-payment-status');
    if (fps && fps.value) return true;
    if (filterSince && filterSince.value) return true;
    if (filterUntil && filterUntil.value) return true;
    if (filterContentScope && filterContentScope.value) return true;
    return false;
  }

  function clearListFacetFilters() {
    filterProject.value = '';
    filterTag.value = '';
    filterFolder.value = '';
    if (filterNetwork) filterNetwork.value = '';
    if (filterWallet) filterWallet.value = '';
    const fps = el('filter-payment-status');
    if (fps) fps.value = '';
    if (filterSince) filterSince.value = '';
    if (filterUntil) filterUntil.value = '';
    if (filterContentScope) filterContentScope.value = '';
  }

  function renderFilterChips(facets) {
    filterChipsEl.innerHTML = '';
    filterChipsEl.classList.toggle('is-expanded', filterChipsExpanded);

    const header = document.createElement('div');
    header.className = 'filter-chips-header';

    const label = document.createElement('span');
    label.className = 'toolbar-label';
    label.textContent = 'Quick';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'filter-chips-toggle';
    toggle.setAttribute('aria-expanded', filterChipsExpanded ? 'true' : 'false');
    toggle.setAttribute('aria-controls', 'filter-chips-panel');
    toggle.title = filterChipsExpanded ? 'Hide quick filter chips' : 'Show quick filter chips';
    toggle.setAttribute(
      'aria-label',
      filterChipsExpanded ? 'Collapse quick filter chips' : 'Expand quick filter chips',
    );
    toggle.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"></polyline></svg>';
    toggle.onclick = () => {
      filterChipsExpanded = !filterChipsExpanded;
      try {
        localStorage.setItem(FILTER_CHIPS_EXPANDED_KEY, filterChipsExpanded ? '1' : '0');
      } catch (_) {}
      filterChipsEl.classList.toggle('is-expanded', filterChipsExpanded);
      toggle.setAttribute('aria-expanded', filterChipsExpanded ? 'true' : 'false');
      toggle.title = filterChipsExpanded ? 'Hide quick filter chips' : 'Show quick filter chips';
      toggle.setAttribute(
        'aria-label',
        filterChipsExpanded ? 'Collapse quick filter chips' : 'Expand quick filter chips',
      );
    };

    header.appendChild(label);
    header.appendChild(toggle);
    filterChipsEl.appendChild(header);

    const panel = document.createElement('div');
    panel.id = 'filter-chips-panel';
    panel.className = 'filter-chips-panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Quick filter chips');
    filterChipsEl.appendChild(panel);

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'chip-btn chip-all' + (listFacetFiltersActive() ? '' : ' active');
    allBtn.textContent = 'All';
    allBtn.title =
      'Show all notes: clear project, tag, folder, dates, content scope, and blockchain list filters';
    allBtn.onclick = () => {
      searchQuery.value = '';
      clearListFacetFilters();
      switchNotesView('list');
      loadNotes();
      renderFilterChips(null);
    };
    panel.appendChild(allBtn);

    const apply = (f) => {
      if (!f) return;
      (f.projects || []).slice(0, 12).forEach((p) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip-btn' + (filterProject.value === p ? ' active' : '');
        b.textContent = 'project:' + p;
        b.onclick = () => {
          searchQuery.value = '';
          filterProject.value = p;
          filterTag.value = '';
          filterFolder.value = '';
          switchNotesView('list');
          loadNotes();
          renderFilterChips(null);
        };
        panel.appendChild(b);
      });
      (f.tags || []).slice(0, 10).forEach((t) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip-btn' + (filterTag.value === t ? ' active' : '');
        b.textContent = 'tag:' + t;
        b.onclick = () => {
          searchQuery.value = '';
          filterTag.value = t;
          filterProject.value = '';
          filterFolder.value = '';
          switchNotesView('list');
          loadNotes();
          renderFilterChips(null);
        };
        panel.appendChild(b);
      });
      (f.folders || []).slice(0, 12).forEach((folder) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip-btn' + (filterFolder.value === folder ? ' active' : '');
        b.textContent = 'folder:' + folder;
        b.onclick = () => {
          searchQuery.value = '';
          filterFolder.value = folder;
          filterProject.value = '';
          filterTag.value = '';
          switchNotesView('list');
          loadNotes();
          renderFilterChips(null);
        };
        panel.appendChild(b);
      });
      // Phase 12 — network chips
      (f.networks || []).slice(0, 8).forEach((net) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip-btn chip-blockchain' + (filterNetwork && filterNetwork.value === net ? ' active' : '');
        b.textContent = 'net:' + net;
        b.onclick = () => {
          searchQuery.value = '';
          if (filterNetwork) filterNetwork.value = net;
          switchNotesView('list');
          loadNotes();
          renderFilterChips(null);
        };
        panel.appendChild(b);
      });
      // Phase 12 — payment_status Quick chips (fixed enum, shown when vault has any blockchain notes)
      if ((f.networks || []).length > 0 || (f.wallets || []).length > 0) {
        const payStatuses = ['pending', 'settled', 'failed'];
        payStatuses.forEach((ps) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'chip-btn chip-blockchain';
          b.textContent = 'status:' + ps;
          b.onclick = () => {
            searchQuery.value = '';
            const fpsEl = el('filter-payment-status');
            if (fpsEl) fpsEl.value = ps;
            switchNotesView('list');
            loadNotes();
            renderFilterChips(null);
          };
          panel.appendChild(b);
        });
      }
    };
    if (facets) apply(facets);
    else fetchFacetsResolved().then(apply).catch(() => {});
  }

  function getPresets() {
    try {
      const raw = localStorage.getItem(PRESETS_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  function savePreset() {
    const name = (presetNameInput.value || '').trim();
    if (!name) return;
    const presets = getPresets().filter((p) => p.name !== name);
    presets.push({
      name,
      project: filterProject.value,
      tag: filterTag.value,
      folder: filterFolder.value,
      since: filterSince?.value || '',
      until: filterUntil?.value || '',
      content_scope: filterContentScope && filterContentScope.value ? filterContentScope.value : '',
    });
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets.slice(-20)));
    presetNameInput.value = '';
    renderPresets();
  }

  function renderPresets() {
    presetsListEl.innerHTML = '';
    getPresets().forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset-pill';
      b.textContent = p.name;
      b.title = [p.folder && 'folder:' + p.folder, p.project && 'project:' + p.project, p.tag && 'tag:' + p.tag, p.since && 'since:' + p.since, p.until && 'until:' + p.until, p.content_scope && 'content:' + p.content_scope].filter(Boolean).join(' ');
      b.onclick = () => {
        filterProject.value = p.project || '';
        filterTag.value = p.tag || '';
        filterFolder.value = p.folder || '';
        if (filterSince) filterSince.value = p.since || '';
        if (filterUntil) filterUntil.value = p.until || '';
        if (filterContentScope) filterContentScope.value = p.content_scope || '';
        switchNotesView('list');
        loadNotes();
        renderFilterChips(null);
      };
      presetsListEl.appendChild(b);
    });
  }

  el('btn-save-preset').onclick = savePreset;

  function renderNoteRow(n) {
    const title = n.title || n.path;
    const isLog = hubRowIsApprovalLog(n);
    const chips = [];
    if (n.project) chips.push('<span class="chip chip-project">' + escapeHtml(n.project) + '</span>');
    (n.tags || []).slice(0, 3).forEach((t) => chips.push('<span class="chip chip-tag">' + escapeHtml(t) + '</span>'));
    const meta = [n.date].filter(Boolean).join(' · ');
    const badge = isLog ? '<span class="badge-approval-log">Approval log</span>' : '';
    const rowClass = 'list-item' + (isLog ? ' row-approval-log' : '');
    return (
      '<div class="' +
      rowClass +
      '" data-path="' +
      escapeHtml(n.path) +
      '"><span class="row-title">' +
      escapeHtml(title) +
      badge +
      '</span><div class="row-chips">' +
      chips.join('') +
      '</div>' +
      (meta ? '<div class="status">' + escapeHtml(meta) + '</div>' : '') +
      '<button class="list-item-delete" title="Delete note" aria-label="Delete note">✕</button>' +
      '</div>'
    );
  }

  function bindNoteClicks(container) {
    container.querySelectorAll('.list-item').forEach((item) => {
      item.onclick = () => openNote(item.dataset.path);
      const delBtn = item.querySelector('.list-item-delete');
      if (delBtn) {
        delBtn.onclick = async (e) => {
          e.stopPropagation();
          const path = item.dataset.path;
          if (!path) return;
          if (!confirm('Permanently delete "' + path + '"?\nThis cannot be undone.')) return;
          try {
            await api('/api/v1/notes/' + encodeURIComponent(path), { method: 'DELETE' });
            if (typeof showToast === 'function') showToast('Deleted: ' + path);
            if (currentOpenNote && currentOpenNote.path === path) {
              currentOpenNote = null;
              hideDetailPanelChrome();
            }
            loadNotes();
            loadFacets();
          } catch (err) {
            if (typeof showToast === 'function') showToast('Delete failed: ' + (err.message || err), true);
          }
        };
      }
    });
  }

  function hasActiveNoteListFilters() {
    if (filterProject && filterProject.value) return true;
    if (filterTag && filterTag.value) return true;
    if (filterFolder && filterFolder.value) return true;
    if (filterSince && filterSince.value) return true;
    if (filterUntil && filterUntil.value) return true;
    if (filterContentScope && filterContentScope.value) return true;
    if (filterNetwork && filterNetwork.value) return true;
    if (filterWallet && filterWallet.value) return true;
    const paymentStatusEl = el('filter-payment-status');
    if (paymentStatusEl && paymentStatusEl.value) return true;
    return false;
  }

  function readOnboardingDismissedSync() {
    try {
      const raw = localStorage.getItem('knowtation_onboarding_v1');
      if (!raw) return false;
      const o = JSON.parse(raw);
      return Boolean(o && o.v === 1 && o.status === 'dismissed');
    } catch (_) {
      return false;
    }
  }

  function isSearchResultsView() {
    const t = notesTotal && notesTotal.textContent ? String(notesTotal.textContent) : '';
    return /\b(keyword|semantic)\b/i.test(t) && /result/i.test(t);
  }

  function updateEmptyVaultStripVisibility() {
    const strip = el('hub-empty-vault-strip');
    if (!strip) return;
    const mainVisible = main && !main.classList.contains('hidden');
    const notesTab = document.querySelector('.tabs .tab.active')?.dataset?.tab === 'notes';
    const q = searchQuery && String(searchQuery.value).trim();
    const show =
      Boolean(mainVisible && token) &&
      readOnboardingDismissedSync() &&
      hubBrowseListEmptyUnfiltered &&
      notesTab &&
      !q &&
      !isSearchResultsView();
    strip.classList.toggle('hidden', !show);
  }

  async function loadNotes() {
    const q = new URLSearchParams();
    q.set('limit', '100');
    if (filterFolder.value) q.set('folder', filterFolder.value);
    if (filterProject.value) q.set('project', filterProject.value);
    if (filterTag.value) q.set('tag', filterTag.value);
    if (filterSince && filterSince.value) q.set('since', filterSince.value);
    if (filterUntil && filterUntil.value) q.set('until', filterUntil.value);
    if (filterContentScope && filterContentScope.value) q.set('content_scope', filterContentScope.value);
    // Phase 12 — blockchain filters
    const networkVal = filterNetwork ? filterNetwork.value : '';
    const walletVal = filterWallet ? filterWallet.value : '';
    const paymentStatusVal = el('filter-payment-status') ? el('filter-payment-status').value : '';
    if (networkVal) q.set('network', networkVal);
    if (walletVal) q.set('wallet_address', walletVal);
    if (paymentStatusVal) q.set('payment_status', paymentStatusVal);
    notesList.innerHTML = loadingHtml;
    notesTotal.textContent = '';
    try {
      const out = await api('/api/v1/notes?' + q.toString());
      let notes = (out.notes || []).map(normalizeHubListItem);
      notes = applyVaultListFilters(notes, {
        folder: filterFolder.value,
        project: filterProject.value,
        tag: filterTag.value,
        since: filterSince?.value || '',
        until: filterUntil?.value || '',
        content_scope: filterContentScope && filterContentScope.value ? filterContentScope.value : '',
        network: networkVal,
        wallet_address: walletVal,
        payment_status: paymentStatusVal,
      });
      notes = applySortedNotesClient(notes);
      const totalCount = notes.length;
      notes = notes.slice(0, 100);
      if (notes.length === 0) {
        notesList.innerHTML =
          '<div class="empty-state">No notes for this filter. <a id="empty-add">Add a note</a> or clear filters.</div>';
        const ea = el('empty-add');
        if (ea) ea.onclick = () => openCreateModal();
        notesTotal.textContent = 'Total: 0';
      } else {
        notesList.innerHTML = notes.map(renderNoteRow).join('');
        notesTotal.textContent = 'Total: ' + totalCount;
        bindNoteClicks(notesList);
        listSelectedIndex = 0;
        updateListSelection();
      }
      hubBrowseListEmptyUnfiltered = totalCount === 0 && !hasActiveNoteListFilters();
      updateEmptyVaultStripVisibility();
    } catch (e) {
      notesList.innerHTML = '<p class="muted">' + escapeHtml(e.message) + '</p>';
      notesTotal.textContent = '';
      hubBrowseListEmptyUnfiltered = false;
      updateEmptyVaultStripVisibility();
    }
  }

  function switchHubMainTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    const tab = document.querySelector('[data-tab="' + name + '"]');
    if (tab) tab.classList.add('active');
    syncHubListSortUI(name);
    setProposalFiltersBarVisible(
      name === 'activity' || name === 'suggested' || name === 'problem',
    );
    refreshNewProposalTabVisibility();
    const panel = el(
      'tab-' +
        (name === 'notes'
          ? 'notes'
          : name === 'activity'
            ? 'activity'
            : name === 'suggested'
              ? 'suggested'
              : 'problem'),
    );
    if (panel) panel.classList.remove('hidden');
    if (name === 'notes') {
      loadNotes();
    } else {
      if (name === 'activity') loadActivity();
      if (name === 'suggested' || name === 'problem') loadProposals();
      updateEmptyVaultStripVisibility();
    }
  }

  function updateListSelection() {
    const container = notesList;
    const items = container.querySelectorAll('.list-item');
    if (items.length === 0) { listSelectedIndex = 0; return; }
    listSelectedIndex = Math.max(0, Math.min(listSelectedIndex, items.length - 1));
    items.forEach((item, i) => item.classList.toggle('selected', i === listSelectedIndex));
    const sel = items[listSelectedIndex];
    if (sel) sel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  btnApplyFilters.onclick = () => {
    switchNotesView('list');
    loadNotes();
    renderFilterChips(null);
  };

  if (filterContentScope) {
    filterContentScope.addEventListener('change', () => {
      switchNotesView('list');
      loadNotes();
      renderFilterChips(null);
    });
  }

  function formatSearchScopeSummary() {
    const parts = [];
    if (filterProject.value) parts.push('project: ' + filterProject.value);
    if (filterTag.value) parts.push('tag: ' + filterTag.value);
    if (filterFolder.value) parts.push('folder: ' + filterFolder.value);
    if (filterSince && filterSince.value) parts.push('since ' + filterSince.value);
    if (filterUntil && filterUntil.value) parts.push('until ' + filterUntil.value);
    if (filterContentScope && filterContentScope.value === 'notes') parts.push('notes only');
    if (filterContentScope && filterContentScope.value === 'approval_logs') parts.push('approval logs only');
    return parts.length ? parts.join(' · ') : '';
  }

  function semanticMatchStrengthLabel(score) {
    if (score == null || typeof score !== 'number' || Number.isNaN(score)) return '';
    const pct = Math.round(Math.min(1, Math.max(0, score)) * 100);
    return 'Match strength ~' + pct + '% (higher = closer in meaning)';
  }

  function keywordMatchStrengthLabel(score) {
    if (score == null || typeof score !== 'number' || Number.isNaN(score)) return '';
    const pct = Math.round(Math.min(1, Math.max(0, score)) * 100);
    return 'Keyword match ~' + pct + '% (text overlap)';
  }

  if (btnClearSearch) {
    btnClearSearch.onclick = () => {
      searchQuery.value = '';
      clearListFacetFilters();
      switchNotesView('list');
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
      const notesTab = document.querySelector('[data-tab="notes"]');
      if (notesTab) notesTab.classList.add('active');
      const tabNotes = el('tab-notes');
      if (tabNotes) tabNotes.classList.remove('hidden');
      loadNotes();
      renderFilterChips(null);
    };
  }

  function showToast(message, isError = false) {
    const toast = document.createElement('div');
    toast.className = 'toast' + (isError ? ' toast-err' : '');
    toast.textContent = message;
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-show'));
    setTimeout(() => {
      toast.classList.remove('toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  const proposalFilterApply = el('proposal-filter-apply');
  if (proposalFilterApply) {
    proposalFilterApply.onclick = () => {
      loadProposals();
      loadActivity();
    };
  }
  const proposalFilterClear = el('proposal-filter-clear');
  if (proposalFilterClear) {
    proposalFilterClear.onclick = () => {
      const lf = el('proposal-filter-label');
      const sf = el('proposal-filter-source');
      const pf = el('proposal-filter-path-prefix');
      const pe = el('proposal-filter-pending-eval');
      const rq = el('proposal-filter-review-queue');
      const rs = el('proposal-filter-review-severity');
      if (lf) lf.value = '';
      if (sf) sf.value = '';
      if (pf) pf.value = '';
      if (pe) pe.checked = false;
      if (rq) rq.value = '';
      if (rs) rs.value = '';
      loadProposals();
      loadActivity();
    };
  }

  const hubListSortEl = hubListSortGetSelect();
  if (hubListSortEl) {
    hubListSortEl.addEventListener('change', () => {
      const tab = document.querySelector('.tabs .tab.active')?.dataset?.tab;
      try {
        if (tab === 'notes') localStorage.setItem(HUB_SORT_STORAGE_NOTES, hubListSortEl.value);
        else if (tab === 'activity' || tab === 'suggested' || tab === 'problem') {
          localStorage.setItem(HUB_SORT_STORAGE_PROPOSALS, hubListSortEl.value);
        }
      } catch (_) {}
      if (tab === 'notes') loadNotes();
      else if (tab === 'activity') loadActivity();
      else if (tab === 'suggested' || tab === 'problem') loadProposals();
    });
  }

  if (btnReindex) {
    btnReindex.onclick = async () => {
      await withButtonBusy(btnReindex, 'Indexing…', async () => {
        try {
          const out = await api('/api/v1/index', { method: 'POST' });
          const n = out.notesProcessed ?? 0;
          const c = out.chunksIndexed ?? 0;
          showToast('Indexed ' + n + ' notes, ' + c + ' chunks.');
          loadFacets();
          loadNotes();
        } catch (e) {
          showToast(e.message || 'Re-index failed', true);
        }
      });
    };
  }

  function proposalFilterQuerySuffix() {
    const params = [];
    const lab = el('proposal-filter-label');
    const src = el('proposal-filter-source');
    const pre = el('proposal-filter-path-prefix');
    if (lab && lab.value.trim()) params.push('label=' + encodeURIComponent(lab.value.trim()));
    if (src && src.value.trim()) params.push('source=' + encodeURIComponent(src.value.trim()));
    if (pre && pre.value.trim()) params.push('path_prefix=' + encodeURIComponent(pre.value.trim()));
    const pe = el('proposal-filter-pending-eval');
    if (pe && pe.checked) params.push('evaluation_status=pending');
    const rq = el('proposal-filter-review-queue');
    if (rq && rq.value.trim()) params.push('review_queue=' + encodeURIComponent(rq.value.trim()));
    const rs = el('proposal-filter-review-severity');
    if (rs && rs.value.trim()) params.push('review_severity=' + encodeURIComponent(rs.value.trim()));
    return params.length ? '&' + params.join('&') : '';
  }

  // Discard a proposal directly from the list without opening the detail panel.
  async function discardProposalInline(id, itemEl) {
    if (!confirm('Discard this proposal?\nThis cannot be undone.')) return;
    try {
      await api('/api/v1/proposals/' + encodeURIComponent(id) + '/discard', { method: 'POST' });
      if (typeof showToast === 'function') showToast('Proposal discarded.');
      const panel = el('detail-panel');
      if (panel && !panel.classList.contains('hidden')) {
        hideDetailPanelChrome();
      }
      loadProposals();
      loadActivity();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Discard failed: ' + (err.message || err), true);
    }
  }

  async function loadProposals() {
    const emptySuggested =
      '<div class="empty-state empty-state-suggested">' +
      '<p><strong>No proposals waiting for review.</strong> Agents and the CLI queue edits here; nothing applies to your live vault until you approve.</p>' +
      '<p>Use <strong>New proposal</strong> or open a note and choose <strong>Propose change</strong>, or have an agent or the CLI create one.</p>' +
      '<p class="empty-state-suggested-actions"><button type="button" class="btn-secondary" id="empty-suggested-how-to">How proposals work</button></p>' +
      '</div>';
    const emptyDiscarded = '<div class="empty-state">No discarded proposals.</div>';
    const fq = proposalFilterQuerySuffix();
    [
      { kind: 'suggested', status: 'proposed', empty: emptySuggested },
      { kind: 'problem', status: 'discarded', empty: emptyDiscarded },
    ].forEach(({ kind, status, empty: emptyHtml }) => {
      const container = el('proposals-' + kind);
      if (!container) return;
      container.innerHTML = loadingHtml;
      api('/api/v1/proposals?status=' + encodeURIComponent(status) + '&limit=100' + fq)
        .then((out) => {
          let list = out.proposals || [];
          list = applySortedProposalsClient(list);
          if (list.length === 0) {
            container.innerHTML = emptyHtml;
            if (kind === 'suggested') {
              const how = container.querySelector('#empty-suggested-how-to');
              if (how) how.onclick = () => openHowToUse('knowledge-agents');
            }
            return;
          }
          const canDiscard = kind === 'suggested' && hubUserCanWriteNotes();
          container.innerHTML = list
            .map((p) => {
              const labelChips = (Array.isArray(p.labels) ? p.labels : [])
                .slice(0, 4)
                .map((x) => '<span class="proposal-chip">' + escapeHtml(String(x)) + '</span>')
                .join('');
              const srcChip = p.source
                ? '<span class="proposal-chip">' + escapeHtml(String(p.source)) + '</span>'
                : '';
              const qChip = p.review_queue
                ? '<span class="proposal-chip">queue:' + escapeHtml(String(p.review_queue)) + '</span>'
                : '';
              const sevChip =
                p.review_severity === 'elevated'
                  ? '<span class="proposal-chip">elevated</span>'
                  : p.review_severity === 'standard'
                    ? '<span class="proposal-chip">standard</span>'
                    : '';
              const extraChips = [labelChips, srcChip, qChip, sevChip].filter(Boolean).join('');
              const discardBtn = canDiscard
                ? '<button class="list-item-delete" title="Discard proposal" aria-label="Discard proposal">✕</button>'
                : '';
              return (
                '<div class="list-item" data-id="' +
                escapeHtml(p.proposal_id) +
                '"><span class="row-title">' +
                escapeHtml(p.path) +
                '</span><div class="status">' +
                escapeHtml(p.status) +
                (p.updated_at ? ' · ' + (calendarDisplayDayKey(p.updated_at) || p.updated_at.slice(0, 10)) : '') +
                (p.evaluation_status ? ' · eval:' + escapeHtml(String(p.evaluation_status)) : '') +
                (extraChips ? ' · ' + extraChips : '') +
                '</div>' + discardBtn + '</div>'
              );
            })
            .join('');
          container.querySelectorAll('.list-item').forEach((item) => {
            item.onclick = () => openProposal(item.dataset.id);
            const db = item.querySelector('.list-item-delete');
            if (db) {
              db.onclick = (e) => {
                e.stopPropagation();
                discardProposalInline(item.dataset.id, item);
              };
            }
          });
        })
        .catch(() => (container.innerHTML = '<p class="muted">Failed to load</p>'));
    });
  }

  async function loadActivity() {
    const container = el('proposals-activity');
    if (!container) return;
    container.innerHTML = loadingHtml;
    try {
      const fq = proposalFilterQuerySuffix();
      const out = await api('/api/v1/proposals?limit=100' + fq);
      let list = out.proposals || [];
      list = applySortedProposalsClient(list);
      if (list.length === 0) {
        container.innerHTML =
          '<div class="empty-state empty-state-activity">' +
          '<p>No proposal activity yet.</p>' +
          '<p class="muted small">Pending reviews from agents or the CLI appear under the <strong>Suggested</strong> tab first; this tab is the timeline once things move.</p>' +
          '<p class="empty-state-activity-actions"><button type="button" class="btn-secondary" id="empty-activity-goto-suggested">Open Suggested tab</button></p>' +
          '</div>';
        const go = container.querySelector('#empty-activity-goto-suggested');
        if (go) go.onclick = () => switchHubMainTab('suggested');
        return;
      }
      const canDiscard = hubUserCanWriteNotes();
      container.innerHTML = list
        .map((p) => {
          const statusClass = p.status === 'approved' ? 'status-approved' : p.status === 'discarded' ? 'status-discarded' : 'status-proposed';
          const date = calendarDisplayDayKey(p.updated_at || p.created_at || '') || (p.updated_at || p.created_at || '').slice(0, 10);
          // Show discard for proposed; show discard-again for discarded (idempotent cleanup);
          // approved records stay as-is unless the user opens them.
          const showDiscard = canDiscard && p.status !== 'approved';
          const discardBtn = showDiscard
            ? '<button class="list-item-delete" title="Discard proposal" aria-label="Discard proposal">✕</button>'
            : '';
          return (
            '<div class="list-item activity-item ' +
            statusClass +
            '" data-id="' +
            escapeHtml(p.proposal_id) +
            '"><span class="row-title">' +
            escapeHtml(p.path) +
            '</span><div class="status">' +
            escapeHtml(p.status) +
            ' · ' +
            escapeHtml(date) +
            '</div>' + discardBtn + '</div>'
          );
        })
        .join('');
      container.querySelectorAll('.list-item').forEach((item) => {
        item.onclick = () => openProposal(item.dataset.id);
        const db = item.querySelector('.list-item-delete');
        if (db) {
          db.onclick = (e) => {
            e.stopPropagation();
            discardProposalInline(item.dataset.id, item);
          };
        }
      });
    } catch (e) {
      container.innerHTML = '<p class="muted">' + escapeHtml(e.message) + '</p>';
    }
  }

  async function runVaultSearch() {
    const query = searchQuery.value.trim();
    if (!query) return;
    hubBrowseListEmptyUnfiltered = false;
    updateEmptyVaultStripVisibility();
    const activeMainTab = document.querySelector('.tabs .tab.active')?.dataset?.tab;
    const useKeyword = searchMode && searchMode.value === 'keyword';
    if (activeMainTab && activeMainTab !== 'notes') {
      showToast(useKeyword ? 'Keyword results are shown under the Notes tab.' : 'Semantic results are shown under the Notes tab.');
    }
    switchNotesView('list');
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    document.querySelector('[data-tab="notes"]').classList.add('active');
    el('tab-notes').classList.remove('hidden');
    notesList.innerHTML = loadingHtml;
    notesTotal.textContent = '';
    const scopeSummary = formatSearchScopeSummary();
    const scopeSuffix = scopeSummary
      ? ' · scope: ' + scopeSummary
      : ' · scope: entire vault (use dropdowns to narrow)';
    try {
      const body = { query, limit: 20 };
      if (useKeyword) body.mode = 'keyword';
      if (filterProject.value) body.project = filterProject.value;
      if (filterTag.value) body.tag = filterTag.value;
      if (filterFolder.value) body.folder = filterFolder.value;
      if (filterSince && filterSince.value) body.since = filterSince.value;
      if (filterUntil && filterUntil.value) body.until = filterUntil.value;
      if (filterContentScope && filterContentScope.value) body.content_scope = filterContentScope.value;
      const out = await api('/api/v1/search', { method: 'POST', body: JSON.stringify(body) });
      const results = out.results || [];
      if (results.length === 0) {
        notesList.innerHTML = useKeyword
          ? '<div class="empty-state">No notes contained this text under the current filters. Try different words, clear filters, or switch to <strong>Meaning</strong> for similarity search.</div>'
          : '<div class="empty-state">No notes matched this query under the current filters. Semantic search finds <em>similar meaning</em>, not exact words — try other phrases, clear filters, use <strong>Keyword</strong> for literal text, or use Quick chips + Apply filters for exact tags/projects.</div>';
        notesTotal.textContent = (useKeyword ? '0 keyword' : '0 semantic') + ' results' + scopeSuffix;
        return;
      }
      notesList.innerHTML = results
        .map((r) => {
          const chips = [];
          if (r.project) chips.push('<span class="chip chip-project">' + escapeHtml(r.project) + '</span>');
          (r.tags || []).slice(0, 3).forEach((t) => chips.push('<span class="chip chip-tag">' + escapeHtml(t) + '</span>'));
          const strength = useKeyword ? keywordMatchStrengthLabel(r.score) : semanticMatchStrengthLabel(r.score);
          const pathStr = String(r.path || '').replace(/\\/g, '/');
          const isLog = pathStr === 'approvals' || pathStr.startsWith('approvals/');
          const badge = isLog ? '<span class="badge-approval-log">Approval log</span>' : '';
          const rowClass = 'list-item' + (isLog ? ' row-approval-log' : '');
          return (
            '<div class="' +
            rowClass +
            '" data-path="' +
            escapeHtml(r.path) +
            '"><span class="row-title">' +
            escapeHtml(r.path) +
            badge +
            '</span><div class="row-chips">' +
            chips.join('') +
            '</div>' +
            (strength ? '<div class="status muted small">' + escapeHtml(strength) + '</div>' : '') +
            (r.snippet ? '<div class="status">' + escapeHtml(r.snippet.slice(0, 120)) + '…</div>' : '') +
            '</div>'
          );
        })
        .join('');
      notesTotal.textContent =
        results.length +
        (useKeyword ? ' keyword' : ' semantic') +
        ' result' +
        (results.length === 1 ? '' : 's') +
        scopeSuffix;
      bindNoteClicks(notesList);
      listSelectedIndex = 0;
      updateListSelection();
    } catch (e) {
      notesList.innerHTML = '<p class="muted">' + escapeHtml(e.message) + '</p>';
      notesTotal.textContent = '';
    }
  }

  btnSearch.onclick = () => {
    void runVaultSearch();
  };

  searchQuery.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void runVaultSearch();
    }
  });
  searchQuery.addEventListener('input', () => {
    updateEmptyVaultStripVisibility();
  });

  function switchNotesView(view) {
    document.querySelectorAll('.view-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    el('notes-view-list').classList.toggle('hidden', view !== 'list');
    el('notes-view-calendar').classList.toggle('hidden', view !== 'calendar');
    el('notes-view-graph').classList.toggle('hidden', view !== 'graph');
    if (view === 'calendar') renderCalendar();
    if (view === 'graph') { renderDashboard(); refreshConsolidationCard(); }
  }

  document.querySelectorAll('.view-tab').forEach((t) => {
    t.onclick = () => switchNotesView(t.dataset.view);
  });

  function ymd(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  async function renderCalendar() {
    const grid = el('calendar-grid');
    const title = el('cal-title');
    const dayList = el('calendar-day-list');
    const dayNotes = el('calendar-day-notes');
    dayList.classList.add('hidden');
    grid.classList.remove('hidden');
    el('calendar-nav').classList.remove('hidden');

    const y = calendarMonth.getFullYear();
    const m = calendarMonth.getMonth();
    title.textContent = calendarMonth.toLocaleString('default', { month: 'long', year: 'numeric' });

    grid.innerHTML = loadingHtml;
    const first = new Date(y, m, 1);
    const last = new Date(y, m + 1, 0);
    const since = ymd(first);
    const until = ymd(last);

    let notesInMonth = [];
    try {
      const q = new URLSearchParams({ since, until, limit: '100' });
      const out = await api('/api/v1/notes?' + q.toString());
      notesInMonth = (out.notes || [])
        .map(normalizeHubListItem)
        .filter((n) => {
          const ds = noteSortOrCalendarDay(n);
          return ds >= since && ds <= until;
        });
    } catch (_) {
      notesInMonth = [];
    }

    const byDay = {};
    notesInMonth.forEach((n) => {
      const ds = noteSortOrCalendarDay(n);
      if (ds >= since && ds <= until) {
        byDay[ds] = (byDay[ds] || 0) + 1;
      }
    });

    const startPad = first.getDay();
    const daysInMonth = last.getDate();
    const cells = [];
    const prevLast = new Date(y, m, 0).getDate();
    for (let i = 0; i < startPad; i++) {
      const d = prevLast - startPad + i + 1;
      cells.push({ out: true, day: d, key: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ out: false, day: d, key: ymd(new Date(y, m, d)) });
    }
    let nextMonthDay = 1;
    while (cells.length % 7 !== 0 || cells.length < 42) {
      cells.push({ out: true, day: nextMonthDay++, key: null });
    }

    const today = ymd(new Date());
    grid.innerHTML = cells
      .map((c) => {
        if (c.out) return '<div class="cal-cell out"><span class="cal-day-num">' + c.day + '</span></div>';
        const cnt = byDay[c.key] || 0;
        const isToday = c.key === today;
        return (
          '<div class="cal-cell' +
          (isToday ? ' today' : '') +
          '" data-day="' +
          escapeHtml(c.key) +
          '"><span class="cal-day-num">' +
          c.day +
          '</span>' +
          (cnt ? '<span class="cal-count">' + cnt + ' note' + (cnt > 1 ? 's' : '') + '</span>' : '') +
          '</div>'
        );
      })
      .join('');

    grid.querySelectorAll('.cal-cell:not(.out)').forEach((cell) => {
      cell.onclick = () => showCalendarDay(cell.dataset.day, notesInMonth);
    });
  }

  el('cal-prev').onclick = () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
    renderCalendar();
  };
  el('cal-next').onclick = () => {
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
    renderCalendar();
  };
  el('cal-back').onclick = () => {
    el('calendar-day-list').classList.add('hidden');
    el('calendar-grid').classList.remove('hidden');
    el('calendar-nav').classList.remove('hidden');
  };

  function showCalendarDay(dayKey, notesInMonth) {
    const matches = notesInMonth.filter((n) => noteSortOrCalendarDay(n) === dayKey);
    el('cal-day-title').textContent = dayKey + ' (' + matches.length + ' notes)';
    el('calendar-day-notes').innerHTML = matches.length ? matches.map(renderNoteRow).join('') : '<p class="muted">No notes</p>';
    bindNoteClicks(el('calendar-day-notes'));
    el('calendar-grid').classList.add('hidden');
    el('calendar-nav').classList.add('hidden');
    el('calendar-day-list').classList.remove('hidden');
  }

  async function fetchNotesForDashboard() {
    const all = [];
    let offset = 0;
    const limit = 100;
    let total = Infinity;
    while (offset < 500 && all.length < total) {
      const out = await api('/api/v1/notes?limit=' + limit + '&offset=' + offset);
      total = out.total ?? 0;
      const batch = (out.notes || []).map(normalizeHubListItem);
      all.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }
    return { notes: all, total };
  }

  async function renderDashboard() {
    chartInstances.forEach((c) => c.destroy());
    chartInstances = [];
    const cards = el('dashboard-cards');
    const foot = el('dashboard-footnote');
    cards.innerHTML = loadingHtml;
    foot.textContent = '';

    let notes, total;
    try {
      const r = await fetchNotesForDashboard();
      notes = r.notes;
      total = r.total;
    } catch (e) {
      cards.innerHTML = '<p class="muted">' + escapeHtml(e.message) + '</p>';
      return;
    }

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekStr = ymd(weekAgo);
    const thisWeek = notes.filter((n) => noteSortOrCalendarDay(n) >= weekStr).length;

    const byProject = {};
    const byTag = {};
    const byWeek = {};
    notes.forEach((n) => {
      if (n.project) byProject[n.project] = (byProject[n.project] || 0) + 1;
      (n.tags || []).forEach((t) => {
        byTag[t] = (byTag[t] || 0) + 1;
      });
      const ds = noteSortOrCalendarDay(n);
      if (ds) {
        const w = ds.slice(0, 7);
        byWeek[w] = (byWeek[w] || 0) + 1;
      }
    });

    const topProjects = Object.entries(byProject)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const topTags = Object.entries(byTag)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    const weeks = Object.keys(byWeek).sort();

    cards.innerHTML =
      '<div class="dash-card"><div class="dash-value">' +
      total +
      '</div><div class="dash-label">Notes (indexed)</div></div>' +
      '<div class="dash-card"><div class="dash-value">' +
      thisWeek +
      '</div><div class="dash-label">Last 7 days</div></div>' +
      '<div class="dash-card"><div class="dash-value">' +
      Object.keys(byProject).length +
      '</div><div class="dash-label">Projects</div></div>' +
      '<div class="dash-card"><div class="dash-value">' +
      Object.keys(byTag).length +
      '</div><div class="dash-label">Tags</div></div>';

    if (notes.length < total) {
      foot.textContent = 'Charts use the first ' + notes.length + ' notes (of ' + total + '). Refine filters or paginate in API for full coverage.';
    }

    if (typeof Chart === 'undefined') {
      foot.textContent += ' Chart.js failed to load.';
      return;
    }

    const commonOpts = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#a1a1a1' } } },
      scales: {
        x: { ticks: { color: '#a1a1a1' }, grid: { color: '#2a3f5c' } },
        y: { ticks: { color: '#a1a1a1' }, grid: { color: '#2a3f5c' } },
      },
    };

    const ctxP = el('chart-projects').getContext('2d');
    chartInstances.push(
      new Chart(ctxP, {
        type: 'bar',
        data: {
          labels: topProjects.map((x) => x[0]),
          datasets: [{ label: 'Notes', data: topProjects.map((x) => x[1]), backgroundColor: 'rgba(137, 207, 240, 0.5)', borderColor: '#89cff0' }],
        },
        options: { ...commonOpts, plugins: { ...commonOpts.plugins, title: { display: true, text: 'By project', color: '#fafafa' } } },
      })
    );

    const ctxT = el('chart-tags').getContext('2d');
    chartInstances.push(
      new Chart(ctxT, {
        type: 'doughnut',
        data: {
          labels: topTags.map((x) => x[0]),
          datasets: [{ data: topTags.map((x) => x[1]), backgroundColor: ['#89cff0', '#22c55e', '#a78bfa', '#f472b6', '#fb923c', '#6b9dc4', '#4ade80', '#c084fc'] }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#a1a1a1' } }, title: { display: true, text: 'Top tags', color: '#fafafa' } } },
      })
    );

    const ctxL = el('chart-timeline').getContext('2d');
    chartInstances.push(
      new Chart(ctxL, {
        type: 'line',
        data: {
          labels: weeks,
          datasets: [{ label: 'Notes per month', data: weeks.map((w) => byWeek[w]), borderColor: '#89cff0', backgroundColor: 'rgba(137, 207, 240, 0.1)', fill: true, tension: 0.2 }],
        },
        options: { ...commonOpts, plugins: { ...commonOpts.plugins, title: { display: true, text: 'By month (note date)', color: '#fafafa' } } },
      })
    );
  }

  function openCreateModal() {
    closeCreateProposalModal();
    hideDetailPanelChrome();
    el('modal-create').classList.remove('hidden');
    el('create-msg-quick').textContent = '';
    el('create-msg-quick').className = 'create-msg';
    el('create-msg-full').textContent = '';
    el('create-msg-full').className = 'create-msg';
    if (token) void refreshFullPathFolderSelect();
  }
  function closeCreateModal() {
    el('modal-create').classList.add('hidden');
  }
  function closeCreateProposalModal() {
    const m = el('modal-create-proposal');
    if (m) m.classList.add('hidden');
    const pathInput = el('proposal-create-path');
    if (pathInput) pathInput.readOnly = false;
  }
  /** @param {{ path?: string, body?: string, intent?: string, fromNote?: boolean }} [opts] */
  function openCreateProposalModal(opts) {
    if (!token) {
      if (typeof showToast === 'function') showToast('Sign in to create a proposal.', true);
      return;
    }
    if (!hubUserCanWriteNotes()) {
      if (typeof showToast === 'function') showToast('Your role cannot create proposals.', true);
      return;
    }
    closeCreateModal();
    closeImportModal();
    hideDetailPanelChrome();
    const modal = el('modal-create-proposal');
    const pathInput = el('proposal-create-path');
    const hint = el('modal-create-proposal-hint');
    const bodyEl = el('proposal-create-body');
    const intentEl = el('proposal-create-intent');
    const msgEl = el('proposal-create-msg');
    if (!modal || !pathInput || !bodyEl || !intentEl) return;
    if (opts && opts.fromNote) {
      pathInput.readOnly = true;
      pathInput.value = opts.path || '';
      if (hint)
        hint.textContent =
          'You are proposing a new version of this note. Edit the body below; the path matches the open note.';
    } else {
      pathInput.readOnly = false;
      pathInput.value = (opts && opts.path) || '';
      if (hint)
        hint.textContent =
          'Submit a proposed file change for review (same as POST /api/v1/proposals). An admin approves in the Suggested tab.';
    }
    bodyEl.value = (opts && opts.body) || '';
    intentEl.value = (opts && opts.intent) || '';
    if (msgEl) {
      msgEl.textContent = '';
      msgEl.className = 'create-msg';
    }
    modal.classList.remove('hidden');
  }
  btnNewNote.onclick = openCreateModal;
  el('modal-create-backdrop').onclick = closeCreateModal;
  el('modal-create-close').onclick = closeCreateModal;

  const modalCreateProposalBackdrop = el('modal-create-proposal-backdrop');
  const modalCreateProposalClose = el('modal-create-proposal-close');
  if (modalCreateProposalBackdrop) modalCreateProposalBackdrop.onclick = closeCreateProposalModal;
  if (modalCreateProposalClose) modalCreateProposalClose.onclick = closeCreateProposalModal;

  const btnNewProposal = el('btn-new-proposal');
  if (btnNewProposal) {
    btnNewProposal.onclick = () => openCreateProposalModal({});
  }

  const btnProposalCreateSubmit = el('btn-proposal-create-submit');
  if (btnProposalCreateSubmit) {
    btnProposalCreateSubmit.onclick = async () => {
      const pathInput = el('proposal-create-path');
      const bodyInput = el('proposal-create-body');
      const intentInput = el('proposal-create-intent');
      const msgEl = el('proposal-create-msg');
      const rawPath = pathInput && pathInput.value != null ? String(pathInput.value).trim() : '';
      if (!rawPath) {
        if (msgEl) {
          msgEl.textContent = 'Path is required.';
          msgEl.className = 'create-msg err';
        }
        return;
      }
      const body = bodyInput && bodyInput.value != null ? String(bodyInput.value) : '';
      const intent = intentInput && intentInput.value != null ? String(intentInput.value).trim() : '';
      await withButtonBusy(btnProposalCreateSubmit, 'Submitting…', async () => {
        try {
          await api('/api/v1/proposals', {
            method: 'POST',
            body: JSON.stringify({
              path: rawPath,
              body,
              ...(intent ? { intent } : {}),
              source: 'hub_ui',
            }),
          });
          closeCreateProposalModal();
          if (typeof showToast === 'function') showToast('Proposal submitted');
          document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
          document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
          const suggestedTab = document.querySelector('[data-tab="suggested"]');
          const suggestedPanel = el('tab-suggested');
          if (suggestedTab) suggestedTab.classList.add('active');
          if (suggestedPanel) suggestedPanel.classList.remove('hidden');
          syncHubListSortUI('suggested');
          setProposalFiltersBarVisible(true);
          refreshNewProposalTabVisibility();
          loadProposals();
        } catch (e) {
          if (msgEl) {
            msgEl.textContent = e.message || 'Proposal failed';
            msgEl.className = 'create-msg err';
          }
        }
      });
    };
  }

  function openImportModal() {
    if (!token) {
      if (typeof showToast === 'function') showToast('Sign in to import into your vault.', true);
      return;
    }
    closeCreateModal();
    closeCreateProposalModal();
    hideDetailPanelChrome();
    el('modal-import').classList.remove('hidden');
    el('import-msg').textContent = '';
    if (importFileEl) importFileEl.value = '';
    if (importFileFolderEl) importFileFolderEl.value = '';
    if (importFolderHintEl) importFolderHintEl.classList.add('hidden');
    if (importBatchCancelBtn) importBatchCancelBtn.classList.add('hidden');
    setImportBatchAria('');
    const urlIn = el('import-url');
    if (urlIn) urlIn.value = '';
  }
  function closeImportModal() {
    el('modal-import').classList.add('hidden');
  }
  if (btnImport) btnImport.onclick = openImportModal;
  el('modal-import-backdrop').onclick = closeImportModal;
  el('modal-import-close').onclick = closeImportModal;

  function closeProjectsHelpModal() {
    const m = el('modal-projects-help');
    if (m) m.classList.add('hidden');
  }
  function openProjectsHelpModal() {
    closeCreateModal();
    closeCreateProposalModal();
    hideDetailPanelChrome();
    const m = el('modal-projects-help');
    if (m) m.classList.remove('hidden');
  }
  const btnProjectsHelp = el('btn-projects-help');
  if (btnProjectsHelp) btnProjectsHelp.onclick = openProjectsHelpModal;
  const modalProjectsHelpBackdrop = el('modal-projects-help-backdrop');
  const modalProjectsHelpClose = el('modal-projects-help-close');
  if (modalProjectsHelpBackdrop) modalProjectsHelpBackdrop.onclick = closeProjectsHelpModal;
  if (modalProjectsHelpClose) modalProjectsHelpClose.onclick = closeProjectsHelpModal;

  if (btnImportChooseFolder && importFileFolderEl) {
    btnImportChooseFolder.onclick = () => {
      importFileFolderEl.click();
    };
  }
  if (importFileFolderEl) {
    importFileFolderEl.addEventListener('change', () => {
      if (importFileFolderEl.files && importFileFolderEl.files.length) {
        if (importFileEl) importFileEl.value = '';
        if (importFolderHintEl) importFolderHintEl.classList.remove('hidden');
      }
    });
  }
  if (importFileEl) {
    importFileEl.addEventListener('change', () => {
      if (importFileFolderEl) importFileFolderEl.value = '';
      if (importFolderHintEl) importFolderHintEl.classList.add('hidden');
    });
  }
  if (importBatchCancelBtn) {
    importBatchCancelBtn.onclick = () => {
      if (importBatchAbort) importBatchAbort.abort();
    };
  }

  /**
   * @param {string} postPath
   * @param {FormData} formData
   * @param {Record<string, string>} importHeaders
   * @returns {Promise<{ ok: boolean, data?: object, errText?: string, status?: number }>}
   */
  async function hubPostImportOnce(postPath, formData, importHeaders) {
    let res;
    for (let importAttempt = 0; importAttempt < 2; importAttempt++) {
      try {
        res = await fetch(postPath, {
          method: 'POST',
          cache: 'no-store',
          headers: importHeaders,
          body: formData,
        });
        break;
      } catch (importErr) {
        const em = importErr && importErr.message ? String(importErr.message) : String(importErr);
        if (importAttempt === 0 && (em === 'Failed to fetch' || em.includes('NetworkError'))) {
          await new Promise((r) => setTimeout(r, 3000));
          continue;
        }
        return { ok: false, errText: em, status: 0 };
      }
    }
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = {};
    }
    if (!res.ok) {
      let apiErr = '';
      if (data && typeof data === 'object') {
        const parts = [data.error, data.message, data.detail].filter(
          (x) => x != null && String(x).trim().length > 0,
        );
        apiErr = [...new Set(parts.map((x) => String(x).trim()))].join(' — ');
      }
      if (!apiErr && text) {
        const t = text.trim();
        if (t.startsWith('<')) {
          apiErr = `HTTP ${res.status}: server returned an HTML error page (check gateway/bridge Netlify logs).`;
        } else {
          apiErr = t.slice(0, 280);
        }
      }
      return { ok: false, errText: apiErr || `Import failed (HTTP ${res.status})`, status: res.status, data };
    }
    return { ok: true, data };
  }

  el('btn-import-submit').onclick = async () => {
    const importSubmitBtn = el('btn-import-submit');
    const sourceType = el('import-source-type').value;
    const fileInput = el('import-file');
    const urlInput = el('import-url');
    const urlTrim = urlInput && urlInput.value ? String(urlInput.value).trim() : '';
    const msgEl = el('import-msg');
    /** @type {{ getHubImportFileMode: (a: string, f: File[]) => string, buildImportZipBlob: (f: File[], o: object) => Promise<Blob>, assertSingleFileWithinLimit: (f: File) => void } | null | undefined} */
    const kz = globalThis.knowtationHubImportZip;

    if (!token) {
      msgEl.textContent = 'Sign in to import.';
      msgEl.className = 'create-msg err';
      return;
    }
    const useUrlImport = urlTrim.length > 0;
    if (sourceType === 'url' && !useUrlImport) {
      msgEl.textContent = 'Enter an https URL above, or pick another source type and upload a file.';
      msgEl.className = 'create-msg err';
      return;
    }
    const usedFolder = importFileFolderEl && importFileFolderEl.files && importFileFolderEl.files.length > 0;
    const fileArr = usedFolder
      ? Array.from(importFileFolderEl.files)
      : fileInput && fileInput.files
        ? Array.from(fileInput.files)
        : [];
    if (!useUrlImport && fileArr.length === 0) {
      msgEl.textContent = 'Choose file(s) or a folder to import, or paste an https URL above.';
      msgEl.className = 'create-msg err';
      return;
    }
    if (sourceType === 'notion' && fileArr.length > 1) {
      msgEl.textContent = 'Notion: use a single file or the CLI. Page IDs in one text file, or one import at a time.';
      msgEl.className = 'create-msg err';
      return;
    }

    const project = (el('import-project') && el('import-project').value) ? el('import-project').value.trim() : '';
    const tags = (el('import-tags') && el('import-tags').value) ? el('import-tags').value.trim() : '';
    const urlModeEl = el('import-url-mode');
    const urlMode = urlModeEl && urlModeEl.value ? urlModeEl.value : 'auto';
    const importPostPath = apiBase + '/api/v1/import';
    const urlPostPath = apiBase + '/api/v1/import-url';
    const mode =
      !useUrlImport && kz && typeof kz.getHubImportFileMode === 'function'
        ? kz.getHubImportFileMode(sourceType, fileArr)
        : 'direct';

    if (!useUrlImport && !kz && fileArr.length > 1) {
      msgEl.textContent =
        'Import helpers (JSZip) did not load. Hard-refresh the page, or import one file at a time, or pre-zip a folder and upload a single .zip.';
      msgEl.className = 'create-msg err';
      return;
    }

    if (!useUrlImport && mode === 'client_zip' && !kz) {
      msgEl.textContent =
        'In-browser ZIP helper did not load (JSZip). Hard-refresh the page and try again, or pre-zip the folder and upload a single .zip.';
      msgEl.className = 'create-msg err';
      return;
    }
    if (!useUrlImport && mode === 'sequential' && fileArr.length > HUB_IMPORT_MAX_SEQUENTIAL) {
      msgEl.textContent =
        'Too many files for one batch (max ' +
        HUB_IMPORT_MAX_SEQUENTIAL +
        '). Split the batch, use the CLI, or use one in-browser folder ZIP (Phase 4A₂) for tree-shaped source types.';
      msgEl.className = 'create-msg err';
      return;
    }

    if (useUrlImport) {
      const jsonBody = { url: urlTrim, mode: urlMode };
      if (project) jsonBody.project = project;
      if (tags) jsonBody.tags = tags;
      msgEl.textContent = 'Importing…';
      msgEl.className = 'create-msg';
      await withButtonBusy(importSubmitBtn, 'Importing…', async () => {
        try {
          const importHeaders = token ? { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } : {};
          const importVaultId = getCurrentVaultId();
          if (importVaultId) importHeaders['X-Vault-Id'] = importVaultId;
          let res;
          for (let importAttempt = 0; importAttempt < 2; importAttempt++) {
            try {
              res = await fetch(urlPostPath, {
                method: 'POST',
                cache: 'no-store',
                headers: importHeaders,
                body: JSON.stringify(jsonBody),
              });
              break;
            } catch (importErr) {
              const em = importErr && importErr.message ? String(importErr.message) : String(importErr);
              if (importAttempt === 0 && (em === 'Failed to fetch' || em.includes('NetworkError'))) {
                await new Promise((r) => setTimeout(r, 3000));
                continue;
              }
              throw importErr;
            }
          }
          const text = await res.text();
          let data = {};
          try {
            data = text ? JSON.parse(text) : {};
          } catch (_) {
            data = {};
          }
          if (!res.ok) {
            let apiErr = '';
            if (data && typeof data === 'object') {
              const parts = [data.error, data.message, data.detail].filter(
                (x) => x != null && String(x).trim().length > 0,
              );
              apiErr = [...new Set(parts.map((x) => String(x).trim()))].join(' — ');
            }
            if (!apiErr && text) {
              const t = text.trim();
              if (t.startsWith('<')) {
                apiErr = `HTTP ${res.status}: server returned an HTML error page.`;
              } else {
                apiErr = t.slice(0, 280);
              }
            }
            msgEl.textContent = apiErr || (res.status ? `Import failed (HTTP ${res.status})` : '') || 'Import failed';
            msgEl.className = 'create-msg err';
            return;
          }
          const count = data.count ?? data.imported?.length ?? 0;
          if (count === 0) {
            msgEl.textContent = 'Imported 0 notes from URL. Try Bookmark mode or a different link.';
            msgEl.className = 'create-msg warn';
          } else {
            msgEl.textContent = 'Imported ' + count + ' note(s).';
            msgEl.className = 'create-msg ok';
          }
          if (typeof loadNotes === 'function') loadNotes();
          if (typeof loadFacets === 'function') loadFacets();
          if (typeof showToast === 'function') showToast('Import complete');
          setTimeout(() => closeImportModal(), 1500);
        } catch (e) {
          const raw = e && e.message ? String(e.message) : 'Import failed';
          const isNetwork =
            raw === 'Failed to fetch' ||
            (e && e.name === 'TypeError' && /fetch|network|load failed/i.test(raw));
          msgEl.textContent = isNetwork
            ? raw +
              ' — Often: CORS, upload too large for the gateway, or timeout. On hosted, check DevTools → Network for POST /api/v1/import-url.'
            : raw;
          msgEl.className = 'create-msg err';
        }
      });
      return;
    }

    const importHeadersBase = token ? { Authorization: 'Bearer ' + token } : {};
    const importVaultId = getCurrentVaultId();
    if (importVaultId) importHeadersBase['X-Vault-Id'] = importVaultId;

    if (mode === 'sequential') {
      if (importBatchCancelBtn) importBatchCancelBtn.classList.remove('hidden');
      importBatchAbort = new AbortController();
      msgEl.textContent = 'Importing ' + fileArr.length + ' file(s)…';
      msgEl.className = 'create-msg';
      setImportBatchAria('Starting batch import, 0 of ' + fileArr.length);
      await withButtonBusy(importSubmitBtn, 'Importing…', async () => {
        const failures = [];
        let totalImported = 0;
        let okN = 0;
        for (let i = 0; i < fileArr.length; i++) {
          if (importBatchAbort && importBatchAbort.signal.aborted) {
            setImportBatchAria('Batch import stopped by user after ' + okN + ' of ' + fileArr.length);
            break;
          }
          const f = fileArr[i];
          try {
            if (kz && kz.assertSingleFileWithinLimit) kz.assertSingleFileWithinLimit(f);
          } catch (limErr) {
            failures.push({ name: f.name, err: limErr && limErr.message ? String(limErr.message) : String(limErr) });
            continue;
          }
          setImportBatchAria('Importing file ' + (i + 1) + ' of ' + fileArr.length + ': ' + f.name);
          const fd = new FormData();
          fd.append('source_type', sourceType);
          fd.append('file', f);
          if (project) fd.append('project', project);
          if (tags) fd.append('tags', tags);
          const r = await hubPostImportOnce(importPostPath, fd, { ...importHeadersBase });
          if (r.ok && r.data) {
            const c = r.data.count ?? r.data.imported?.length ?? 0;
            totalImported += typeof c === 'number' ? c : 0;
            okN++;
          } else {
            failures.push({ name: f.name, err: r.errText || 'error' });
          }
        }
        if (importBatchCancelBtn) importBatchCancelBtn.classList.add('hidden');
        importBatchAbort = null;
        const fl = failures.length
          ? ' Failures: ' + failures.map((x) => x.name + (x.err ? ' — ' + x.err.slice(0, 120) : '')).join('; ') + '.'
          : '.';
        msgEl.textContent =
          'Batch: ' + okN + ' of ' + fileArr.length + ' file import(s) succeeded' + (totalImported ? ' (' + totalImported + ' note(s) reported).' : '.') + fl;
        msgEl.className = 'create-msg ' + (failures.length && okN === 0 ? 'err' : failures.length ? 'warn' : 'ok');
        setImportBatchAria(msgEl.textContent);
        if (typeof loadNotes === 'function') loadNotes();
        if (typeof loadFacets === 'function') loadFacets();
        if (okN > 0 && typeof showToast === 'function') showToast('Import complete');
        if (okN > 0) setTimeout(() => closeImportModal(), 2000);
      });
      return;
    }

    msgEl.textContent = 'Importing…';
    msgEl.className = 'create-msg';
    await withButtonBusy(importSubmitBtn, 'Importing…', async () => {
      try {
        const dupWarn = [];
        const warnFn = (s) => {
          dupWarn.push(s);
        };
        /** @type {FormData} */
        let formData;
        if (mode === 'client_zip' && kz) {
          const blob = await kz.buildImportZipBlob(fileArr, {
            signal: null,
            warn: warnFn,
          });
          const fileOut = new File([blob], 'hub-bulk.zip', { type: 'application/zip' });
          formData = new FormData();
          formData.append('source_type', sourceType);
          formData.append('file', fileOut);
          if (project) formData.append('project', project);
          if (tags) formData.append('tags', tags);
          if (dupWarn.length) {
            msgEl.className = 'create-msg';
            msgEl.textContent = dupWarn.join(' ') + ' Zipping, then uploading…';
          }
        } else {
          if (fileArr[0] && kz && kz.assertSingleFileWithinLimit) {
            try {
              kz.assertSingleFileWithinLimit(fileArr[0]);
            } catch (e1) {
              msgEl.textContent = e1 && e1.message ? String(e1.message) : String(e1);
              msgEl.className = 'create-msg err';
              return;
            }
          }
          formData = new FormData();
          formData.append('source_type', sourceType);
          formData.append('file', fileArr[0]);
          if (project) formData.append('project', project);
          if (tags) formData.append('tags', tags);
        }
        const r = await hubPostImportOnce(importPostPath, formData, { ...importHeadersBase });
        if (!r.ok) {
          msgEl.textContent = r.errText || 'Import failed';
          msgEl.className = 'create-msg err';
          return;
        }
        const data = r.data || {};
        const count = data.count ?? data.imported?.length ?? 0;
        let extra = '';
        if (mode === 'client_zip' && dupWarn.length) extra = ' ' + dupWarn.join(' ');
        if (count === 0) {
          const zeroMsg =
            sourceType === 'markdown'
              ? 'Imported 0 notes. This ZIP or folder had no Markdown files we could use—only .md / .markdown (any case). Other formats are skipped unless you pick the matching source type (e.g. PDF or DOCX).'
              : sourceType === 'pdf'
                ? 'Imported 0 notes. PDF import could not produce a note (wrong file type, corrupt file, or no extractable text—try OCR for scans).'
                : sourceType === 'docx'
                  ? 'Imported 0 notes. DOCX import could not produce a note (wrong file type, corrupt file, empty document, or not Office Open XML .docx).'
                  : 'Imported 0 notes. Check that the file matches the selected source type (e.g. ChatGPT export needs chatgpt-export).';
          msgEl.textContent = zeroMsg + extra;
          msgEl.className = 'create-msg warn';
        } else {
          msgEl.textContent = 'Imported ' + count + ' note(s).' + extra;
          msgEl.className = 'create-msg ok';
        }
        if (typeof loadNotes === 'function') loadNotes();
        if (typeof loadFacets === 'function') loadFacets();
        if (typeof showToast === 'function') showToast('Import complete');
        setTimeout(() => closeImportModal(), 1500);
      } catch (e) {
        const raw = e && e.message ? String(e.message) : 'Import failed';
        if (e && e.name === 'AbortError') {
          msgEl.textContent = 'Cancelled.';
        } else {
          const isNetwork =
            raw === 'Failed to fetch' ||
            (e && e.name === 'TypeError' && /fetch|network|load failed/i.test(raw));
          msgEl.textContent = isNetwork
            ? raw +
              ' — Often: CORS, upload too large for the gateway, or timeout. Video/audio need self-hosted Hub plus OPENAI_API_KEY. On hosted, check Network for POST /api/v1/import.'
            : raw;
        }
        msgEl.className = 'create-msg err';
      }
    });
  };

  function openHowToUse(tabId, scrollToId) {
    const id = tabId || 'setup';
    el('modal-how-to-use').classList.remove('hidden');
    document.querySelectorAll('.how-to-tab').forEach((t) => t.classList.toggle('active', t.dataset.howToTab === id));
    document.querySelectorAll('.how-to-tab').forEach((t) => t.setAttribute('aria-selected', t.dataset.howToTab === id ? 'true' : 'false'));
    document.querySelectorAll('.how-to-panel').forEach((p) => p.classList.toggle('active', p.id === 'how-to-panel-' + id));
    if (scrollToId) {
      requestAnimationFrame(() => {
        const target = document.getElementById(scrollToId);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }
  function closeHowToUse() {
    el('modal-how-to-use').classList.add('hidden');
  }
  if (btnHowToUse) btnHowToUse.onclick = () => openHowToUse();
  const btnLoginHowToUse = el('btn-login-how-to-use');
  if (btnLoginHowToUse) btnLoginHowToUse.onclick = () => openHowToUse();
  const btnSettingsHelp = el('btn-settings-help');
  if (btnSettingsHelp) {
    btnSettingsHelp.onclick = () => {
      closeSettings();
      openHowToUse('knowledge-agents');
    };
  }
  el('modal-how-to-use-backdrop').onclick = closeHowToUse;
  el('modal-how-to-use-close').onclick = closeHowToUse;

  document.querySelectorAll('.how-to-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const id = tab.dataset.howToTab;
      document.querySelectorAll('.how-to-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.howToTab === id);
        t.setAttribute('aria-selected', t.dataset.howToTab === id ? 'true' : 'false');
      });
      document.querySelectorAll('.how-to-panel').forEach((p) => {
        p.classList.toggle('active', p.id === 'how-to-panel-' + id);
      });
    });
  });

  const modalHowTo = el('modal-how-to-use');
  if (modalHowTo) {
    modalHowTo.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.classList && t.classList.contains('how-to-jump-consolidation')) {
        e.preventDefault();
        openHowToUse('consolidation');
      }
    });
  }

  const btnHowToOpenOnboarding = el('btn-how-to-open-onboarding');
  if (btnHowToOpenOnboarding && !btnHowToOpenOnboarding.dataset.knowtationBound) {
    btnHowToOpenOnboarding.dataset.knowtationBound = '1';
    btnHowToOpenOnboarding.addEventListener('click', () => {
      closeHowToUse();
      void openOnboardingWizard({ restart: false });
    });
  }
  const btnEmptyStripWizard = el('btn-empty-strip-wizard');
  if (btnEmptyStripWizard && !btnEmptyStripWizard.dataset.knowtationBound) {
    btnEmptyStripWizard.dataset.knowtationBound = '1';
    btnEmptyStripWizard.addEventListener('click', () => {
      void openOnboardingWizard({ restart: true });
    });
  }
  const btnEmptyStripGettingStarted = el('btn-empty-strip-getting-started');
  if (btnEmptyStripGettingStarted && !btnEmptyStripGettingStarted.dataset.knowtationBound) {
    btnEmptyStripGettingStarted.dataset.knowtationBound = '1';
    btnEmptyStripGettingStarted.addEventListener('click', () => {
      openHowToUse('getting-started');
    });
  }

  function openTokenSavingsHowToFromSettings() {
    closeSettings();
    openHowToUse('token-savings');
  }
  const btnConsolToken = el('btn-consol-how-token-savings');
  if (btnConsolToken) btnConsolToken.addEventListener('click', (e) => { e.preventDefault(); openTokenSavingsHowToFromSettings(); });
  const btnIntegToken = el('btn-integrations-how-token-savings');
  if (btnIntegToken) btnIntegToken.addEventListener('click', (e) => { e.preventDefault(); openTokenSavingsHowToFromSettings(); });
  const btnAgentsToken = el('btn-agents-how-token-savings');
  if (btnAgentsToken) btnAgentsToken.addEventListener('click', (e) => { e.preventDefault(); openTokenSavingsHowToFromSettings(); });

  function openSettings() {
    refreshApiBaseFootgunBanner();
    closeCreateModal();
    el('modal-settings').classList.remove('hidden');
    document.querySelectorAll('.settings-tab').forEach((t) => t.classList.toggle('active', t.dataset.settingsTab === 'backup'));
    document.querySelectorAll('.settings-panel').forEach((p) => {
      p.classList.toggle('active', p.id === 'settings-panel-backup');
    });
    syncAccentUI();
    syncThemeUI();
    syncColorPaletteUI();
    refreshIntegApiStatus();
    el('settings-sync-msg').textContent = '';
    el('settings-sync-msg').className = 'settings-msg';
    el('settings-save-msg').textContent = '';
    el('settings-save-msg').className = 'settings-msg';
    const policyMsg = el('settings-proposal-policy-msg');
    if (policyMsg) {
      policyMsg.textContent = '';
      policyMsg.className = 'settings-msg';
    }
    el('settings-mode-display').textContent = 'Loading…';
    el('settings-vault-display').textContent = 'Loading…';
    el('settings-git-status').textContent = 'Loading…';
    const ghStatus = el('settings-github-status');
    if (ghStatus) ghStatus.textContent = 'Loading…';
    fetchSettingsForBackupModal()
      .then((s) => {
        applySettingsPayloadToHubChrome(s);
        const roleEl = el('settings-role-display');
        if (roleEl) roleEl.textContent = s.role ? String(s.role) : '—';
        const userIdEl = el('settings-user-id');
        if (userIdEl) userIdEl.textContent = s.user_id || '—';
        const vaultDisplay = s.vault_path_display || '—';
        const isHosted = (vaultDisplay + '').toLowerCase() === 'canister';
        if (el('settings-mode-display')) el('settings-mode-display').textContent = isHosted ? 'Hosted (beta)' : 'Self-hosted';
        el('settings-vault-display').textContent = vaultDisplay;
        const configureSection = el('settings-configure-backup-section');
        const configureHr = el('settings-hr-configure');
        if (configureSection) configureSection.style.display = isHosted ? 'none' : '';
        if (configureHr) configureHr.style.display = isHosted ? 'none' : '';
        const vg = s.vault_git || {};
        // Guided Setup checklist: step 1 = vault path (self-hosted) or account (hosted), step 4 = backup configured
        const step1 = document.getElementById('setup-step-1');
        const step4 = document.getElementById('setup-step-4');
        const step1Label = el('setup-step-1-label');
        const step1Hint = el('setup-step-1-hint');
        if (step1Label) step1Label.textContent = isHosted ? 'Account ready' : 'Vault path set';
        if (step1Hint) {
          step1Hint.textContent = isHosted
            ? 'Your notes live in your hosted vault'
            : 'Set below under Configure backup';
        }
        if (step1) {
          const done = Boolean(s.vault_path_display && s.vault_path_display.trim());
          step1.classList.toggle('setup-step-done', done);
          const icon = step1.querySelector('.setup-step-icon');
          if (icon) icon.textContent = done ? '✓' : '';
        }
        if (step4) {
          const done = !!(vg.enabled && vg.has_remote);
          step4.classList.toggle('setup-step-done', done);
          const icon = step4.querySelector('.setup-step-icon');
          if (icon) icon.textContent = done ? '✓' : '';
        }
        let gitText = 'Not configured';
        if (vg.enabled && vg.has_remote) {
          gitText = 'Configured';
          if (vg.auto_commit) gitText += ' (auto-commit on)';
          if (vg.auto_push) gitText += ', auto-push on';
        } else if (vg.enabled) gitText = 'Enabled but no remote set';
        el('settings-git-status').textContent = gitText;
        const evalReqEl = el('settings-proposal-eval-required');
        if (evalReqEl) evalReqEl.textContent = s.proposal_evaluation_required ? 'On' : 'Off';
        const hintsEl = el('settings-proposal-hints-enabled');
        if (hintsEl) hintsEl.textContent = s.proposal_review_hints_enabled ? 'On' : 'Off';
        const enrichStatusEl = el('settings-proposal-enrich-enabled');
        if (enrichStatusEl) enrichStatusEl.textContent = s.proposal_enrich_enabled ? 'On' : 'Off';
        const evApEl = el('settings-evaluator-may-approve');
        if (evApEl) evApEl.textContent = s.hub_evaluator_may_approve ? 'Yes' : 'No';
        const syncBtn = el('btn-settings-sync');
        const isAdmin = s.role === 'admin';
        if (syncBtn) syncBtn.disabled = settingsSyncDisabled(s, vg, isHosted);
        const saveSetupBtn = el('btn-settings-save');
        if (saveSetupBtn) {
          saveSetupBtn.disabled = false;
          saveSetupBtn.title = isAdmin ? '' : 'Only admins can save; your role is shown under Status above.';
        }
        const teamTab = el('settings-tab-team');
        if (teamTab) teamTab.classList.toggle('hidden', !isAdmin);
        const vaultsTab = el('settings-tab-vaults');
        if (vaultsTab) vaultsTab.classList.toggle('hidden', !isAdmin);
        const policyAdmin = el('settings-proposal-policy-admin');
        const storedPolicy = s.proposal_policy_stored || {};
        const policyLocks = s.proposal_policy_env_locked || {};
        if (policyAdmin) {
          policyAdmin.classList.toggle('hidden', !isAdmin);
          const cEval = el('settings-policy-eval');
          const cHints = el('settings-policy-hints');
          const cEnrich = el('settings-policy-enrich');
          if (cEval && cHints && cEnrich) {
            cEval.checked = Boolean(storedPolicy.proposal_evaluation_required);
            cHints.checked = Boolean(storedPolicy.review_hints_enabled);
            cEnrich.checked = Boolean(storedPolicy.enrich_enabled);
            cEval.disabled = Boolean(policyLocks.proposal_evaluation_required);
            cHints.disabled = Boolean(policyLocks.review_hints_enabled);
            cEnrich.disabled = Boolean(policyLocks.enrich_enabled);
            const lockHint =
              'Fixed by a server environment variable; change or unset it on the host to control this from here.';
            cEval.title = policyLocks.proposal_evaluation_required ? lockHint : '';
            cHints.title = policyLocks.review_hints_enabled ? lockHint : '';
            cEnrich.title = policyLocks.enrich_enabled ? lockHint : '';
          }
        }
        const connectBtn = el('btn-connect-github');
        const ghStatus = el('settings-github-status');
        const hostedGhHint = el('settings-hosted-connect-github-hint');
        if (s.github_connect_available) {
          if (connectBtn) {
            connectBtn.classList.remove('hidden');
            connectBtn.onclick = () => {
              const base = apiBase.replace(/\/$/, '');
              const qs = token ? '?' + new URLSearchParams({ token }).toString() : '';
              window.location.assign(base + '/api/v1/auth/github-connect' + qs);
            };
          }
          if (ghStatus) ghStatus.textContent = s.github_connected ? 'Connected (token stored for push)' : 'Not connected';
        } else {
          if (connectBtn) {
            connectBtn.classList.add('hidden');
            connectBtn.onclick = null;
          }
          if (ghStatus) ghStatus.textContent = '—';
        }
        if (hostedGhHint) {
          const vd = s.vault_path_display || '';
          hostedGhHint.classList.toggle('hidden', !(String(vd).toLowerCase() === 'canister' && s.github_connect_available));
        }
        const hostedRepoSection = el('settings-hosted-backup-repo-section');
        const hostedRepoInput = el('settings-hosted-repo');
        if (hostedRepoSection) {
          hostedRepoSection.classList.toggle('hidden', !(isHosted && s.github_connect_available));
        }
        if (hostedRepoInput && isHosted && s.github_connect_available) {
          if (!hostedRepoInput.value.trim()) {
            hostedRepoInput.value = (s.repo && String(s.repo)) || localStorage.getItem(HOSTED_BACKUP_REPO_LS) || '';
          }
          if (!hostedRepoInput.dataset.knowtationBound) {
            hostedRepoInput.dataset.knowtationBound = '1';
            hostedRepoInput.addEventListener('input', () => {
              const syncBtn = el('btn-settings-sync');
              if (!syncBtn || !lastBackupSettingsPayload) return;
              const vd = lastBackupSettingsPayload.vault_path_display || '';
              const ih = (vd + '').toLowerCase() === 'canister';
              if (ih && lastBackupSettingsPayload.github_connect_available) {
                const vg = lastBackupSettingsPayload.vault_git || {};
                syncBtn.disabled = settingsSyncDisabled(lastBackupSettingsPayload, vg, ih);
              }
            });
          }
        }
        const ed = s.embedding_display || {};
        if (el('agents-embedding-provider')) el('agents-embedding-provider').textContent = ed.provider || '—';
        if (el('agents-embedding-model')) el('agents-embedding-model').textContent = ed.model || '—';
        const ollamaRow = el('agents-ollama-row');
        if (ollamaRow) ollamaRow.style.display = ed.provider === 'ollama' ? '' : 'none';
        if (el('agents-embedding-ollama-url')) el('agents-embedding-ollama-url').textContent = ed.ollama_url || '—';
        const apiRow = el('settings-api-base-row');
        const apiDisp = el('settings-api-base-display');
        if (apiRow && apiDisp) {
          if (isLocalHubHostname()) {
            apiRow.classList.remove('hidden');
            apiDisp.textContent = apiBase;
          } else {
            apiRow.classList.add('hidden');
          }
        }
        refreshApiBaseFootgunBanner();
        void refreshBulkDeletePresetDropdowns();
      })
      .catch(() => {
        const hostedGhHint = el('settings-hosted-connect-github-hint');
        if (hostedGhHint) hostedGhHint.classList.add('hidden');
        const roleEl = el('settings-role-display');
        if (roleEl) roleEl.textContent = '—';
        const userIdEl = el('settings-user-id');
        if (userIdEl) userIdEl.textContent = '—';
        if (el('settings-mode-display')) el('settings-mode-display').textContent = '—';
        el('settings-vault-display').textContent = '—';
        el('settings-git-status').textContent = 'Could not load';
        const evalReqErr = el('settings-proposal-eval-required');
        if (evalReqErr) evalReqErr.textContent = '—';
        const hintsErr = el('settings-proposal-hints-enabled');
        if (hintsErr) hintsErr.textContent = '—';
        const evApErr = el('settings-evaluator-may-approve');
        if (evApErr) evApErr.textContent = '—';
        const configureSection = el('settings-configure-backup-section');
        const configureHr = el('settings-hr-configure');
        if (configureSection) configureSection.style.display = '';
        if (configureHr) configureHr.style.display = '';
        const ghStatus = el('settings-github-status');
        if (ghStatus) ghStatus.textContent = '—';
        if (el('btn-settings-sync')) el('btn-settings-sync').disabled = true;
        const apiRowErr = el('settings-api-base-row');
        const apiDispErr = el('settings-api-base-display');
        if (apiRowErr && apiDispErr && isLocalHubHostname()) {
          apiRowErr.classList.remove('hidden');
          apiDispErr.textContent = apiBase;
        }
        refreshApiBaseFootgunBanner();
      });
    api('/api/v1/setup')
      .then((u) => {
        if (el('setup-vault-path')) el('setup-vault-path').value = u.vault_path || '';
        if (el('setup-git-enabled')) el('setup-git-enabled').checked = !!(u.vault_git && u.vault_git.enabled);
        if (el('setup-git-remote')) el('setup-git-remote').value = (u.vault_git && u.vault_git.remote) || '';
      })
      .catch(() => {});
  }
  function closeSettings() {
    el('modal-settings').classList.add('hidden');
  }
  function openSettingsBillingTab() {
    openSettings();
    document.querySelectorAll('.settings-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.settingsTab === 'billing');
      t.setAttribute('aria-selected', t.dataset.settingsTab === 'billing' ? 'true' : 'false');
    });
    document.querySelectorAll('.settings-panel').forEach((p) => {
      p.classList.toggle('active', p.id === 'settings-panel-billing');
    });
    loadBillingPanel();
  }

  function openSettingsIntegrationsTab() {
    openSettings();
    document.querySelectorAll('.settings-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.settingsTab === 'integrations');
      t.setAttribute('aria-selected', t.dataset.settingsTab === 'integrations' ? 'true' : 'false');
    });
    document.querySelectorAll('.settings-panel').forEach((p) => {
      p.classList.toggle('active', p.id === 'settings-panel-integrations');
    });
    refreshIntegApiStatus();
    applyMuseBridgePanel(lastBackupSettingsPayload);
  }

  if (btnSettings) btnSettings.onclick = openSettings;

  const btnSettingsSetupGuide = el('btn-settings-setup-guide');
  if (btnSettingsSetupGuide) {
    btnSettingsSetupGuide.addEventListener('click', () => {
      closeSettings();
      void openOnboardingWizard({ restart: true });
    });
  }

  const btnProposalPolicySave = el('btn-proposal-policy-save');
  if (btnProposalPolicySave && !btnProposalPolicySave.dataset.knowtationPolicyBound) {
    btnProposalPolicySave.dataset.knowtationPolicyBound = '1';
    btnProposalPolicySave.addEventListener('click', async () => {
      const msg = el('settings-proposal-policy-msg');
      if (msg) {
        msg.textContent = '';
        msg.className = 'settings-msg';
      }
      try {
        await api('/api/v1/settings/proposal-policy', {
          method: 'POST',
          body: JSON.stringify({
            proposal_evaluation_required: el('settings-policy-eval').checked,
            review_hints_enabled: el('settings-policy-hints').checked,
            enrich_enabled: el('settings-policy-enrich').checked,
          }),
        });
        if (msg) {
          msg.textContent = 'Saved.';
          msg.className = 'settings-msg ok';
        }
        const fresh = await fetchSettingsForBackupModal();
        applySettingsPayloadToHubChrome(fresh);
        const evalReqEl = el('settings-proposal-eval-required');
        if (evalReqEl) evalReqEl.textContent = fresh.proposal_evaluation_required ? 'On' : 'Off';
        const hintsEl2 = el('settings-proposal-hints-enabled');
        if (hintsEl2) hintsEl2.textContent = fresh.proposal_review_hints_enabled ? 'On' : 'Off';
        const enrichEl2 = el('settings-proposal-enrich-enabled');
        if (enrichEl2) enrichEl2.textContent = fresh.proposal_enrich_enabled ? 'On' : 'Off';
        const st = fresh.proposal_policy_stored || {};
        const lk = fresh.proposal_policy_env_locked || {};
        const ce = el('settings-policy-eval');
        const ch = el('settings-policy-hints');
        const cr = el('settings-policy-enrich');
        if (ce && ch && cr) {
          ce.checked = Boolean(st.proposal_evaluation_required);
          ch.checked = Boolean(st.review_hints_enabled);
          cr.checked = Boolean(st.enrich_enabled);
          ce.disabled = Boolean(lk.proposal_evaluation_required);
          ch.disabled = Boolean(lk.review_hints_enabled);
          cr.disabled = Boolean(lk.enrich_enabled);
          const lockHint =
            'Fixed by a server environment variable; change or unset it on the host to control this from here.';
          ce.title = lk.proposal_evaluation_required ? lockHint : '';
          ch.title = lk.review_hints_enabled ? lockHint : '';
          cr.title = lk.enrich_enabled ? lockHint : '';
        }
      } catch (e) {
        if (msg) {
          msg.textContent = e && e.message ? String(e.message) : String(e);
          msg.className = 'settings-msg err';
        }
      }
    });
  }
  el('modal-settings-backdrop').onclick = closeSettings;
  el('modal-settings-close').onclick = closeSettings;

  el('btn-copy-env-agentception').onclick = () => {
    const provider = (el('agents-embedding-provider') && el('agents-embedding-provider').textContent) || '';
    const model = (el('agents-embedding-model') && el('agents-embedding-model').textContent) || '';
    const ollamaUrl = (el('agents-embedding-ollama-url') && el('agents-embedding-ollama-url').textContent) || '';
    const lines = [];
    if (provider === 'ollama' && ollamaUrl && ollamaUrl !== '—') {
      lines.push('OLLAMA_BASE_URL=' + ollamaUrl.trim());
    }
    lines.push('# Embedding model: ' + (model !== '—' ? model : 'nomic-embed-text'));
    const snippet = lines.join('\n');
    const msg = el('agents-copy-msg');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(snippet).then(() => {
        if (msg) { msg.textContent = 'Embedding env copied.'; msg.className = 'settings-msg'; }
        setTimeout(() => { if (msg) msg.textContent = ''; }, 2000);
      }).catch(() => {
        if (msg) { msg.textContent = 'Copy failed'; msg.className = 'settings-msg err'; }
      });
    } else {
      if (msg) { msg.textContent = 'Clipboard not available'; msg.className = 'settings-msg err'; }
    }
  };

  function refreshIntegApiStatus() {
    var dot = el('integ-api-status');
    if (!dot) return;
    var hasToken = Boolean(token || (typeof localStorage !== 'undefined' && localStorage.getItem('hub_token')));
    dot.classList.toggle('active', hasToken);
    dot.title = hasToken ? 'Token available — signed in' : 'No token — sign in to enable';
  }

  const btnCopyMcpPrime = el('btn-copy-mcp-prime');
  if (btnCopyMcpPrime) {
    btnCopyMcpPrime.onclick = () => {
      const base = String(apiBase || '').replace(/\/$/, '');
      const vaultId = getCurrentVaultId() || 'default';
      const msg = el('integrations-hub-api-copy-msg');
      const payload = {
        schema: 'knowtation.hub_copy_prime/v1',
        mcp_read_resource_uri: 'knowtation://hosted/prime',
        instructions:
          'Point your MCP client at {KNOWTATION_HUB_URL}/mcp with Authorization and X-Vault-Id (see docs/AGENT-INTEGRATION.md). After connect, resources/read mcp_read_resource_uri for vault partition, role, and prompt names for this session — no JWT in this blob.',
        KNOWTATION_HUB_URL: base,
        KNOWTATION_HUB_VAULT_ID: vaultId,
      };
      const snippet = JSON.stringify(payload, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(snippet).then(() => {
          if (msg) {
            msg.textContent = 'Copied prime (URI + hub URL + vault id; no JWT).';
            msg.className = 'settings-msg';
          }
          setTimeout(() => {
            if (msg) msg.textContent = '';
          }, 2800);
        }).catch(() => {
          if (msg) {
            msg.textContent = 'Copy failed';
            msg.className = 'settings-msg err';
          }
        });
      } else if (msg) {
        msg.textContent = 'Clipboard not available';
        msg.className = 'settings-msg err';
      }
    };
  }

  const btnCopyHubApiEnv = el('btn-copy-hub-api-env');
  if (btnCopyHubApiEnv) {
    btnCopyHubApiEnv.onclick = () => {
      const hubTok = (typeof localStorage !== 'undefined' && localStorage.getItem('hub_token')) || token || '';
      const vaultId = getCurrentVaultId() || 'default';
      const base = String(apiBase || '').replace(/\/$/, '');
      const msg = el('integrations-hub-api-copy-msg');
      if (!hubTok) {
        if (msg) {
          msg.textContent = 'Sign in first, then copy again.';
          msg.className = 'settings-msg err';
        }
        return;
      }
      const snippet =
        'KNOWTATION_HUB_URL=' +
        base +
        '\n' +
        'KNOWTATION_HUB_TOKEN=' +
        hubTok +
        '\n' +
        'KNOWTATION_HUB_VAULT_ID=' +
        vaultId +
        '\n' +
        '# curl: add -H "Authorization: Bearer $KNOWTATION_HUB_TOKEN" -H "Content-Type: application/json" -H "X-Vault-Id: $KNOWTATION_HUB_VAULT_ID"';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(snippet).then(() => {
          if (msg) {
            msg.textContent = 'Copied URL, token, and vault id.';
            msg.className = 'settings-msg';
          }
          refreshIntegApiStatus();
          setTimeout(() => {
            if (msg) msg.textContent = '';
          }, 2500);
        }).catch(() => {
          if (msg) {
            msg.textContent = 'Copy failed';
            msg.className = 'settings-msg err';
          }
        });
      } else if (msg) {
        msg.textContent = 'Clipboard not available';
        msg.className = 'settings-msg err';
      }
    };
  }

  const btnSettingsMuseSave = el('btn-settings-muse-save');
  if (btnSettingsMuseSave && !btnSettingsMuseSave.dataset.knowtationMuseBound) {
    btnSettingsMuseSave.dataset.knowtationMuseBound = '1';
    btnSettingsMuseSave.addEventListener('click', async () => {
      const msg = el('settings-muse-msg');
      if (msg) {
        msg.textContent = '';
        msg.className = 'settings-msg';
      }
      const input = el('settings-muse-url');
      const url = input ? String(input.value || '').trim() : '';
      await withButtonBusy(btnSettingsMuseSave, 'Saving…', async () => {
        try {
          await api('/api/v1/settings/muse', {
            method: 'POST',
            body: JSON.stringify({ url }),
          });
          if (msg) {
            msg.textContent = 'Saved.';
            msg.className = 'settings-msg ok';
          }
          const s = await api('/api/v1/settings');
          applySettingsPayloadToHubChrome(s);
        } catch (e) {
          if (msg) {
            msg.textContent =
              e && e.code === 'ENV_CONFLICT'
                ? 'MUSE_URL is set on the server; unset it to save from Settings.'
                : (e && e.message) || 'Save failed';
            msg.className = 'settings-msg err';
          }
        }
      });
    });
  }

  document.querySelectorAll('.settings-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const id = tab.dataset.settingsTab;
      document.querySelectorAll('.settings-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.settingsTab === id);
        t.setAttribute('aria-selected', t.dataset.settingsTab === id ? 'true' : 'false');
      });
      document.querySelectorAll('.settings-panel').forEach((p) => {
        p.classList.toggle('active', p.id === 'settings-panel-' + id);
      });
      if (id === 'team') {
        loadTeamRolesList();
        loadInvitesList();
      }
      if (id === 'vaults') loadVaultsPanel();
      if (id === 'billing') loadBillingPanel();
      if (id === 'backup') void refreshBulkDeletePresetDropdowns();
      if (id === 'consolidation') loadConsolidationSettings();
      if (id === 'integrations') applyMuseBridgePanel(lastBackupSettingsPayload);
    });
  });

  function formatTokenCount(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    return Number(n).toLocaleString();
  }

  function formatTokenCountShort(n) {
    if (n == null || !Number.isFinite(Number(n))) return '—';
    const v = Number(n);
    if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(1) + 'B';
    if (v >= 1_000_000) return (v / 1_000_000).toFixed(0) + 'M';
    if (v >= 1_000) return (v / 1_000).toFixed(0) + 'K';
    return String(v);
  }

  /**
   * Update the token usage progress bar.
   * @param {number} used - tokens used this period
   * @param {number|null} included - tokens included (null = unlimited)
   */
  function updateUsageBar(fillId, used, included) {
    const fill = el(fillId);
    if (!fill) return;
    if (included == null) {
      fill.style.width = '15%';
      fill.className = 'billing-usage-bar-fill';
      return;
    }
    const pct = included > 0 ? Math.min(100, Math.round((used / included) * 100)) : 0;
    fill.style.width = pct + '%';
    fill.className =
      'billing-usage-bar-fill' + (pct >= 100 ? ' over' : pct >= 80 ? ' warn' : '');
  }

  const TIER_LABELS = {
    free: 'Free',
    plus: 'Plus',
    growth: 'Growth',
    pro: 'Pro',
    beta: 'Beta',
    starter: 'Plus',
    team: 'Team',
  };

  const TIER_CSS_CLASSES = {
    free: 'tier-free',
    plus: 'tier-plus',
    growth: 'tier-growth',
    pro: 'tier-pro',
    beta: 'tier-beta',
    starter: 'tier-plus',
    team: 'tier-pro',
  };

  const TIER_ORDER = ['free', 'plus', 'growth', 'pro'];

  const TIER_PLAN_DATA = [
    { tier: 'free',   price: 'Free',   searches: '100 searches/mo',       indexJobs: '5 index jobs/mo',        notes: '200 notes',       consolidations: null },
    { tier: 'plus',   price: '$9/mo',  searches: '2,000 searches/mo',     indexJobs: '50 index jobs/mo',       notes: '2,000 notes',     consolidations: '30 memory consolidations/mo' },
    { tier: 'growth', price: '$17/mo', searches: '8,000 searches/mo',     indexJobs: '200 index jobs/mo',      notes: '5,000 notes',     consolidations: '100 memory consolidations/mo' },
    { tier: 'pro',    price: '$25/mo', searches: 'Unlimited searches',    indexJobs: 'Unlimited index jobs',   notes: 'Unlimited notes', consolidations: '300 memory consolidations/mo' },
  ];

  /** Monthly consolidation pass limit by tier (mirrors billing-constants.mjs). */
  const CONSOLIDATION_PASSES_BY_TIER = { free: 0, plus: 30, starter: 30, growth: 100, pro: 300, beta: null };

  /**
   * Render the plan comparison grid into #billing-plan-grid.
   * Highlights the current tier, shows upgrade CTAs for higher tiers, no downgrade buttons.
   */
  function renderBillingPlanGrid(currentTier, hasSub, stripeConfigured) {
    const grid = el('billing-plan-grid');
    if (!grid) return;

    const normalized =
      currentTier === 'starter' ? 'plus'
      : (currentTier === 'beta' || !TIER_ORDER.includes(currentTier)) ? 'free'
      : currentTier;
    const currentRank = TIER_ORDER.indexOf(normalized);

    const cards = TIER_PLAN_DATA.map(({ tier, price, searches, indexJobs, notes, consolidations }) => {
      const rank = TIER_ORDER.indexOf(tier);
      const isCurrent = rank === currentRank;
      const isUpgrade = rank > currentRank && stripeConfigured && tier !== 'free';

      let ctaHtml = '';
      if (isCurrent) {
        ctaHtml = '<span class="billing-plan-current-badge">Current plan</span>';
      } else if (isUpgrade) {
        const label = hasSub
          ? 'Upgrade to ' + (TIER_LABELS[tier] || tier) + ' \u2192'
          : 'Get ' + (TIER_LABELS[tier] || tier) + ' \u2192';
        ctaHtml =
          '<button type="button" class="billing-plan-upgrade-btn" data-tier="' +
          tier + '">' + label + '</button>';
      }

      const packLine = tier !== 'free' ? '<li>Token packs available</li>' : '';
      const consolLine = consolidations ? '<li>' + consolidations + '</li>' : '';

      return (
        '<div class="billing-plan-card' + (isCurrent ? ' billing-plan-card-active' : '') + '">' +
          '<div class="billing-plan-card-header">' +
            '<span class="billing-plan-card-name">' + (TIER_LABELS[tier] || tier) + '</span>' +
            '<span class="billing-plan-card-price">' + price + '</span>' +
          '</div>' +
          '<ul class="billing-plan-card-features">' +
            '<li>' + searches + '</li>' +
            '<li>' + indexJobs + '</li>' +
            '<li>' + notes + '</li>' +
            consolLine +
            packLine +
          '</ul>' +
          '<div class="billing-plan-card-cta">' + ctaHtml + '</div>' +
        '</div>'
      );
    });

    grid.innerHTML = cards.join('');

    grid.querySelectorAll('.billing-plan-upgrade-btn[data-tier]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const tier = btn.dataset.tier;
        setButtonBusy(btn, true, 'Redirecting\u2026');
        try {
          await redirectToCheckout({ tier });
        } catch (e) {
          setButtonBusy(btn, false);
          const msg = el('billing-panel-msg');
          if (msg) { msg.textContent = e?.message || 'Could not start checkout.'; msg.className = 'settings-intro small err'; }
        }
      });
    });
  }

  /**
   * Redirect to Stripe Checkout for the given price_id (or tier shorthand).
   * @param {{ price_id?: string, tier?: string }} opts
   */
  async function redirectToCheckout(opts) {
    const resp = await api('/api/v1/billing/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...opts,
        success_url: window.location.origin + window.location.pathname + '?open=billing&checkout=success',
        cancel_url: window.location.origin + window.location.pathname + '?open=billing',
      }),
    });
    if (resp && resp.url) {
      window.location.href = resp.url;
    }
  }

  /**
   * Redirect to Stripe Customer Portal.
   */
  async function redirectToPortal() {
    const resp = await api('/api/v1/billing/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        return_url: window.location.origin + window.location.pathname + '?open=billing',
      }),
    });
    const url = resp && typeof resp.url === 'string' ? resp.url.trim() : '';
    if (!url) {
      throw new Error(
        'Billing portal did not return a URL. In Stripe Dashboard → Settings → Customer portal, activate the portal and save.',
      );
    }
    window.location.assign(url);
  }

  async function loadBillingPanel() {
    const msg = el('billing-panel-msg');
    const tierEl = el('billing-tier');
    const searchesUsedEl = el('billing-searches-used');
    const searchesIncEl = el('billing-searches-included');
    const indexJobsUsedEl = el('billing-index-jobs-used');
    const indexJobsIncEl = el('billing-index-jobs-included');
    const packEl = el('billing-pack-balance');
    const packRow = el('billing-pack-balance-row');
    const periodEl = el('billing-period');
    const renewalEl = el('billing-renewal');
    const credEl = el('billing-credits-used');
    const credRow = el('billing-credits-row');
    const polEl = el('billing-indexing-policy');
    const noteCap = el('billing-note-cap');
    const refreshBtn = el('btn-billing-refresh');
    const upgradeBtn = el('btn-billing-upgrade');
    const manageBtn = el('btn-billing-manage');
    const packSection = el('billing-pack-section');
    if (!tierEl || !searchesUsedEl) return;
    if (msg) msg.textContent = '';
    if (refreshBtn) setButtonBusy(refreshBtn, true, 'Loading…');

    const setDash = () => {
      tierEl.textContent = '—';
      tierEl.className = 'billing-plan-badge tier-beta';
      if (searchesUsedEl) searchesUsedEl.textContent = '—';
      if (searchesIncEl) searchesIncEl.textContent = '—';
      if (indexJobsUsedEl) indexJobsUsedEl.textContent = '—';
      if (indexJobsIncEl) indexJobsIncEl.textContent = '—';
      if (packEl) packEl.textContent = '0';
      if (packRow) packRow.style.display = 'none';
      if (periodEl) periodEl.textContent = '—';
      if (renewalEl) renewalEl.textContent = '';
      if (credEl) credEl.textContent = '—';
      if (credRow) credRow.style.display = 'none';
      if (polEl) { polEl.textContent = ''; polEl.style.display = 'none'; }
      if (noteCap) noteCap.textContent = '—';
      if (packSection) packSection.style.display = 'none';
      if (upgradeBtn) upgradeBtn.style.display = 'none';
      if (manageBtn) manageBtn.style.display = 'none';
      updateUsageBar('billing-searches-bar-fill', 0, 0);
      updateUsageBar('billing-index-jobs-bar-fill', 0, 0);
      updateUsageBar('billing-consol-bar-fill', 0, 0);
      const consolUsedReset = el('billing-consol-used');
      const consolIncReset = el('billing-consol-included');
      if (consolUsedReset) consolUsedReset.textContent = '—';
      if (consolIncReset) consolIncReset.textContent = '—';
      renderBillingPlanGrid('beta', false, false);
    };

    if (!token) {
      setDash();
      if (msg) msg.textContent = 'Sign in to view billing usage.';
      if (refreshBtn) setButtonBusy(refreshBtn, false);
      return;
    }

    try {
      const d = await api('/api/v1/billing/summary');
      const tier = d.tier != null ? String(d.tier) : 'beta';

      // Plan badge
      tierEl.textContent = TIER_LABELS[tier] || tier;
      tierEl.className = 'billing-plan-badge ' + (TIER_CSS_CLASSES[tier] || 'tier-beta');

      // Renewal date
      if (renewalEl) {
        const pe = d.period_end;
        renewalEl.textContent = pe ? 'renews ' + String(pe).slice(0, 10) : '';
      }

      // Plan comparison grid
      const hasSub = Boolean(d.has_active_subscription);
      const isFreeTier = tier === 'free' || tier === 'beta';
      renderBillingPlanGrid(tier, hasSub, Boolean(d.stripe_configured));

      // Legacy upgrade button stays hidden (grid handles upgrades now)
      if (upgradeBtn) upgradeBtn.style.display = 'none';
      // Manage button: visible for active subscribers to reach the Stripe portal
      if (manageBtn) manageBtn.style.display = (hasSub && d.stripe_configured) ? '' : 'none';

      // Searches usage bar
      const searchesUsed = Math.max(0, Math.floor(Number(d.monthly_searches_used) || 0));
      const searchesInc = d.monthly_searches_included ?? null;
      if (searchesUsedEl) searchesUsedEl.textContent = searchesUsed.toLocaleString();
      if (searchesIncEl) searchesIncEl.textContent = searchesInc == null ? 'Unlimited' : searchesInc.toLocaleString();
      updateUsageBar('billing-searches-bar-fill', searchesUsed, searchesInc);

      // Index jobs usage bar
      const indexJobsUsed = Math.max(0, Math.floor(Number(d.monthly_index_jobs_used) || 0));
      const indexJobsInc = d.monthly_index_jobs_included ?? null;
      if (indexJobsUsedEl) indexJobsUsedEl.textContent = indexJobsUsed.toLocaleString();
      if (indexJobsIncEl) indexJobsIncEl.textContent = indexJobsInc == null ? 'Unlimited' : indexJobsInc.toLocaleString();
      updateUsageBar('billing-index-jobs-bar-fill', indexJobsUsed, indexJobsInc);

      // Consolidation jobs usage bar
      const consolUsed = Math.max(0, Math.floor(Number(d.monthly_consolidation_jobs_used) || 0));
      const consolInc = d.monthly_consolidation_jobs_included ?? null;
      const consolUsedEl = el('billing-consol-used');
      const consolIncEl = el('billing-consol-included');
      if (consolUsedEl) consolUsedEl.textContent = consolUsed.toLocaleString();
      if (consolIncEl) consolIncEl.textContent = consolInc == null ? 'Unlimited' : consolInc.toLocaleString();
      updateUsageBar('billing-consol-bar-fill', consolUsed, consolInc);

      // Pack balance
      const packBal = Math.max(0, Math.floor(Number(d.pack_indexing_tokens_balance) || 0));
      const packConsolPasses = Math.max(0, Math.floor(Number(d.pack_consolidation_passes_balance) || 0));
      if (packEl) {
        // Show token count + equivalent index jobs and searches (50K tokens/job, 1K tokens/search).
        const packIndexJobs = Math.floor(packBal / 50_000).toLocaleString();
        const packSearches = Math.floor(packBal / 1_000).toLocaleString();
        let packText = formatTokenCountShort(packBal) +
          ' rollover tokens (\u2248\u00a0' + packIndexJobs + ' index jobs or ' + packSearches + ' searches)';
        if (packConsolPasses > 0) {
          packText += ' + ' + packConsolPasses.toLocaleString() + ' consolidation pass' + (packConsolPasses === 1 ? '' : 'es');
        }
        packEl.textContent = packText;
      }
      if (packRow) packRow.style.display = (packBal > 0 || packConsolPasses > 0) ? '' : 'none';

      // Period
      if (periodEl) {
        const ps = d.period_start;
        const pe = d.period_end;
        periodEl.textContent = ps && pe ? `${String(ps).slice(0, 10)} → ${String(pe).slice(0, 10)}` : '—';
      }

      // Note cap
      if (noteCap) {
        noteCap.textContent = d.note_cap == null ? 'Unlimited' : d.note_cap.toLocaleString() + ' max';
      }

      // Legacy credits row (only show if non-zero)
      const mu = Number(d.monthly_used_cents) || 0;
      const mi = Number(d.monthly_included_effective_cents) || 0;
      if (credRow) credRow.style.display = 'none'; // legacy cents ledger not surfaced in UI
      if (credEl && (mu > 0 || mi > 0)) {
        credEl.textContent = `${(mu / 100).toFixed(2)} / ${(mi / 100).toFixed(2)} credits`;
      }

      // Token policy
      if (polEl) {
        const pol = d.indexing_tokens_policy;
        if (pol && String(pol).trim()) {
          polEl.textContent = String(pol).trim();
          polEl.style.display = '';
        } else {
          polEl.style.display = 'none';
        }
      }

      // Pack section: only show pack purchase when Stripe is configured and user has a paid plan
      if (packSection) {
        const showPacks = d.stripe_configured && !isFreeTier && hasSub;
        packSection.style.display = showPacks ? '' : 'none';
      }

      if (msg) {
        msg.textContent = '';
        msg.className = 'settings-intro small muted';
      }
    } catch (e) {
      setDash();
      const m = e && e.message ? String(e.message) : String(e);
      if (msg) {
        msg.textContent =
          /\b404\b|Not\s*Found/i.test(m) || /cannot (GET|POST)/i.test(m)
            ? 'Billing summary is only available on the hosted gateway (not this self-hosted Hub).'
            : m;
        msg.className = 'settings-intro small err';
      }
    }
    if (refreshBtn) setButtonBusy(refreshBtn, false);
  }

  const btnBillingRefresh = el('btn-billing-refresh');
  if (btnBillingRefresh) {
    btnBillingRefresh.addEventListener('click', () => loadBillingPanel());
  }

  const btnBillingUpgrade = el('btn-billing-upgrade');
  if (btnBillingUpgrade) {
    btnBillingUpgrade.addEventListener('click', async () => {
      setButtonBusy(btnBillingUpgrade, true, 'Redirecting…');
      try {
        await redirectToCheckout({ tier: 'plus' });
      } catch (e) {
        setButtonBusy(btnBillingUpgrade, false);
        const packMsg = el('billing-panel-msg');
        if (packMsg) { packMsg.textContent = e?.message || 'Could not start checkout.'; packMsg.className = 'settings-intro small err'; }
      }
    });
  }

  const btnBillingManage = el('btn-billing-manage');
  if (btnBillingManage) {
    btnBillingManage.addEventListener('click', async () => {
      const panelMsg = el('billing-panel-msg');
      if (panelMsg) {
        panelMsg.textContent = '';
        panelMsg.className = 'settings-intro small muted';
      }
      setButtonBusy(btnBillingManage, true, 'Redirecting…');
      try {
        await redirectToPortal();
      } catch (e) {
        setButtonBusy(btnBillingManage, false);
        const errText = e?.message || 'Could not open billing portal.';
        if (panelMsg) {
          panelMsg.textContent = errText;
          panelMsg.className = 'settings-intro small err';
          panelMsg.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    });
  }

  // Token pack purchase buttons
  document.querySelectorAll('.billing-pack-card[data-pack]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pack = btn.dataset.pack;
      const packMsgEl = el('billing-pack-msg');
      setButtonBusy(btn, true, 'Redirecting…');
      if (packMsgEl) packMsgEl.textContent = '';
      try {
        await redirectToCheckout({ pack_size: pack });
      } catch (e) {
        setButtonBusy(btn, false);
        if (packMsgEl) { packMsgEl.textContent = e?.message || 'Could not start checkout.'; }
      }
    });
  });

  /** Human-readable vault list (no raw JSON) — full JSON stays under Advanced. */
  function buildVaultListSummaryInnerHtml(vaults, isHosted) {
    const arr = Array.isArray(vaults) ? vaults : [];
    if (arr.length === 0) {
      return isHosted
        ? '<p class="muted small">No extra cloud vaults yet beyond <code>default</code> until you add another vault id.</p>'
        : '<p class="muted small">No vaults yet — use the form below or <strong>Advanced</strong> JSON, then <strong>Save vault list</strong>.</p>';
    }
    const items = arr
      .map((v) => {
        if (!v || v.id == null) return '';
        const id = escapeHtml(String(v.id).trim());
        const lab =
          v.label != null && String(v.label).trim()
            ? ' <span class="muted">(' + escapeHtml(String(v.label).trim()) + ')</span>'
            : '';
        const pathRaw = v.path != null && String(v.path).trim() ? String(v.path).trim() : '';
        const pathHtml = pathRaw
          ? escapeHtml(pathRaw)
          : '<span class="muted">—</span>';
        return (
          '<li class="vaults-summary-item"><div><code class="vaults-summary-code">' +
          id +
          '</code>' +
          lab +
          '</div><div class="vaults-summary-path muted small">' +
          pathHtml +
          '</div></li>'
        );
      })
      .filter(Boolean)
      .join('');
    return '<ul class="settings-vaults-summary-list">' + items + '</ul>';
  }

  function collectVaultIdsForAccessForm(vaults, settingsRes) {
    const set = new Set(['default']);
    const allowed =
      settingsRes && Array.isArray(settingsRes.allowed_vault_ids) ? settingsRes.allowed_vault_ids : [];
    allowed.forEach((id) => {
      if (id != null && String(id).trim()) set.add(String(id).trim());
    });
    (vaults || []).forEach((v) => {
      if (v && v.id != null && String(v.id).trim()) set.add(String(v.id).trim());
    });
    return Array.from(set).sort((a, b) => {
      if (a === 'default') return -1;
      if (b === 'default') return 1;
      return a.localeCompare(b);
    });
  }

  function populateHostedTeamUserSelect(selectEl, roleIds, currentUserId, emptyLabel) {
    if (!selectEl) return;
    const uids = new Set();
    (roleIds || []).forEach((id) => {
      if (id != null && String(id).trim()) uids.add(String(id).trim());
    });
    if (currentUserId != null && String(currentUserId).trim()) {
      uids.add(String(currentUserId).trim());
    }
    const sorted = Array.from(uids).sort((a, b) => a.localeCompare(b));
    let html = '<option value="">' + escapeHtml(emptyLabel || '— Choose —') + '</option>';
    sorted.forEach((uid) => {
      html += '<option value="' + escapeHtml(uid) + '">' + escapeHtml(uid) + '</option>';
    });
    html += '<option value="__other__">' + escapeHtml('Someone else (type User ID)…') + '</option>';
    selectEl.innerHTML = html;
  }

  function renderAccessVaultCheckboxes(vaultIds) {
    const wrap = el('access-form-vault-checkboxes');
    if (!wrap) return;
    if (!vaultIds.length) {
      wrap.innerHTML =
        '<span class="muted small">No vault ids yet — use <code>default</code> or create another vault above.</span>';
      return;
    }
    wrap.innerHTML = vaultIds
      .map((id) => {
        const idAttr = escapeHtml(id);
        return (
          '<label><input type="checkbox" name="hub-access-vault" value="' +
          idAttr +
          '"> <code>' +
          idAttr +
          '</code></label>'
        );
      })
      .join('');
  }

  function parseVaultAccessFromTextarea() {
    const accessText = el('vault-access-json');
    try {
      const access = JSON.parse((accessText && accessText.value) || '{}');
      return typeof access === 'object' && access !== null && !Array.isArray(access) ? access : {};
    } catch (_) {
      return {};
    }
  }

  function refreshAccessRulesSummary(access) {
    const wrap = el('access-rules-summary');
    if (!wrap) return;
    if (typeof access !== 'object' || access === null) access = {};
    const keys = Object.keys(access);
    if (keys.length === 0) {
      wrap.innerHTML =
        '<li class="muted">No custom rules. Unlisted users only get the <code>default</code> vault.</li>';
      return;
    }
    wrap.innerHTML = keys
      .sort((a, b) => a.localeCompare(b))
      .map((uid) => {
        const arr = access[uid];
        const vaults =
          Array.isArray(arr) && arr.length
            ? arr.map((x) => escapeHtml(String(x))).join(', ')
            : '<span class="muted">(invalid)</span>';
        return '<li><code>' + escapeHtml(uid) + '</code> → ' + vaults + '</li>';
      })
      .join('');
  }

  function accessFormToggleOtherInput() {
    const sel = el('access-form-user-select');
    const wrap = el('access-form-user-other-wrap');
    const other = el('access-form-user-other');
    if (!sel || !wrap) return;
    const show = sel.value === '__other__';
    wrap.classList.toggle('hidden', !show);
    if (!show && other) other.value = '';
  }

  function accessFormSyncCheckboxesFromAccessJson() {
    const sel = el('access-form-user-select');
    const other = el('access-form-user-other');
    if (!sel) return;
    let uid = '';
    if (sel.value === '__other__') {
      uid = ((other && other.value) || '').trim();
    } else {
      uid = (sel.value || '').trim();
    }
    const access = parseVaultAccessFromTextarea();
    const allowed = uid && Array.isArray(access[uid]) ? access[uid] : [];
    document.querySelectorAll('input[name="hub-access-vault"]').forEach((cb) => {
      cb.checked = allowed.indexOf(cb.value) !== -1;
    });
  }

  function getAccessFormResolvedUserId() {
    const sel = el('access-form-user-select');
    const other = el('access-form-user-other');
    if (!sel) return '';
    if (sel.value === '__other__') return ((other && other.value) || '').trim();
    return (sel.value || '').trim();
  }

  const accessUserSel = el('access-form-user-select');
  if (accessUserSel) {
    accessUserSel.addEventListener('change', () => {
      accessFormToggleOtherInput();
      accessFormSyncCheckboxesFromAccessJson();
    });
  }
  const accessUserOther = el('access-form-user-other');
  if (accessUserOther) {
    accessUserOther.addEventListener('input', () => {
      if (el('access-form-user-select') && el('access-form-user-select').value === '__other__') {
        accessFormSyncCheckboxesFromAccessJson();
      }
    });
  }
  const scopeUserSelInit = el('scope-form-user-select');
  if (scopeUserSelInit) {
    scopeUserSelInit.addEventListener('change', () => {
      const inp = el('scope-form-user-id');
      if (scopeUserSelInit.value === '__other__') {
        if (inp) inp.focus();
      } else if (scopeUserSelInit.value && inp) {
        inp.value = scopeUserSelInit.value;
      }
    });
  }

  function populateVaultListExistingSelect(vaults) {
    const sel = el('vault-list-form-existing');
    if (!sel) return;
    let html = '<option value="">New vault</option>';
    (vaults || []).forEach((v) => {
      if (v && v.id != null && String(v.id).trim()) {
        const id = String(v.id).trim();
        html += '<option value="' + escapeHtml(id) + '">' + escapeHtml(v.label || id) + '</option>';
      }
    });
    sel.innerHTML = html;
  }

  function parseVaultsJsonArrayFromTextarea() {
    const ta = el('vaults-json');
    try {
      const arr = JSON.parse((ta && ta.value) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return null;
    }
  }

  function fillVaultListFormFromExisting() {
    const sel = el('vault-list-form-existing');
    const idInp = el('vault-list-form-id');
    const pathInp = el('vault-list-form-path');
    const labelInp = el('vault-list-form-label');
    if (!sel) return;
    if (!sel.value) {
      if (idInp) {
        idInp.value = '';
        idInp.readOnly = false;
      }
      if (pathInp) pathInp.value = '';
      if (labelInp) labelInp.value = '';
      return;
    }
    const vaults = parseVaultsJsonArrayFromTextarea();
    if (!vaults) return;
    const v = vaults.find((x) => x && String(x.id) === sel.value);
    if (v) {
      if (idInp) {
        idInp.value = String(v.id);
        idInp.readOnly = true;
      }
      if (pathInp) pathInp.value = v.path != null ? String(v.path) : '';
      if (labelInp) labelInp.value = v.label != null ? String(v.label) : '';
    }
  }

  function toggleVaultsInfoPanel(panelId) {
    const panel = el(panelId);
    const modal = el('modal-settings');
    if (!panel || !modal) return;
    const wasHidden = panel.classList.contains('hidden');
    modal.querySelectorAll('.settings-info-panel').forEach((p) => p.classList.add('hidden'));
    if (wasHidden) panel.classList.remove('hidden');
  }

  const modalSettingsForVaultsInfo = el('modal-settings');
  if (modalSettingsForVaultsInfo) {
    modalSettingsForVaultsInfo.addEventListener('click', (e) => {
      const infoBtn = e.target.closest('.btn-settings-info');
      if (infoBtn && modalSettingsForVaultsInfo.contains(infoBtn)) {
        e.stopPropagation();
        const tid = infoBtn.getAttribute('data-settings-info-target');
        if (tid) toggleVaultsInfoPanel(tid);
        return;
      }
      if (
        !e.target.closest('.settings-info-panel') &&
        !e.target.closest('.btn-settings-info')
      ) {
        modalSettingsForVaultsInfo.querySelectorAll('.settings-info-panel').forEach((p) => {
          p.classList.add('hidden');
        });
      }
    });
  }

  const vaultListExistingSel = el('vault-list-form-existing');
  if (vaultListExistingSel) {
    vaultListExistingSel.addEventListener('change', () => {
      fillVaultListFormFromExisting();
      const msg = el('vault-list-form-msg');
      if (msg) msg.textContent = '';
    });
  }

  const btnVaultListFormApply = el('btn-vault-list-form-apply');
  if (btnVaultListFormApply) {
    btnVaultListFormApply.onclick = () => {
      const msg = el('vault-list-form-msg');
      const ta = el('vaults-json');
      const idInp = el('vault-list-form-id');
      const pathInp = el('vault-list-form-path');
      const labelInp = el('vault-list-form-label');
      const vaults = parseVaultsJsonArrayFromTextarea();
      if (!vaults) {
        if (msg) {
          msg.textContent = 'Fix JSON under Advanced, or reset to [] and try again.';
          msg.className = 'settings-msg err';
        }
        return;
      }
      const id = ((idInp && idInp.value) || '').trim();
      const path = ((pathInp && pathInp.value) || '').trim();
      const label = ((labelInp && labelInp.value) || '').trim();
      if (!id || !path) {
        if (msg) {
          msg.textContent = 'Enter vault id and folder path.';
          msg.className = 'settings-msg err';
        }
        return;
      }
      const entry = { id, path };
      if (label) entry.label = label;
      const idx = vaults.findIndex((x) => x && String(x.id) === id);
      if (idx >= 0) {
        vaults[idx] = Object.assign({}, vaults[idx], entry);
      } else {
        if (idInp && idInp.readOnly) {
          if (msg) {
            msg.textContent = 'Pick an existing vault from the menu, or New vault for a new id.';
            msg.className = 'settings-msg err';
          }
          return;
        }
        vaults.push(entry);
      }
      if (ta) ta.value = JSON.stringify(vaults, null, 2);
      populateVaultListExistingSelect(vaults);
      const sel = el('vault-list-form-existing');
      if (sel) sel.value = '';
      fillVaultListFormFromExisting();
      const lc = el('vaults-list-container');
      if (lc && !isHostedHubFromSettings()) {
        lc.innerHTML = buildVaultListSummaryInnerHtml(vaults, false);
      }
      if (msg) {
        msg.textContent = 'Updated. Click Save vault list to persist.';
        msg.className = 'settings-msg ok';
      }
    };
  }

  async function loadVaultsPanel() {
    const listContainer = el('vaults-list-container');
    const serverView = el('vaults-server-view');
    const vaultsJson = el('vaults-json');
    const accessText = el('vault-access-json');
    const scopeText = el('scope-json');
      const helpHostedBlock = el('vaults-help-hosted-block');
      const helpSelfBlock = el('vaults-help-self-block');
      const selfHostedEditors = el('vaults-self-hosted-editors');
      const yamlOnly = el('vaults-hub-yaml-only');
      const hostedCreate = el('vaults-hosted-create');
      const workspacePanel = el('vaults-hosted-workspace');
      const workspaceInput = el('workspace-owner-input');
      const workspaceMsg = el('workspace-save-msg');
      if (listContainer) listContainer.textContent = 'Loading…';
      if (serverView) serverView.textContent = 'Loading…';
      try {
        const settingsRes = await api('/api/v1/settings');
        const isHosted = String(settingsRes.vault_path_display || '').toLowerCase() === 'canister';
        if (helpHostedBlock) helpHostedBlock.classList.toggle('hidden', !isHosted);
        if (helpSelfBlock) helpSelfBlock.classList.toggle('hidden', isHosted);
        if (selfHostedEditors) selfHostedEditors.classList.remove('hidden');
        if (yamlOnly) yamlOnly.classList.toggle('hidden', isHosted);
        const ownerFromSettings =
          settingsRes.workspace_owner_id != null && String(settingsRes.workspace_owner_id).trim() !== ''
            ? String(settingsRes.workspace_owner_id).trim()
            : '';
        const meFromSettings = settingsRes.user_id != null ? String(settingsRes.user_id) : '';
        const nonOwnerInSharedWorkspace = isHosted && ownerFromSettings && meFromSettings !== ownerFromSettings;
        if (hostedCreate) hostedCreate.classList.toggle('hidden', !isHosted || nonOwnerInSharedWorkspace);
        const hostedNonOwnerMsg = el('vaults-hosted-create-non-owner');
        if (hostedNonOwnerMsg) hostedNonOwnerMsg.classList.toggle('hidden', !isHosted || !nonOwnerInSharedWorkspace);
        if (workspacePanel) workspacePanel.classList.toggle('hidden', !isHosted);
        const hostedCreateMsg = el('vaults-hosted-create-msg');
        if (hostedCreateMsg && isHosted) {
          hostedCreateMsg.textContent = '';
          hostedCreateMsg.className = 'settings-msg';
        }
        if (workspaceMsg) {
          workspaceMsg.textContent = '';
          workspaceMsg.className = 'settings-msg';
        }

      /** @type {{ vaults?: unknown[] }} */
      let vRes = { vaults: [] };
      try {
        vRes = await api('/api/v1/vaults');
      } catch (_) {
        vRes = { vaults: [] };
      }
      /** @type {{ access?: Record<string, unknown> }} */
      let aRes = { access: {} };
      try {
        aRes = await api('/api/v1/vault-access');
      } catch (_) {
        aRes = { access: {} };
      }
      /** @type {{ scope?: Record<string, unknown> }} */
      let sRes = { scope: {} };
      try {
        sRes = await api('/api/v1/scope');
      } catch (_) {
        sRes = { scope: {} };
      }

      if (isHosted && workspaceInput) {
        try {
          const w = await api('/api/v1/workspace');
          workspaceInput.value = w && w.owner_user_id ? String(w.owner_user_id) : '';
        } catch (e) {
          workspaceInput.value = '';
          if (workspaceMsg) {
            workspaceMsg.textContent =
              (e && e.message) ||
              'Could not load workspace owner. On production this needs the bridge (BRIDGE_URL).';
            workspaceMsg.className = 'settings-msg err';
          }
        }
      } else if (workspaceInput && !isHosted) {
        workspaceInput.value = '';
      }
      const vaults = vRes.vaults || [];
      if (serverView) {
        const uid = settingsRes.user_id != null ? String(settingsRes.user_id) : '—';
        const allowed = settingsRes.allowed_vault_ids;
        const allowedStr = Array.isArray(allowed) && allowed.length ? allowed.join(', ') : '—';
        if (isHosted) {
          serverView.innerHTML =
            '<span class="settings-server-view-compact"><strong>You:</strong> <code>' +
            escapeHtml(uid) +
            '</code> · <strong>Vaults:</strong> <code>' +
            escapeHtml(allowedStr) +
            '</code> · Cloud storage. Team: workspace owner → invites → access → scope. <strong>Vault</strong> menu when ≥2 ids.</span>';
        } else {
          const dataDir =
            settingsRes.data_dir_display != null ? escapeHtml(String(settingsRes.data_dir_display)) : 'data';
          serverView.innerHTML =
            '<span class="settings-server-view-compact"><strong>You:</strong> <code>' +
            escapeHtml(uid) +
            '</code> · <strong>Allowed vaults:</strong> <code>' +
            escapeHtml(allowedStr) +
            '</code> · <strong>Data:</strong> <code>' +
            dataDir +
            '</code>. Missing a vault in the header? Fix <strong>Vault access</strong> for your user id.</span>';
        }
      }
      if (listContainer) {
        listContainer.innerHTML = buildVaultListSummaryInnerHtml(vaults, isHosted);
      }
      if (vaultsJson) vaultsJson.value = JSON.stringify(vaults, null, 2);
      if (accessText) accessText.value = JSON.stringify(aRes.access || {}, null, 2);
      if (scopeText) scopeText.value = JSON.stringify(sRes.scope || {}, null, 2);

      const vaultListJsonDetails = el('vault-list-json-details');
      if (vaultListJsonDetails) vaultListJsonDetails.open = false;
      const vaultAccessDetails = el('vault-access-json-details');
      if (vaultAccessDetails) vaultAccessDetails.open = false;
      const scopeJsonDetails = el('scope-json-details');
      if (scopeJsonDetails) scopeJsonDetails.open = false;

      let roleIds = [];
      try {
        const ro = await api('/api/v1/roles');
        roleIds = Object.keys(ro.roles || {});
      } catch (_) {
        roleIds = [];
      }
      populateHostedTeamUserSelect(
        el('access-form-user-select'),
        roleIds,
        settingsRes.user_id,
        '— Choose a person —',
      );
      populateHostedTeamUserSelect(
        el('scope-form-user-select'),
        roleIds,
        settingsRes.user_id,
        '— Choose or type User ID below —',
      );
      const asel = el('access-form-user-select');
      if (asel) asel.value = '';
      const ssel = el('scope-form-user-select');
      if (ssel) ssel.value = '';
      accessFormToggleOtherInput();
      const vaultIdsForForm = collectVaultIdsForAccessForm(vaults, settingsRes);
      renderAccessVaultCheckboxes(vaultIdsForForm);
      accessFormSyncCheckboxesFromAccessJson();
      refreshAccessRulesSummary(parseVaultAccessFromTextarea());

      const scopeVaultSelect = el('scope-form-vault-id');
      if (scopeVaultSelect) {
        scopeVaultSelect.innerHTML =
          vaults.length === 0
            ? '<option value="default">default</option>'
            : vaults.map((v) => '<option value="' + escapeHtml(v.id) + '">' + escapeHtml(v.label || v.id) + '</option>').join('');
      }

      if (!isHosted) {
        populateVaultListExistingSelect(vaults);
        const vSel = el('vault-list-form-existing');
        if (vSel) vSel.value = '';
        fillVaultListFormFromExisting();
      }
    } catch (e) {
      if (listContainer) listContainer.textContent = 'Could not load: ' + (e.message || '');
      if (serverView) serverView.textContent = 'Could not load server view: ' + (e.message || '');
    }
  }

  /** Align with bridge/canister: [a-zA-Z0-9_-], max 64; disallow default (already exists). */
  function sanitizeNewHostedVaultId(raw) {
    const t = String(raw || '').trim();
    if (!t) return { error: 'Enter a vault id.' };
    let s = t.replace(/[^a-zA-Z0-9_-]/g, '_');
    s = s.replace(/_+/g, '_').replace(/^_|_$/g, '');
    s = s.slice(0, 64);
    if (!s) return { error: 'Use letters, numbers, hyphens, or underscores only.' };
    if (s === 'default') {
      return { error: 'The default vault already exists — pick another id (e.g. work or personal).' };
    }
    return { id: s };
  }

  const btnHostedVaultCreate = el('btn-vaults-hosted-create');
  if (btnHostedVaultCreate) {
    btnHostedVaultCreate.onclick = async () => {
      const msgEl = el('vaults-hosted-create-msg');
      const inp = el('vaults-hosted-new-id');
      const setCreateVaultMsg = (text, isErr) => {
        if (!msgEl) return;
        msgEl.textContent = text;
        msgEl.className = 'settings-msg' + (isErr ? ' err' : ' ok');
      };
      if (!isHostedHubFromSettings()) {
        setCreateVaultMsg('This action is only available on hosted Hub.', true);
        return;
      }
      if (!hubUserCanWriteNotes()) {
        setCreateVaultMsg('Your role cannot create notes. Ask an admin to change your role.', true);
        return;
      }
      const ws = lastBackupSettingsPayload;
      const ownerId =
        ws && ws.workspace_owner_id != null && String(ws.workspace_owner_id).trim() !== ''
          ? String(ws.workspace_owner_id).trim()
          : '';
      const me = ws && ws.user_id != null ? String(ws.user_id) : '';
      if (ownerId && me && me !== ownerId) {
        setCreateVaultMsg(
          'Only the workspace owner can create new cloud vaults. Ask them to create the vault id here, then an admin can grant access under Vault access.',
          true,
        );
        return;
      }
      const parsed = sanitizeNewHostedVaultId(inp && inp.value);
      if (parsed.error) {
        setCreateVaultMsg(parsed.error, true);
        return;
      }
      const { id } = parsed;
      await withButtonBusy(btnHostedVaultCreate, 'Creating vault…', async () => {
        setCreateVaultMsg('');
        try {
          const fresh = await api('/api/v1/settings');
          const allowed = fresh.allowed_vault_ids || [];
          if (Array.isArray(allowed) && allowed.includes(id)) {
            setCreateVaultMsg('That vault id already exists. Use the Vault dropdown in the header to switch to it.', true);
            return;
          }
          const path = 'inbox/.knowtation-vault-bootstrap-' + id + '-' + Date.now() + '.md';
          await api('/api/v1/notes', {
            method: 'POST',
            headers: { 'X-Vault-Id': id },
            body: JSON.stringify({
              path,
              body:
                'This note was created when you added the "' +
                id +
                '" vault in Knowtation Hub (hosted). You can edit or delete it.\n',
              frontmatter: { title: 'New vault', tags: ['knowtation-setup'] },
            }),
          });
          const s = await api('/api/v1/settings');
          lastBackupSettingsPayload = s;
          if (s.role) window.__hubUserRole = String(s.role);
          updateVaultSwitcher(s.vault_list || [], s.allowed_vault_ids || []);
          applyHostedUiFromSettings(s);
          setCurrentVaultId(id);
          const sel = el('vault-switcher');
          if (sel) sel.value = id;
          loadFacets();
          loadNotes();
          loadProposals();
          await loadVaultsPanel();
          if (inp) inp.value = '';
          setCreateVaultMsg('Vault "' + id + '" created. Use the Vault dropdown in the header to switch.', false);
        } catch (e) {
          setCreateVaultMsg(e.message || 'Could not create vault', true);
        }
      });
    };
  }

  const btnSettingsDeleteVault = el('btn-settings-delete-vault');
  if (btnSettingsDeleteVault) {
    btnSettingsDeleteVault.onclick = async () => {
      const msgEl = el('settings-delete-vault-msg');
      const setVaultDelMsg = (text, isErr) => {
        if (!msgEl) return;
        msgEl.textContent = text;
        msgEl.className = 'settings-msg' + (isErr ? ' err' : ' ok');
      };
      if (!hubUserMayDeleteVault()) {
        setVaultDelMsg('You are not allowed to delete vaults.', true);
        return;
      }
      const sel = el('settings-delete-vault-select');
      const vaultId = (sel && sel.value) || '';
      const vaultIdTrim = String(vaultId).trim();
      if (!vaultIdTrim) {
        setVaultDelMsg('Choose a vault to delete.', true);
        return;
      }
      if (vaultIdTrim === 'default') {
        setVaultDelMsg('The default vault cannot be deleted.', true);
        return;
      }
      const confirmEl = el('settings-delete-vault-confirm');
      const confirmVal = String((confirmEl && confirmEl.value) || '').trim();
      if (confirmVal !== 'DELETE VAULT') {
        setVaultDelMsg('Type DELETE VAULT exactly to confirm.', true);
        return;
      }
      await withButtonBusy(btnSettingsDeleteVault, 'Deleting…', async () => {
        setVaultDelMsg('', false);
        try {
          await api('/api/v1/vaults/' + encodeURIComponent(vaultIdTrim), {
            method: 'DELETE',
            headers: { 'X-Vault-Id': vaultIdTrim },
          });
          const wasCurrent = String(getCurrentVaultId()) === vaultIdTrim;
          if (wasCurrent) {
            setCurrentVaultId('default');
            const vSel = el('vault-switcher');
            if (vSel) vSel.value = 'default';
          }
          const s = await api('/api/v1/settings');
          lastBackupSettingsPayload = s;
          if (s.role) window.__hubUserRole = String(s.role);
          updateVaultSwitcher(s.vault_list || [], s.allowed_vault_ids || []);
          applyHostedUiFromSettings(s);
          refreshDeleteProjectPanelVisibility();
          loadFacets();
          loadNotes();
          loadProposals();
          await loadVaultsPanel();
          if (confirmEl) confirmEl.value = '';
          setVaultDelMsg('Vault "' + vaultIdTrim + '" was deleted.', false);
        } catch (e) {
          setVaultDelMsg(e.message || 'Could not delete vault', true);
        }
      });
    };
  }

  const btnScopeFormApply = el('btn-scope-form-apply');
  if (btnScopeFormApply) {
    btnScopeFormApply.onclick = () => {
      const userId = (el('scope-form-user-id') && el('scope-form-user-id').value || '').trim();
      const vaultId = (el('scope-form-vault-id') && el('scope-form-vault-id').value) || 'default';
      const projectsStr = (el('scope-form-projects') && el('scope-form-projects').value) || '';
      const foldersStr = (el('scope-form-folders') && el('scope-form-folders').value) || '';
      const msg = el('scope-form-msg');
      if (!userId) {
        if (msg) { msg.textContent = 'Enter a user ID.'; msg.className = 'settings-msg err'; }
        return;
      }
      const projects = projectsStr.split(',').map((p) => p.trim()).filter(Boolean);
      const folders = foldersStr.split(',').map((f) => f.trim()).filter(Boolean);
      const scopeText = el('scope-json');
      let scope = {};
      if (scopeText && scopeText.value) {
        try {
          scope = JSON.parse(scopeText.value);
          if (typeof scope !== 'object' || scope === null) scope = {};
        } catch (_) { scope = {}; }
      }
      if (!scope[userId]) scope[userId] = {};
      scope[userId][vaultId] = { projects, folders };
      if (scopeText) scopeText.value = JSON.stringify(scope, null, 2);
      if (msg) { msg.textContent = 'Added. Click Save scope to persist.'; msg.className = 'settings-msg ok'; }
    };
  }

  function isHostedHubFromSettings() {
    const s = lastBackupSettingsPayload;
    return s && String(s.vault_path_display || '').toLowerCase() === 'canister';
  }

  const BULK_PRESET_EMPTY = '';
  const BULK_PRESET_CUSTOM = '__custom__';

  function fillBulkPresetSelect(sel, items, includeCustom) {
    if (!sel) return;
    const preserve = sel.value;
    sel.innerHTML = '';
    const head = document.createElement('option');
    head.value = BULK_PRESET_EMPTY;
    head.textContent = '— Select or type below —';
    sel.appendChild(head);
    for (const item of items) {
      if (item == null || item === '') continue;
      const o = document.createElement('option');
      o.value = item;
      o.textContent = item;
      sel.appendChild(o);
    }
    if (includeCustom) {
      const c = document.createElement('option');
      c.value = BULK_PRESET_CUSTOM;
      c.textContent = 'Custom (type below)';
      sel.appendChild(c);
    }
    if (preserve && [...sel.options].some((opt) => opt.value === preserve)) sel.value = preserve;
    else sel.value = BULK_PRESET_EMPTY;
  }

  function syncBulkPathPresetSelectToInput(selectEl, inputEl) {
    if (!selectEl || !inputEl) return;
    const p = (inputEl.value || '').trim();
    if (!p) {
      selectEl.value = BULK_PRESET_EMPTY;
      return;
    }
    let best = BULK_PRESET_CUSTOM;
    let bestLen = -1;
    for (const opt of selectEl.options) {
      const v = opt.value;
      if (!v || v === BULK_PRESET_EMPTY || v === BULK_PRESET_CUSTOM) continue;
      if (p === v || p.startsWith(v + '/')) {
        if (v.length > bestLen) {
          best = v;
          bestLen = v.length;
        }
      }
    }
    selectEl.value = bestLen >= 0 ? best : BULK_PRESET_CUSTOM;
  }

  function syncBulkSlugPresetSelectToInput(selectEl, inputEl) {
    if (!selectEl || !inputEl) return;
    const p = (inputEl.value || '').trim();
    if (!p) {
      selectEl.value = BULK_PRESET_EMPTY;
      return;
    }
    if ([...selectEl.options].some((opt) => opt.value === p)) selectEl.value = p;
    else selectEl.value = BULK_PRESET_CUSTOM;
  }

  function wireBulkPathPresetPair(selectEl, inputEl) {
    if (!selectEl || !inputEl) return;
    selectEl.addEventListener('change', () => {
      const v = selectEl.value;
      if (v && v !== BULK_PRESET_EMPTY && v !== BULK_PRESET_CUSTOM) inputEl.value = v;
    });
    inputEl.addEventListener('input', () => syncBulkPathPresetSelectToInput(selectEl, inputEl));
  }

  function wireBulkSlugPresetPair(selectEl, inputEl) {
    if (!selectEl || !inputEl) return;
    selectEl.addEventListener('change', () => {
      const v = selectEl.value;
      if (v && v !== BULK_PRESET_EMPTY && v !== BULK_PRESET_CUSTOM) inputEl.value = v;
    });
    inputEl.addEventListener('input', () => syncBulkSlugPresetSelectToInput(selectEl, inputEl));
  }

  let bulkPresetDropdownsToken = 0;
  async function refreshBulkDeletePresetDropdowns() {
    if (!token) return;
    const pathSelect = el('settings-bulk-path-prefix-preset');
    const delProjSelect = el('settings-bulk-delete-project-preset');
    const renameFromSelect = el('settings-bulk-rename-from-preset');
    const pathInput = el('settings-delete-prefix');
    const delProjInput = el('settings-delete-project-slug');
    const renameFromInput = el('settings-rename-project-from');
    if (!pathSelect && !delProjSelect && !renameFromSelect) return;
    const my = ++bulkPresetDropdownsToken;
    let diskFolders = [];
    let facets = { projects: [], folders: [] };
    try {
      const [vf, fc] = await Promise.all([
        api('/api/v1/vault/folders'),
        api('/api/v1/notes/facets'),
      ]);
      if (my !== bulkPresetDropdownsToken) return;
      diskFolders = vf && Array.isArray(vf.folders) ? vf.folders : [];
      facets = fc && typeof fc === 'object' ? fc : { projects: [], folders: [] };
    } catch (_) {
      if (my !== bulkPresetDropdownsToken) return;
    }
    const pathSet = new Set();
    for (const f of diskFolders) {
      if (f && typeof f === 'string') pathSet.add(f.replace(/\/+$/, '').trim());
    }
    for (const f of facets.folders || []) {
      if (f && typeof f === 'string') pathSet.add(f.replace(/\/+$/, '').trim());
    }
    const rest = [...pathSet].filter((x) => x && x !== 'inbox').sort((a, b) => a.localeCompare(b));
    const pathPrefixes = ['inbox', ...rest];
    const projects = [
      ...new Set((facets.projects || []).map((p) => String(p).trim()).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b));

    fillBulkPresetSelect(pathSelect, pathPrefixes, true);
    fillBulkPresetSelect(delProjSelect, projects, true);
    fillBulkPresetSelect(renameFromSelect, projects, true);

    syncBulkPathPresetSelectToInput(pathSelect, pathInput);
    syncBulkSlugPresetSelectToInput(delProjSelect, delProjInput);
    syncBulkSlugPresetSelectToInput(renameFromSelect, renameFromInput);
  }

  wireBulkPathPresetPair(el('settings-bulk-path-prefix-preset'), el('settings-delete-prefix'));
  wireBulkSlugPresetPair(el('settings-bulk-delete-project-preset'), el('settings-delete-project-slug'));
  wireBulkSlugPresetPair(el('settings-bulk-rename-from-preset'), el('settings-rename-project-from'));

  const btnDeletePrefix = el('btn-settings-delete-prefix');
  if (btnDeletePrefix) {
    btnDeletePrefix.onclick = async () => {
      const msg = el('settings-delete-prefix-msg');
      const prefixEl = el('settings-delete-prefix');
      const confirmEl = el('settings-delete-confirm');
      if (!hubUserCanWriteNotes()) {
        if (msg) { msg.textContent = 'Your role cannot delete notes.'; msg.className = 'settings-msg err'; }
        return;
      }
      const raw = (prefixEl && prefixEl.value) ? prefixEl.value.trim() : '';
      const conf = (confirmEl && confirmEl.value) ? confirmEl.value.trim() : '';
      if (!raw) {
        if (msg) { msg.textContent = 'Enter a path prefix (vault-relative).'; msg.className = 'settings-msg err'; }
        return;
      }
      if (conf !== 'DELETE') {
        if (msg) { msg.textContent = 'Type DELETE in the confirmation field.'; msg.className = 'settings-msg err'; }
        return;
      }
      await withButtonBusy(btnDeletePrefix, 'Deleting…', async () => {
        try {
          const out = await api('/api/v1/notes/delete-by-prefix', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path_prefix: raw }),
          });
          const n = out && typeof out.deleted === 'number' ? out.deleted : 0;
          const pd = out && typeof out.proposals_discarded === 'number' ? out.proposals_discarded : 0;
          if (confirmEl) confirmEl.value = '';
          if (msg) {
            msg.textContent = 'Removed ' + n + ' note(s)' + (pd ? '; ' + pd + ' proposal(s) discarded' : '') + '.';
            msg.className = 'settings-msg ok';
          }
          if (typeof showToast === 'function') {
            showToast('Deleted ' + n + ' note(s). Run Re-index if you use semantic search.', false);
          }
          loadNotes();
          loadFacets();
          if (typeof loadProposals === 'function') loadProposals();
          void refreshBulkDeletePresetDropdowns();
        } catch (e) {
          const m = e && e.message ? String(e.message) : String(e);
          if (msg) { msg.textContent = m; msg.className = 'settings-msg err'; }
        }
      });
    };
  }

  const btnDeleteByProject = el('btn-settings-delete-by-project');
  if (btnDeleteByProject) {
    btnDeleteByProject.onclick = async () => {
      const msg = el('settings-delete-by-project-msg');
      const slugEl = el('settings-delete-project-slug');
      const confirmEl = el('settings-delete-project-confirm');
      if (!hubUserCanWriteNotes()) {
        if (msg) { msg.textContent = 'Your role cannot delete notes.'; msg.className = 'settings-msg err'; }
        return;
      }
      const slug = (slugEl && slugEl.value) ? slugEl.value.trim() : '';
      const conf = (confirmEl && confirmEl.value) ? confirmEl.value.trim() : '';
      if (!slug) {
        if (msg) { msg.textContent = 'Enter a project slug (same as list/search filter).'; msg.className = 'settings-msg err'; }
        return;
      }
      if (conf !== 'DELETE') {
        if (msg) { msg.textContent = 'Type DELETE in the confirmation field.'; msg.className = 'settings-msg err'; }
        return;
      }
      await withButtonBusy(btnDeleteByProject, 'Deleting…', async () => {
        try {
          const out = await api('/api/v1/notes/delete-by-project', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ project: slug }),
          });
          const n = out && typeof out.deleted === 'number' ? out.deleted : 0;
          const pd = out && typeof out.proposals_discarded === 'number' ? out.proposals_discarded : 0;
          if (confirmEl) confirmEl.value = '';
          if (msg) {
            msg.textContent = 'Removed ' + n + ' note(s)' + (pd ? '; ' + pd + ' proposal(s) discarded' : '') + '.';
            msg.className = 'settings-msg ok';
          }
          if (typeof showToast === 'function') {
            showToast('Deleted ' + n + ' note(s) in project. Run Re-index if you use semantic search.', false);
          }
          loadNotes();
          loadFacets();
          if (typeof loadProposals === 'function') loadProposals();
          void refreshBulkDeletePresetDropdowns();
        } catch (e) {
          const m = e && e.message ? String(e.message) : String(e);
          if (msg) { msg.textContent = m; msg.className = 'settings-msg err'; }
        }
      });
    };
  }

  const btnRenameProject = el('btn-settings-rename-project');
  if (btnRenameProject) {
    btnRenameProject.onclick = async () => {
      const msg = el('settings-rename-project-msg');
      const fromEl = el('settings-rename-project-from');
      const toEl = el('settings-rename-project-to');
      const confirmEl = el('settings-rename-project-confirm');
      if (!hubUserCanWriteNotes()) {
        if (msg) { msg.textContent = 'Your role cannot edit notes.'; msg.className = 'settings-msg err'; }
        return;
      }
      const from = (fromEl && fromEl.value) ? fromEl.value.trim() : '';
      const to = (toEl && toEl.value) ? toEl.value.trim() : '';
      const conf = (confirmEl && confirmEl.value) ? confirmEl.value.trim() : '';
      if (!from || !to) {
        if (msg) { msg.textContent = 'Enter both from and to project slugs.'; msg.className = 'settings-msg err'; }
        return;
      }
      if (conf !== 'RENAME') {
        if (msg) { msg.textContent = 'Type RENAME in the confirmation field.'; msg.className = 'settings-msg err'; }
        return;
      }
      await withButtonBusy(btnRenameProject, 'Renaming…', async () => {
        try {
          const out = await api('/api/v1/notes/rename-project', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to }),
          });
          const n = out && typeof out.updated === 'number' ? out.updated : 0;
          if (confirmEl) confirmEl.value = '';
          if (msg) {
            msg.textContent = 'Updated project slug on ' + n + ' note(s).';
            msg.className = 'settings-msg ok';
          }
          if (typeof showToast === 'function') {
            showToast('Renamed project on ' + n + ' note(s).', false);
          }
          loadNotes();
          loadFacets();
          void refreshBulkDeletePresetDropdowns();
        } catch (e) {
          const m = e && e.message ? String(e.message) : String(e);
          if (msg) { msg.textContent = m; msg.className = 'settings-msg err'; }
        }
      });
    };
  }

  const btnVaultsSave = el('btn-vaults-save');
  if (btnVaultsSave) btnVaultsSave.onclick = async () => {
    const msg = el('vaults-save-msg');
    if (isHostedHubFromSettings()) {
      if (msg) {
        msg.textContent =
          'Vault list editing is not available on hosted. Use the canister-backed vault ids and X-Vault-Id (see Settings → Vaults intro).';
        msg.className = 'settings-msg err';
      }
      return;
    }
    await withButtonBusy(btnVaultsSave, 'Saving…', async () => {
      const raw = (el('vaults-json') && el('vaults-json').value) || '[]';
      try {
        const vaults = JSON.parse(raw);
        if (!Array.isArray(vaults)) throw new Error('Must be a JSON array');
        await api('/api/v1/vaults', { method: 'POST', body: JSON.stringify({ vaults }) });
        if (msg) { msg.textContent = 'Saved.'; msg.className = 'settings-msg ok'; }
        try {
          const s = await api('/api/v1/settings');
          applySettingsPayloadToHubChrome(s);
        } catch (_) {}
        loadVaultsPanel();
      } catch (e) {
        if (msg) { msg.textContent = e.message || 'Save failed'; msg.className = 'settings-msg err'; }
      }
    });
  };
  function validateVaultAccess(access) {
    if (typeof access !== 'object' || access === null) return 'Must be a JSON object (e.g. {"user_id": ["default", "work"]}).';
    for (const [uid, arr] of Object.entries(access)) {
      if (!Array.isArray(arr)) return 'Each value must be an array of vault IDs. Key "' + uid + '" is not.';
      if (arr.some((v) => typeof v !== 'string' || !v.trim())) return 'Each vault ID must be a non-empty string.';
    }
    return null;
  }
  function validateScope(scope) {
    if (typeof scope !== 'object' || scope === null) return 'Must be a JSON object.';
    for (const [userId, perVault] of Object.entries(scope)) {
      if (typeof perVault !== 'object' || perVault === null || Array.isArray(perVault)) return 'Scope for user "' + userId + '" must be an object (vault_id → { projects, folders }).';
      for (const [vaultId, entry] of Object.entries(perVault)) {
        if (typeof entry !== 'object' || entry === null) continue;
        if (entry.projects != null && !Array.isArray(entry.projects)) return 'Scope "' + userId + '" → "' + vaultId + '": projects must be an array.';
        if (entry.folders != null && !Array.isArray(entry.folders)) return 'Scope "' + userId + '" → "' + vaultId + '": folders must be an array.';
      }
    }
    return null;
  }
  const btnVaultAccessSave = el('btn-vault-access-save');
  if (btnVaultAccessSave) btnVaultAccessSave.onclick = async () => {
    const msg = el('vault-access-save-msg');
    await withButtonBusy(btnVaultAccessSave, 'Saving…', async () => {
      const raw = (el('vault-access-json') && el('vault-access-json').value) || '{}';
      try {
        const access = JSON.parse(raw);
        const err = validateVaultAccess(access);
        if (err) throw new Error(err);
        await api('/api/v1/vault-access', { method: 'POST', body: JSON.stringify({ access }) });
        if (msg) { msg.textContent = 'Saved.'; msg.className = 'settings-msg ok'; }
        try {
          const s = await api('/api/v1/settings');
          applySettingsPayloadToHubChrome(s);
        } catch (_) {}
        refreshAccessRulesSummary(parseVaultAccessFromTextarea());
      } catch (e) {
        if (msg) { msg.textContent = e.message || 'Save failed'; msg.className = 'settings-msg err'; }
      }
    });
  };

  const btnAccessFormApply = el('btn-access-form-apply');
  if (btnAccessFormApply) {
    btnAccessFormApply.onclick = () => {
      const msg = el('access-form-msg');
      const uid = getAccessFormResolvedUserId();
      if (!uid) {
        if (msg) {
          msg.textContent = 'Choose a person or type a User ID under “Someone else”.';
          msg.className = 'settings-msg err';
        }
        return;
      }
      const checked = Array.from(
        document.querySelectorAll('input[name="hub-access-vault"]:checked'),
      ).map((c) => c.value);
      if (checked.length === 0) {
        if (msg) {
          msg.textContent = 'Tick at least one vault.';
          msg.className = 'settings-msg err';
        }
        return;
      }
      const access = parseVaultAccessFromTextarea();
      access[uid] = checked;
      const ta = el('vault-access-json');
      if (ta) ta.value = JSON.stringify(access, null, 2);
      refreshAccessRulesSummary(access);
      if (msg) {
        msg.textContent =
          'Rules updated in the form only. Click the outlined Save vault access button below — nothing is stored until you do.';
        msg.className = 'settings-msg ok';
      }
    };
  }

  const btnAccessFormRemove = el('btn-access-form-remove-user');
  if (btnAccessFormRemove) {
    btnAccessFormRemove.onclick = () => {
      const msg = el('access-form-msg');
      const uid = getAccessFormResolvedUserId();
      if (!uid) {
        if (msg) {
          msg.textContent = 'Choose a person to remove.';
          msg.className = 'settings-msg err';
        }
        return;
      }
      const access = parseVaultAccessFromTextarea();
      if (!Object.prototype.hasOwnProperty.call(access, uid)) {
        if (msg) {
          msg.textContent = 'No rule for that user.';
          msg.className = 'settings-msg err';
        }
        return;
      }
      delete access[uid];
      const ta = el('vault-access-json');
      if (ta) ta.value = JSON.stringify(access, null, 2);
      refreshAccessRulesSummary(access);
      accessFormSyncCheckboxesFromAccessJson();
      if (msg) {
        msg.textContent =
          'Removed from draft rules only. Click Save vault access below to persist (required).';
        msg.className = 'settings-msg ok';
      }
    };
  }

  const btnScopeSave = el('btn-scope-save');
  if (btnScopeSave) btnScopeSave.onclick = async () => {
    const msg = el('scope-save-msg');
    await withButtonBusy(btnScopeSave, 'Saving…', async () => {
      const raw = (el('scope-json') && el('scope-json').value) || '{}';
      try {
        const scope = JSON.parse(raw);
        const err = validateScope(scope);
        if (err) throw new Error(err);
        await api('/api/v1/scope', { method: 'POST', body: JSON.stringify({ scope }) });
        if (msg) { msg.textContent = 'Saved.'; msg.className = 'settings-msg ok'; }
      } catch (e) {
        if (msg) { msg.textContent = e.message || 'Save failed'; msg.className = 'settings-msg err'; }
      }
    });
  };

  const btnWorkspaceUseMe = el('btn-workspace-use-me');
  if (btnWorkspaceUseMe) {
    btnWorkspaceUseMe.onclick = async () => {
      const input = el('workspace-owner-input');
      const msg = el('workspace-save-msg');
      let uid =
        lastBackupSettingsPayload && lastBackupSettingsPayload.user_id != null
          ? String(lastBackupSettingsPayload.user_id)
          : '';
      if (!uid) {
        try {
          const s = await api('/api/v1/settings');
          lastBackupSettingsPayload = s;
          uid = s.user_id != null ? String(s.user_id) : '';
        } catch (e) {
          if (msg) {
            msg.textContent = e.message || 'Could not load your User ID.';
            msg.className = 'settings-msg err';
          }
          return;
        }
      }
      if (input) input.value = uid;
      if (msg) {
        msg.textContent = 'Filled with your User ID. Click Save workspace owner when ready.';
        msg.className = 'settings-msg ok';
      }
    };
  }

  const btnWorkspaceSave = el('btn-workspace-save');
  if (btnWorkspaceSave) {
    btnWorkspaceSave.onclick = async () => {
      const msg = el('workspace-save-msg');
      const input = el('workspace-owner-input');
      await withButtonBusy(btnWorkspaceSave, 'Saving…', async () => {
        try {
          const raw = (input && input.value) || '';
          const trimmed = raw.trim();
          const owner_user_id = trimmed === '' ? null : trimmed;
          await api('/api/v1/workspace', {
            method: 'POST',
            body: JSON.stringify({ owner_user_id }),
          });
          if (msg) {
            msg.textContent = 'Saved.';
            msg.className = 'settings-msg ok';
          }
        } catch (e) {
          if (msg) {
            msg.textContent = e.message || 'Save failed';
            msg.className = 'settings-msg err';
          }
        }
      });
    };
  }

  const btnWorkspaceClear = el('btn-workspace-clear');
  if (btnWorkspaceClear) {
    btnWorkspaceClear.onclick = async () => {
      const msg = el('workspace-save-msg');
      const input = el('workspace-owner-input');
      await withButtonBusy(btnWorkspaceClear, 'Clearing…', async () => {
        try {
          await api('/api/v1/workspace', {
            method: 'POST',
            body: JSON.stringify({ owner_user_id: null }),
          });
          if (input) input.value = '';
          if (msg) {
            msg.textContent = 'Cleared — each person uses their own cloud space.';
            msg.className = 'settings-msg ok';
          }
        } catch (e) {
          if (msg) {
            msg.textContent = e.message || 'Clear failed';
            msg.className = 'settings-msg err';
          }
        }
      });
    };
  }

  async function loadInvitesList() {
    const listEl = el('invites-pending-list');
    if (!listEl) return;
    listEl.textContent = 'Loading…';
    try {
      const out = await api('/api/v1/invites');
      const invites = out.invites || [];
      if (invites.length === 0) {
        listEl.textContent = 'No pending invites. Create a link above.';
      } else {
        listEl.innerHTML = invites.map((inv) => {
          const tokenShort = inv.token.slice(0, 12) + '…';
          const exp = inv.expires_at ? inv.expires_at.slice(0, 10) : '';
          return '<div class="team-role-row invite-row">' +
            '<span>' + escapeHtml(inv.role) + ' · ' + escapeHtml(tokenShort) + (exp ? ' · expires ' + escapeHtml(exp) : '') + '</span>' +
            '<button type="button" class="btn-revoke-invite btn-secondary small" data-token="' + escapeHtml(inv.token) + '">Revoke</button>' +
            '</div>';
        }).join('');
        listEl.querySelectorAll('.btn-revoke-invite').forEach((btn) => {
          btn.onclick = async () => {
            const t = btn.dataset.token;
            if (!t) return;
            try {
              await api('/api/v1/invites/' + encodeURIComponent(t), { method: 'DELETE' });
              loadInvitesList();
            } catch (e) {
              if (typeof showToast === 'function') showToast(e.message || 'Revoke failed', true);
            }
          };
        });
      }
    } catch (e) {
      listEl.textContent = 'Could not load: ' + (e.message || '');
    }
  }

  const btnInviteCreate = el('btn-invite-create');
  const inviteLinkBlock = el('invite-link-block');
  const inviteLinkUrl = el('invite-link-url');
  const inviteCreateMsg = el('invite-create-msg');
  if (btnInviteCreate) {
    btnInviteCreate.onclick = async () => {
      const roleSelect = el('invite-role');
      const role = (roleSelect && roleSelect.value) || 'editor';
      if (inviteCreateMsg) { inviteCreateMsg.textContent = ''; inviteCreateMsg.className = 'settings-msg'; }
      await withButtonBusy(btnInviteCreate, 'Creating…', async () => {
        try {
          const out = await api('/api/v1/invites', { method: 'POST', body: JSON.stringify({ role }) });
          if (inviteLinkUrl) inviteLinkUrl.value = out.invite_url || '';
          if (inviteLinkBlock) inviteLinkBlock.classList.remove('hidden');
          if (inviteCreateMsg) { inviteCreateMsg.textContent = 'Link created. Copy and share.'; inviteCreateMsg.className = 'settings-msg ok'; }
          loadInvitesList();
        } catch (e) {
          if (inviteCreateMsg) { inviteCreateMsg.textContent = e.message || 'Failed'; inviteCreateMsg.className = 'settings-msg err'; }
        }
      });
    };
  }
  const btnInviteCopy = el('btn-invite-copy');
  if (btnInviteCopy && inviteLinkUrl) {
    btnInviteCopy.onclick = () => {
      inviteLinkUrl.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(inviteLinkUrl.value).then(() => {
          if (typeof showToast === 'function') showToast('Link copied.');
        }).catch(() => {});
      }
    };
  }

  function syncTeamAddEvaluatorMayApproveVisibility() {
    const wrap = el('team-add-evaluator-may-approve-wrap');
    const sel = el('team-role');
    if (!wrap || !sel) return;
    wrap.classList.toggle('hidden', sel.value !== 'evaluator');
  }
  const teamRoleSelect = el('team-role');
  if (teamRoleSelect) {
    teamRoleSelect.addEventListener('change', syncTeamAddEvaluatorMayApproveVisibility);
    syncTeamAddEvaluatorMayApproveVisibility();
  }

  async function loadTeamRolesList() {
    const listEl = el('team-roles-list');
    if (!listEl) return;
    listEl.textContent = 'Loading…';
    try {
      const out = await api('/api/v1/roles');
      const roles = out.roles || {};
      const mayMap = out.evaluator_may_approve && typeof out.evaluator_may_approve === 'object' ? out.evaluator_may_approve : {};
      const entries = Object.entries(roles);
      listEl.innerHTML = '';
      if (entries.length === 0) {
        listEl.textContent = 'No roles assigned yet. When you add one above, it appears here.';
        return;
      }
      for (const [uid, role] of entries) {
        const row = document.createElement('div');
        row.className = 'team-role-row team-role-row-flex';
        const label = document.createElement('span');
        label.innerHTML = escapeHtml(uid) + ' → ' + escapeHtml(role);
        row.appendChild(label);
        if (role === 'evaluator') {
          const explicit = Object.prototype.hasOwnProperty.call(mayMap, uid);
          const chk = document.createElement('input');
          chk.type = 'checkbox';
          chk.title = 'May approve proposals';
          chk.checked = Boolean(mayMap[uid]);
          chk.addEventListener('change', async () => {
            chk.disabled = true;
            try {
              await api('/api/v1/roles/evaluator-may-approve', {
                method: 'POST',
                body: JSON.stringify({ user_id: uid, evaluator_may_approve: chk.checked }),
              });
            } catch (err) {
              chk.checked = !chk.checked;
              if (typeof showToast === 'function') showToast(err.message || 'Save failed');
            } finally {
              chk.disabled = false;
            }
          });
          const lab = document.createElement('label');
          lab.className = 'team-evaluator-approve-inline';
          lab.appendChild(chk);
          const sp = document.createElement('span');
          sp.textContent = explicit ? ' May approve' : ' May approve (unset: host default if any)';
          lab.appendChild(sp);
          row.appendChild(lab);
        }
        listEl.appendChild(row);
      }
    } catch (e) {
      listEl.textContent = 'Could not load: ' + (e.message || '');
    }
  }

  const btnTeamUserUseMe = el('btn-team-user-use-me');
  if (btnTeamUserUseMe) {
    btnTeamUserUseMe.onclick = async () => {
      const userIdInput = el('team-user-id');
      const msgEl = el('team-save-msg');
      let uid =
        lastBackupSettingsPayload && lastBackupSettingsPayload.user_id != null
          ? String(lastBackupSettingsPayload.user_id)
          : '';
      if (!uid) {
        try {
          const s = await api('/api/v1/settings');
          lastBackupSettingsPayload = s;
          uid = s.user_id != null ? String(s.user_id) : '';
        } catch (e) {
          if (msgEl) {
            msgEl.textContent = e.message || 'Could not load your User ID.';
            msgEl.className = 'settings-msg err';
          }
          return;
        }
      }
      if (userIdInput) userIdInput.value = uid;
      if (msgEl) {
        msgEl.textContent = 'Filled with your User ID. Pick a role, then Add / update role.';
        msgEl.className = 'settings-msg';
      }
    };
  }

  const btnTeamSave = el('btn-team-save');
  if (btnTeamSave) {
    btnTeamSave.onclick = async () => {
      const userIdInput = el('team-user-id');
      const roleSelect = el('team-role');
      const msgEl = el('team-save-msg');
      const userId = (userIdInput && userIdInput.value || '').trim();
      const role = (roleSelect && roleSelect.value) || 'editor';
      if (!userId) {
        if (msgEl) { msgEl.textContent = 'Enter a User ID.'; msgEl.className = 'settings-msg err'; }
        return;
      }
      if (msgEl) msgEl.textContent = '';
      await withButtonBusy(btnTeamSave, 'Saving…', async () => {
        try {
          const body = { user_id: userId, role };
          if (role === 'evaluator') {
            const cb = el('team-add-evaluator-may-approve');
            body.evaluator_may_approve = Boolean(cb && cb.checked);
          }
          await api('/api/v1/roles', { method: 'POST', body: JSON.stringify(body) });
          if (msgEl) { msgEl.textContent = 'Saved. They have role: ' + role + '.'; msgEl.className = 'settings-msg'; }
          userIdInput.value = '';
          loadTeamRolesList();
        } catch (e) {
          if (msgEl) { msgEl.textContent = e.message || 'Failed'; msgEl.className = 'settings-msg err'; }
        }
      });
    };
  }

  const currentAccent = () => {
    const inline = document.documentElement.style.getPropertyValue('--accent').trim();
    if (inline) return inline;
    const fromCss = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
    return fromCss || DEFAULT_ACCENT;
  };
  function accentStringToHex6(str) {
    if (!str || typeof str !== 'string') return DEFAULT_ACCENT;
    const t = str.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(t)) return t.toLowerCase();
    if (/^#[0-9A-Fa-f]{3}$/.test(t)) {
      const a = t.slice(1);
      return ('#' + a[0] + a[0] + a[1] + a[1] + a[2] + a[2]).toLowerCase();
    }
    const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(t);
    if (m) {
      return (
        '#' +
        [1, 2, 3]
          .map((i) => Number(m[i]).toString(16).padStart(2, '0'))
          .join('')
      ).toLowerCase();
    }
    return DEFAULT_ACCENT;
  }
  function updateAccentCustomHexLabel(hex6) {
    const out = el('accent-custom-hex');
    if (out && hex6) out.textContent = String(hex6).toUpperCase();
  }
  function setAccentRuntimeOnly(hex) {
    if (!hex) return;
    document.documentElement.style.setProperty('--accent', hex);
    updateAccentCustomHexLabel(accentStringToHex6(hex));
  }
  let accentIroPicker = null;
  let accentIroSuppressChange = false;
  function ensureAccentIroPicker() {
    if (accentIroPicker) return accentIroPicker;
    const mount = el('accent-iro-root');
    const Iro = typeof window !== 'undefined' && window.iro;
    if (!mount || !Iro || !Iro.ColorPicker) return null;
    const brRaw = getComputedStyle(document.documentElement).getPropertyValue('--border');
    const br = (brRaw && brRaw.trim()) || '';
    const borderColor = br && (br[0] === '#' || br.startsWith('rgb')) ? br : '#2a3f5c';
    accentIroPicker = new Iro.ColorPicker(mount, {
      width: 280,
      color: accentStringToHex6(currentAccent()),
      borderWidth: 1,
      borderColor,
      layout: [
        { component: Iro.ui.Box, options: {} },
        { component: Iro.ui.Slider, options: { sliderType: 'hue' } },
      ],
    });
    accentIroPicker.on('color:change', (color) => {
      if (accentIroSuppressChange) return;
      setAccentRuntimeOnly(color.hexString);
      document.querySelectorAll('.accent-swatch').forEach((b) => b.classList.remove('active'));
    });
    accentIroPicker.on('input:end', () => {
      if (accentIroSuppressChange) return;
      const h = accentIroPicker.color.hexString;
      if (h) applyAccent(h);
    });
    return accentIroPicker;
  }
  function paintAccentSwatches() {
    document.querySelectorAll('.accent-swatch').forEach((btn) => {
      const hex = btn.dataset.accent;
      if (hex) btn.style.backgroundColor = hex;
    });
  }
  paintAccentSwatches();
  document.querySelectorAll('.accent-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hex = btn.dataset.accent;
      if (hex) {
        applyAccent(hex);
        const norm = accentStringToHex6(hex);
        document.querySelectorAll('.accent-swatch').forEach((b) => {
          const bh = b.dataset.accent;
          b.classList.toggle('active', Boolean(bh) && accentStringToHex6(bh) === norm);
        });
        ensureAccentIroPicker();
        if (accentIroPicker) {
          accentIroSuppressChange = true;
          try {
            try {
              accentIroPicker.setColor(norm, { silent: true });
            } catch (_) {
              accentIroPicker.setColor(norm);
            }
          } finally {
            accentIroSuppressChange = false;
          }
        }
        updateAccentCustomHexLabel(norm);
      }
    });
  });
  ensureAccentIroPicker();
  function syncAccentUI() {
    const norm = accentStringToHex6(currentAccent());
    document.querySelectorAll('.accent-swatch').forEach((b) => {
      const bh = b.dataset.accent;
      b.classList.toggle('active', Boolean(bh) && accentStringToHex6(bh) === norm);
    });
    ensureAccentIroPicker();
    if (accentIroPicker) {
      accentIroSuppressChange = true;
      try {
        try {
          accentIroPicker.setColor(norm, { silent: true });
        } catch (_) {
          accentIroPicker.setColor(norm);
        }
      } finally {
        accentIroSuppressChange = false;
      }
    }
    updateAccentCustomHexLabel(norm);
  }
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }
  function syncThemeUI() {
    const theme = currentTheme();
    document.querySelectorAll('.theme-btn').forEach((btn) => {
      btn.setAttribute('aria-pressed', btn.dataset.theme === theme ? 'true' : 'false');
    });
  }
  function syncColorPaletteUI() {
    const p = currentColorPalette();
    document.querySelectorAll('.dashboard-theme-card').forEach((btn) => {
      const id = btn.dataset.palette || DEFAULT_COLOR_PALETTE;
      btn.setAttribute('aria-checked', id === p ? 'true' : 'false');
    });
  }
  const dashboardThemeGrid = el('dashboard-theme-grid');
  if (dashboardThemeGrid) {
    dashboardThemeGrid.addEventListener('click', (ev) => {
      const card = ev.target && ev.target.closest && ev.target.closest('.dashboard-theme-card');
      if (!card || !dashboardThemeGrid.contains(card)) return;
      const pid = card.dataset.palette;
      if (pid == null) return;
      applyColorPalette(pid);
      syncColorPaletteUI();
    });
  }
  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      if (theme) {
        applyTheme(theme);
        syncThemeUI();
      }
    });
  });
  const scrollDashColorsBtn = el('btn-scroll-dashboard-color-theme');
  if (scrollDashColorsBtn) {
    scrollDashColorsBtn.addEventListener('click', () => {
      const target = el('settings-dashboard-color-theme');
      if (target && target.scrollIntoView) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  el('btn-settings-sync').onclick = async () => {
    const syncBtn = el('btn-settings-sync');
    const msg = el('settings-sync-msg');
    msg.textContent = 'Syncing…';
    msg.className = 'settings-msg';
    const s = lastBackupSettingsPayload;
    const isHosted = s && (String(s.vault_path_display || '').toLowerCase() === 'canister');
    const hostedPath = isHosted && s.github_connect_available;
    let opts = { method: 'POST' };
    if (hostedPath) {
      const slug =
        normalizeGithubRepoSlug(el('settings-hosted-repo') && el('settings-hosted-repo').value) ||
        normalizeGithubRepoSlug(localStorage.getItem(HOSTED_BACKUP_REPO_LS)) ||
        normalizeGithubRepoSlug(s.repo);
      if (!slug) {
        msg.textContent = 'Enter backup repo as owner/repo (e.g. myuser/my-notes).';
        msg.className = 'settings-msg err';
        return;
      }
      localStorage.setItem(HOSTED_BACKUP_REPO_LS, slug);
      opts.body = JSON.stringify({ repo: slug });
    }
    setButtonBusy(syncBtn, true, 'Backing up…');
    try {
      const result = await api('/api/v1/vault/sync', opts);
      msg.textContent = result.message || 'Done.';
      const initBtnOk = el('btn-vault-git-init');
      if (initBtnOk) initBtnOk.classList.add('hidden');
      if (hostedPath && s) {
        const refreshed = await api('/api/v1/settings');
        lastBackupSettingsPayload = refreshed;
        const vg = refreshed.vault_git || {};
        let gitText = 'Not configured';
        if (vg.enabled && vg.has_remote) {
          gitText = 'Configured';
          if (vg.auto_commit) gitText += ' (auto-commit on)';
          if (vg.auto_push) gitText += ', auto-push on';
        } else if (vg.enabled) gitText = 'Enabled but no remote set';
        el('settings-git-status').textContent = gitText;
        const step4 = document.getElementById('setup-step-4');
        if (step4) {
          const done = !!(vg.enabled && vg.has_remote);
          step4.classList.toggle('setup-step-done', done);
          const icon = step4.querySelector('.setup-step-icon');
          if (icon) icon.textContent = done ? '✓' : '';
        }
      }
    } catch (e) {
      msg.textContent = e.message || 'Sync failed';
      msg.className = 'settings-msg err';
      const initBtn = el('btn-vault-git-init');
      if (initBtn) {
        const st = lastBackupSettingsPayload;
        const hosted =
          st && String(st.vault_path_display || '').toLowerCase() === 'canister';
        const needInit =
          e.code === 'GIT_NOT_INITIALIZED' ||
          /not a Git repository/i.test(e.message || '');
        initBtn.classList.toggle('hidden', hosted || !needInit);
      }
    } finally {
      setButtonBusy(syncBtn, false);
      const st = lastBackupSettingsPayload;
      if (syncBtn && st) {
        const vg = st.vault_git || {};
        const vd = st.vault_path_display || '';
        const ih = (vd + '').toLowerCase() === 'canister';
        syncBtn.disabled = settingsSyncDisabled(st, vg, ih);
      }
    }
  };
  const btnVaultGitInit = el('btn-vault-git-init');
  if (btnVaultGitInit) {
    btnVaultGitInit.onclick = async () => {
      const msg = el('settings-sync-msg');
      msg.textContent = 'Initializing Git…';
      msg.className = 'settings-msg';
      await withButtonBusy(btnVaultGitInit, 'Initializing…', async () => {
        try {
          const out = await api('/api/v1/vault/git-init', { method: 'POST' });
          msg.textContent = out.message || 'Git initialized. Try Back up now.';
          msg.className = 'settings-msg ok';
          btnVaultGitInit.classList.add('hidden');
        } catch (e) {
          msg.textContent = e.message || 'Git init failed';
          msg.className = 'settings-msg err';
        }
      });
    };
  }
  const saveSetupBtn = el('btn-settings-save');
  if (saveSetupBtn) {
    saveSetupBtn.onclick = async () => {
      const msg = el('settings-save-msg');
      if (msg) {
        msg.textContent = 'Saving…';
        msg.className = 'settings-msg';
      }
      const vault_path = (el('setup-vault-path') && el('setup-vault-path').value.trim()) || undefined;
      const enabled = el('setup-git-enabled') && el('setup-git-enabled').checked;
      const remote = (el('setup-git-remote') && el('setup-git-remote').value.trim()) || '';
      await withButtonBusy(saveSetupBtn, 'Saving…', async () => {
        try {
          await api('/api/v1/setup', {
            method: 'POST',
            body: JSON.stringify({
              vault_path: vault_path || undefined,
              vault_git: { enabled, remote: remote || undefined },
            }),
          });
          const successText = 'Saved. Config applied.' + (vault_path !== undefined ? ' If you changed the vault path, run Re-index or restart the Hub so search uses the new path.' : '');
          if (msg) {
            msg.textContent = successText;
            msg.className = 'settings-msg ok';
          }
          if (typeof showToast === 'function') showToast('Setup saved.');
          api('/api/v1/settings').then((s) => {
            const vd = s.vault_path_display || '—';
            const isHostedNow = (vd + '').toLowerCase() === 'canister';
            if (el('settings-mode-display')) el('settings-mode-display').textContent = isHostedNow ? 'Hosted (beta)' : 'Self-hosted';
            el('settings-vault-display').textContent = vd;
            const configureSection = el('settings-configure-backup-section');
            const configureHr = el('settings-hr-configure');
            if (configureSection) configureSection.style.display = isHostedNow ? 'none' : '';
            if (configureHr) configureHr.style.display = isHostedNow ? 'none' : '';
            const vg = s.vault_git || {};
            let gitText = 'Not configured';
            if (vg.enabled && vg.has_remote) {
              gitText = 'Configured';
              if (vg.auto_commit) gitText += ' (auto-commit on)';
              if (vg.auto_push) gitText += ', auto-push on';
            } else if (vg.enabled) gitText = 'Enabled but no remote set';
            el('settings-git-status').textContent = gitText;
            const syncBtn = el('btn-settings-sync');
            const isAdmin = s.role === 'admin';
            if (syncBtn) syncBtn.disabled = settingsSyncDisabled(s, vg, isHostedNow);
            if (msg) {
              msg.textContent = successText;
              msg.className = 'settings-msg ok';
            }
          }).catch(() => {});
        } catch (e) {
          const errMsg = e.message || 'Save failed';
          if (msg) {
            msg.textContent = errMsg.includes('different role') || errMsg.includes('FORBIDDEN')
              ? 'Only admins can save setup. Your role is shown under Status above.'
              : errMsg;
            msg.className = 'settings-msg err';
          }
          if (typeof showToast === 'function') showToast(errMsg.includes('different role') || errMsg.includes('FORBIDDEN') ? 'Only admins can save setup.' : errMsg, true);
        }
      });
    };
  }

  function defaultFullPath() {
    const sel = el('full-path-folder');
    const folder =
      sel && sel.value && sel.value !== '__custom__' ? sel.value : 'inbox';
    return folder + '/note-' + Date.now() + '.md';
  }

  let fullPathFolderLoadToken = 0;
  async function refreshFullPathFolderSelect() {
    const sel = el('full-path-folder');
    if (!sel || !token) return;
    const my = ++fullPathFolderLoadToken;
    let folders = ['inbox'];
    try {
      const data = await api('/api/v1/vault/folders');
      if (my !== fullPathFolderLoadToken) return;
      if (data && Array.isArray(data.folders) && data.folders.length) folders = data.folders;
    } catch (_) {
      if (my !== fullPathFolderLoadToken) return;
    }
    const preserve = sel.value;
    sel.innerHTML = '';
    for (const f of folders) {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = f;
      sel.appendChild(o);
    }
    const custom = document.createElement('option');
    custom.value = '__custom__';
    custom.textContent = 'Custom (type path below)';
    sel.appendChild(custom);
    if (preserve && [...sel.options].some((opt) => opt.value === preserve)) sel.value = preserve;
    else sel.value = folders[0] || 'inbox';
  }

  function syncFolderSelectToPathInput() {
    const pathInput = el('full-path');
    const sel = el('full-path-folder');
    if (!pathInput || !sel) return;
    const p = pathInput.value.trim();
    if (!p) return;
    let best = '__custom__';
    let bestLen = -1;
    for (const opt of sel.options) {
      const v = opt.value;
      if (v === '__custom__') continue;
      if (p === v || p.startsWith(v + '/')) {
        if (v.length > bestLen) {
          best = v;
          bestLen = v.length;
        }
      }
    }
    sel.value = bestLen >= 0 ? best : '__custom__';
  }

  const fullPathFolderEl = () => el('full-path-folder');
  const fullPathInputEl = () => el('full-path');
  if (fullPathFolderEl() && fullPathInputEl()) {
    fullPathFolderEl().addEventListener('change', () => {
      const sel = fullPathFolderEl();
      if (!sel || sel.value === '__custom__') return;
      fullPathInputEl().value = sel.value + '/note-' + Date.now() + '.md';
    });
    fullPathInputEl().addEventListener('input', () => syncFolderSelectToPathInput());
  }

  document.querySelectorAll('.modal-tab').forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll('.modal-tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      const tab = t.dataset.createTab;
      el('create-quick').classList.toggle('hidden', tab !== 'quick');
      el('create-full').classList.toggle('hidden', tab !== 'full');
      if (tab === 'full') {
        if (el('full-date') && !el('full-date').value) el('full-date').value = ymd(new Date());
        void refreshFullPathFolderSelect().then(() => {
          const pi = el('full-path');
          if (pi && !pi.value.trim()) pi.value = defaultFullPath();
          else syncFolderSelectToPathInput();
        });
      }
    };
  });

  el('btn-quick-save').onclick = async () => {
    const quickBtn = el('btn-quick-save');
    const body = el('quick-body').value.trim();
    const msg = el('create-msg-quick');
    if (!body) {
      msg.textContent = 'Enter some text.';
      msg.className = 'create-msg err';
      return;
    }
    const projectRaw = el('quick-project').value.trim();
    const pslug = normSlug(projectRaw);
    const today = ymd(new Date());
    const slug = 'hub_' + Date.now();
    const path = pslug ? 'projects/' + pslug + '/inbox/' + slug + '.md' : 'inbox/' + slug + '.md';
    const title = body.split('\n')[0].slice(0, 80) || 'Quick capture';
    await withButtonBusy(quickBtn, 'Saving…', async () => {
      try {
        await api('/api/v1/notes', {
          method: 'POST',
          body: stringifyNotePostPayload(path, body, {
            source: 'hub',
            date: today,
            title,
            ...(pslug && { project: pslug }),
          }),
        });
        msg.textContent = 'Saved: ' + path;
        msg.className = 'create-msg ok';
        el('quick-body').value = '';
        loadFacets();
        loadNotes();
        closeCreateModal();
      } catch (e) {
        msg.textContent = e.message;
        msg.className = 'create-msg err';
      }
    });
  };

  el('btn-full-save').onclick = async () => {
    const fullBtn = el('btn-full-save');
    const notePath = el('full-path').value.trim();
    const msg = el('create-msg-full');
    if (!notePath) {
      msg.textContent = 'Enter a vault path (e.g. inbox/idea.md).';
      msg.className = 'create-msg err';
      return;
    }
    if (!notePath.endsWith('.md')) {
      msg.textContent = 'Path must end in .md (e.g. inbox/idea.md)';
      msg.className = 'create-msg err';
      return;
    }
    const title = el('full-title').value.trim();
    const body = el('full-body').value;
    const project = el('full-project').value.trim();
    const tags = el('full-tags').value.trim();
    const dateVal = el('full-date') && el('full-date').value ? el('full-date').value.trim() : ymd(new Date());
    const causalChain = el('full-causal-chain') && el('full-causal-chain').value.trim();
    const entityRaw = el('full-entity') && el('full-entity').value.trim();
    const entity = entityRaw ? entityRaw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const episode = el('full-episode') && el('full-episode').value.trim();
    const followsRaw = el('full-follows') && el('full-follows').value.trim();
    const follows = followsRaw ? (followsRaw.includes(',') ? followsRaw.split(',').map((s) => s.trim()).filter(Boolean) : followsRaw) : undefined;
    const fm = {
      date: dateVal,
      ...(title && { title }),
      ...(project && { project }),
      ...(tags && { tags }),
      ...(causalChain && { causal_chain_id: causalChain }),
      ...(entity && entity.length && { entity }),
      ...(episode && { episode_id: episode }),
      ...(follows && { follows }),
    };
    await withButtonBusy(fullBtn, 'Creating…', async () => {
      try {
        await api('/api/v1/notes', { method: 'POST', body: stringifyNotePostPayload(notePath, body, fm) });
        msg.textContent = 'Created: ' + notePath;
        msg.className = 'create-msg ok';
        void refreshFullPathFolderSelect().then(() => {
          el('full-path').value = defaultFullPath();
          syncFolderSelectToPathInput();
        });
        el('full-title').value = '';
        el('full-body').value = '';
        el('full-project').value = '';
        el('full-tags').value = '';
        if (el('full-date')) el('full-date').value = '';
        if (el('full-causal-chain')) el('full-causal-chain').value = '';
        if (el('full-entity')) el('full-entity').value = '';
        if (el('full-episode')) el('full-episode').value = '';
        if (el('full-follows')) el('full-follows').value = '';
        loadFacets();
        loadNotes();
        closeCreateModal();
      } catch (e) {
        msg.textContent = e.message;
        msg.className = 'create-msg err';
      }
    });
  };

  function formatDetailReadBody(body, fm) {
    const o = fm && typeof fm === 'object' && !Array.isArray(fm) ? fm : {};
    const keys = Object.keys(o);
    let text = (body || '') + '\n\n---\n' + JSON.stringify(keys.length ? o : {}, null, 2);
    if (keys.length === 0 && hubUserCanWriteNotes()) {
      text +=
        '\n\n—\nNo metadata is stored for this file on the server yet (common for older hosted notes). Hosted Hub uses the same read view as self-hosted: after you Edit → Save once, the JSON block here fills with keys like title, tags, date, and provenance—same idea as on localhost. Overview and Quick tags then pick that up. To fix many notes at once from a computer, use `npm run resave:hosted-empty-fm` or `node scripts/resave-hosted-empty-frontmatter.mjs` (set `KNOWTATION_HUB_TOKEN` per `scripts/resave-hosted-empty-frontmatter.mjs` header).';
    }
    return text;
  }

  var VIDEO_URL_RE = /^([ \t]*)(https?:\/\/[^\s]+\.(?:mp4|webm|mov)(?:\?[^\s]*)?)[ \t]*$/gim;
  var VIDEO_MIME_MAP = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };

  function videoExtToMime(url) {
    try {
      var ext = new URL(url).pathname.split('.').pop().toLowerCase();
      return VIDEO_MIME_MAP[ext] || 'video/mp4';
    } catch (_) {
      var clean = url.split('?')[0].split('#')[0];
      var ext2 = clean.split('.').pop().toLowerCase();
      return VIDEO_MIME_MAP[ext2] || 'video/mp4';
    }
  }

  /**
   * Ensure standalone video URL lines are surrounded by blank lines in the raw
   * markdown BEFORE it is fed to marked. Without this, marked's `breaks: true`
   * mode joins adjacent lines (e.g. a video URL followed immediately by image
   * markdown) into a single <p>, which prevents the video-URL regex from matching.
   */
  function isolateVideoUrlLines(md) {
    // Match any line whose entire content is a bare https video URL.
    // The `m` flag makes ^ / $ match per-line. Insert a blank line before
    // and after so marked always puts the URL in its own paragraph.
    return md.replace(
      /^([ \t]*)(https?:\/\/[^\s]+\.(?:mp4|webm|mov)(?:\?[^\s]*)?)[ \t]*$/gim,
      '\n$1$2\n'
    );
  }

  /**
   * Replace bare video URLs (on their own line) with <video> elements.
   * Handles two forms that marked produces for a bare URL on its own paragraph:
   *   1. GFM autolink:  <p><a href="URL">URL</a></p>
   *   2. Plain text:    <p>URL</p>
   * Runs before DOMPurify so the sanitiser validates the output.
   */
  function expandVideoUrls(html) {
    var VIDEO_EXT_PAT = /\.(?:mp4|webm|mov)(?:\?[^\s"<#]*)?(?:#[^\s"<]*)?$/i;

    // GFM autolink form: <p><a href="URL">...</a></p>
    var result = html.replace(
      /<p>\s*<a\s+href="(https?:\/\/[^\s"<]+)"[^>]*>[^<]*<\/a>\s*<\/p>/gi,
      function (match, url) {
        if (!VIDEO_EXT_PAT.test(url)) return match;
        var mime = videoExtToMime(url);
        return '<video controls preload="metadata" style="max-width:100%;border-radius:6px">' +
          '<source src="' + url.replace(/"/g, '&quot;') + '" type="' + mime + '">' +
          'Your browser does not support embedded video.</video>';
      }
    );

    // Plain text form: <p>URL</p>
    result = result.replace(
      /<p>\s*(https?:\/\/[^\s<]+)\s*<\/p>/gi,
      function (match, url) {
        if (!VIDEO_EXT_PAT.test(url)) return match;
        var mime = videoExtToMime(url);
        return '<video controls preload="metadata" style="max-width:100%;border-radius:6px">' +
          '<source src="' + url.replace(/"/g, '&quot;') + '" type="' + mime + '">' +
          'Your browser does not support embedded video.</video>';
      }
    );

    return result;
  }

  var SANITIZE_OPTS_NOTE = {
    ADD_TAGS: ['details', 'summary', 'video', 'source'],
    ADD_ATTR: ['controls', 'preload', 'type'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'autoplay'],
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|ftp):/i,
  };

  /**
   * Render markdown text as sanitised HTML.
   * Uses marked + DOMPurify (both loaded in index.html). Falls back to escaped plain text.
   * Blocks javascript: and data: URIs; allows standard https:// image and link URLs.
   * Phase 18: bare video URLs (.mp4/.webm/.mov) become inline <video> players.
   */
  var _imageProxyToken = null;
  var _imageProxyTokenExp = 0;

  async function getImageProxyToken() {
    if (_imageProxyToken && Date.now() < _imageProxyTokenExp) return _imageProxyToken;
    var proxyBase = (typeof apiBase !== 'undefined' ? apiBase : '').replace(/\/$/, '');
    var jwt = (typeof localStorage !== 'undefined' && localStorage.getItem('hub_token')) || '';
    if (!jwt) return '';
    try {
      var res = await fetch(proxyBase + '/api/v1/vault/image-proxy-token', {
        headers: { authorization: 'Bearer ' + jwt },
      });
      if (!res.ok) return '';
      var data = await res.json();
      _imageProxyToken = data.token || '';
      _imageProxyTokenExp = Date.now() + ((data.expires_in || 240) - 30) * 1000;
      return _imageProxyToken;
    } catch (_) { return ''; }
  }

  /**
   * Rewrite raw.githubusercontent.com <img> src attributes to go through the
   * Hub's image proxy. Uses a short-lived HMAC-signed token (not the session JWT).
   * Falls back to no rewrite if no cached image token is available yet.
   */
  function rewriteGitHubImageUrls(html) {
    var tok = _imageProxyToken || '';
    if (!tok) {
      // Fallback: use session JWT — gateway accepts it via backward-compat path.
      tok = (typeof localStorage !== 'undefined' && localStorage.getItem('hub_token')) || '';
    }
    if (!tok) return html;
    var encodedTok = encodeURIComponent(tok);
    var proxyBase = (typeof apiBase !== 'undefined' ? apiBase : '').replace(/\/$/, '');
    return html.replace(
      /(<img\b[^>]*?\ssrc=")https?:\/\/raw\.githubusercontent\.com\/([^"]+)"/gi,
      function (match, pre, rest) {
        var encoded = encodeURIComponent('https://raw.githubusercontent.com/' + rest);
        return pre + proxyBase + '/api/v1/vault/image-proxy?url=' + encoded + '&token=' + encodedTok + '"';
      }
    );
  }

  function renderNoteMarkdownHtml(md) {
    try {
      if (typeof marked !== 'undefined' && marked.parse && typeof DOMPurify !== 'undefined') {
        var raw = marked.parse(isolateVideoUrlLines(md || ''), { breaks: true });
        var withVideo = expandVideoUrls(raw);
        var sanitised = DOMPurify.sanitize(withVideo, SANITIZE_OPTS_NOTE);
        return rewriteGitHubImageUrls(sanitised);
      }
    } catch (_) { /* fall through */ }
    return '<pre class="note-body-fallback">' + escapeHtml(md || '') + '</pre>';
  }

  /**
   * Build the full read-view HTML for a note: rendered markdown body + collapsible metadata block.
   */
  function buildNoteReadHtml(body, fm) {
    const o = fm && typeof fm === 'object' && !Array.isArray(fm) ? fm : {};
    const keys = Object.keys(o);
    const bodyHtml = renderNoteMarkdownHtml(body || '');
    const metaJson = escapeHtml(JSON.stringify(keys.length ? o : {}, null, 2));
    const emptyNote = keys.length === 0 && hubUserCanWriteNotes()
      ? '<p class="note-meta-hint">No metadata yet — Edit → Save once to populate tags, date, and provenance.</p>'
      : '';
    return (
      bodyHtml +
      '<details class="note-meta-block">' +
        '<summary>Metadata</summary>' +
        '<pre class="note-meta-pre">' + metaJson + '</pre>' +
        emptyNote +
      '</details>'
    );
  }

  function switchNoteToReadMode() {
    if (!currentOpenNote) return;
    const bodyEl = el('detail-body');
    const actionsEl = el('detail-actions');
    bodyEl.innerHTML = buildNoteReadHtml(currentOpenNote.body, currentOpenNote.frontmatter);
    bodyEl.className = 'note-rendered-body';
    actionsEl.innerHTML = '';
    attachNoteDetailReadActions(actionsEl);
  }

  async function deleteOpenNote() {
    if (!currentOpenNote) return;
    if (!confirm('Permanently delete this note from the vault? This cannot be undone.')) return;
    const p = currentOpenNote.path;
    try {
      await api('/api/v1/notes/' + encodeURIComponent(p), { method: 'DELETE' });
      if (typeof showToast === 'function') showToast('Note deleted');
      currentOpenNote = null;
      currentNotePathForCopy = '';
      hideDetailPanelChrome();
      el('btn-copy-path').classList.add('hidden');
      loadNotes();
      loadFacets();
    } catch (e) {
      if (typeof showToast === 'function') showToast('Delete failed: ' + (e.message || String(e)), true);
    }
  }

  function attachNoteDetailReadActions(actionsEl) {
    if (!hubUserCanWriteNotes()) return;
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => switchNoteToEditMode();
    const proposeBtn = document.createElement('button');
    proposeBtn.type = 'button';
    proposeBtn.textContent = 'Propose change';
    proposeBtn.onclick = () => {
      if (!currentOpenNote) return;
      openCreateProposalModal({
        path: currentOpenNote.path,
        body: currentOpenNote.body || '',
        fromNote: true,
      });
    };
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = 'Delete';
    delBtn.onclick = () => deleteOpenNote();
    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.textContent = 'Export';
    exportBtn.onclick = () => exportCurrentNote('md');
    actionsEl.append(editBtn, proposeBtn, delBtn, exportBtn);
  }

  async function exportCurrentNote(format) {
    if (!currentOpenNote) return;
    try {
      const res = await api('/api/v1/export', { method: 'POST', body: JSON.stringify({ path: currentOpenNote.path, format: format || 'md' }) });
      const blob = new Blob([res.content], { type: format === 'html' ? 'text/html' : 'text/markdown' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = res.filename || 'export.md';
      a.click();
      URL.revokeObjectURL(a.href);
      if (typeof showToast === 'function') showToast('Exported ' + (res.filename || 'note'));
    } catch (e) {
      if (typeof showToast === 'function') showToast('Export failed: ' + (e.message || String(e)), true);
    }
  }

  var MEDIA_IMAGE_EXTS = /\.(jpe?g|png|gif|webp)(\?|#|$)/i;
  var MEDIA_VIDEO_EXTS = /\.(mp4|webm|mov)(\?|#|$)/i;
  var MEDIA_URL_SAFE = /^https?:\/\//i;

  function attachMediaToolbar() {
    var textarea = el('detail-edit-body');
    if (!textarea) return;
    var existing = document.getElementById('media-toolbar');
    if (existing) existing.remove();

    var toolbar = document.createElement('div');
    toolbar.id = 'media-toolbar';
    toolbar.className = 'media-toolbar';

    var insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.textContent = 'Insert Media URL';
    insertBtn.className = 'btn-small';
    insertBtn.title = 'Paste a public image or video URL (.mp4 / .webm / .mov) to preview and insert it. Direct video file URLs render as inline players; YouTube/Vimeo links appear as clickable links.';
    insertBtn.onclick = function () { toggleMediaUrlDialog(toolbar, textarea); };
    toolbar.appendChild(insertBtn);

    var s = lastBackupSettingsPayload;
    if (s && s.github_connected && hubUserCanWriteNotes()) {
      var uploadBtn = document.createElement('button');
      uploadBtn.type = 'button';
      uploadBtn.textContent = 'Upload Image';
      uploadBtn.className = 'btn-small';
      uploadBtn.title = 'Upload an image (JPEG, PNG, GIF, WebP) and commit it to your connected GitHub repo. The image embeds inline in the note. Requires a public GitHub repo for the image to display.';
      uploadBtn.onclick = function () { triggerImageUpload(textarea); };
      toolbar.appendChild(uploadBtn);
    } else if (s && s.github_connect_available && hubUserCanWriteNotes()) {
      var connectHint = document.createElement('span');
      connectHint.className = 'media-toolbar-hint';
      connectHint.title = 'Connect GitHub in Settings → Backup to enable image uploads.';
      connectHint.textContent = 'Connect GitHub to upload images';
      toolbar.appendChild(connectHint);
    }

    textarea.parentNode.insertBefore(toolbar, textarea.nextSibling);
  }

  function toggleMediaUrlDialog(toolbar, textarea) {
    var existing = document.getElementById('media-url-dialog');
    if (existing) { existing.remove(); return; }

    var dialog = document.createElement('div');
    dialog.id = 'media-url-dialog';
    dialog.className = 'media-url-dialog';

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Paste image or video URL (https://...)';
    input.className = 'media-url-input';

    var preview = document.createElement('div');
    preview.className = 'media-preview';

    var actions = document.createElement('div');
    actions.className = 'media-url-actions';

    var doInsert = document.createElement('button');
    doInsert.type = 'button';
    doInsert.textContent = 'Insert';
    doInsert.className = 'btn-primary btn-small';
    doInsert.disabled = true;

    var doCancel = document.createElement('button');
    doCancel.type = 'button';
    doCancel.textContent = 'Cancel';
    doCancel.className = 'btn-small';
    doCancel.onclick = function () { dialog.remove(); };

    actions.appendChild(doInsert);
    actions.appendChild(doCancel);

    var detectedType = null;

    function onUrlChange() {
      var url = input.value.trim();
      preview.innerHTML = '';
      doInsert.disabled = true;
      detectedType = null;
      if (!url || !MEDIA_URL_SAFE.test(url)) return;
      if (MEDIA_IMAGE_EXTS.test(url)) {
        detectedType = 'image';
        var img = document.createElement('img');
        img.src = url;
        img.style.maxHeight = '200px';
        img.style.maxWidth = '100%';
        img.crossOrigin = 'anonymous';
        img.onerror = function () { preview.innerHTML = '<span class="muted small">Could not load preview.</span>'; };
        preview.appendChild(img);
        doInsert.disabled = false;
      } else if (MEDIA_VIDEO_EXTS.test(url)) {
        detectedType = 'video';
        var vid = document.createElement('video');
        vid.controls = true;
        vid.preload = 'metadata';
        vid.style.maxHeight = '200px';
        vid.style.maxWidth = '100%';
        vid.src = url;
        vid.onerror = function () { preview.innerHTML = '<span class="muted small">Could not load preview.</span>'; };
        preview.appendChild(vid);
        doInsert.disabled = false;
      } else {
        preview.innerHTML = '<span class="muted small">Not a recognised image or video URL. Paste a URL ending in .jpg, .png, .gif, .webp, .mp4, .webm, or .mov.</span>';
      }
    }

    input.addEventListener('input', onUrlChange);
    input.addEventListener('paste', function () { setTimeout(onUrlChange, 50); });

    doInsert.onclick = function () {
      var url = input.value.trim();
      if (!url) return;
      var insertion = detectedType === 'image' ? '![image](' + url + ')' : url;
      insertAtCursor(textarea, insertion);
      dialog.remove();
    };

    dialog.appendChild(input);
    dialog.appendChild(preview);
    dialog.appendChild(actions);
    toolbar.parentNode.insertBefore(dialog, toolbar.nextSibling);
    input.focus();
  }

  function insertAtCursor(textarea, text) {
    var start = textarea.selectionStart;
    var end = textarea.selectionEnd;
    var val = textarea.value;
    var before = val.substring(0, start);
    var needsNewline = before.length > 0 && !before.endsWith('\n');
    var insertion = (needsNewline ? '\n' : '') + text + '\n';
    textarea.value = before + insertion + val.substring(end);
    var newPos = start + insertion.length;
    textarea.setSelectionRange(newPos, newPos);
    textarea.focus();
  }

  /**
   * Compress an image File/Blob using the Canvas API so it fits within the
   * Netlify Lambda 6 MB payload limit (~4.5 MB binary after base64 overhead).
   * Target: longest side ≤ 2048 px, JPEG quality 0.82, result ≤ 3 MB.
   * Falls back to the original file if Canvas is unavailable or the image is
   * already small enough.
   */
  function compressImageIfNeeded(file) {
    var MAX_BYTES = 3 * 1024 * 1024; // 3 MB ceiling
    var MAX_DIM = 2048;
    return new Promise(function (resolve) {
      if (!file.type.startsWith('image/') || file.size <= MAX_BYTES) {
        return resolve(file);
      }
      if (typeof window === 'undefined' || !window.HTMLCanvasElement) {
        return resolve(file);
      }
      var img = new window.Image();
      var objectUrl = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(objectUrl);
        var ratio = Math.min(MAX_DIM / img.width, MAX_DIM / img.height, 1);
        var w = Math.round(img.width * ratio);
        var h = Math.round(img.height * ratio);
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        var tryQuality = function (quality, attempt) {
          canvas.toBlob(function (blob) {
            if (!blob) return resolve(file); // Canvas failed — upload original
            if (blob.size <= MAX_BYTES || quality <= 0.4 || attempt >= 3) {
              var outName = file.name.replace(/\.[^.]+$/, '.jpg');
              resolve(new window.File([blob], outName, { type: 'image/jpeg' }));
            } else {
              tryQuality(quality - 0.2, attempt + 1);
            }
          }, 'image/jpeg', quality);
        };
        tryQuality(0.82, 0);
      };
      img.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        resolve(file);
      };
      img.src = objectUrl;
    });
  }

  function triggerImageUpload(textarea) {
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/jpeg,image/png,image/gif,image/webp';
    fileInput.onchange = async function () {
      var file = fileInput.files && fileInput.files[0];
      if (!file || !currentOpenNote) return;
      try {
        if (typeof showToast === 'function') showToast('Uploading image…');
        // Compress before uploading to stay within the Netlify Lambda 6 MB
        // payload limit (~4.5 MB binary after base64 overhead).
        var uploadFile = await compressImageIfNeeded(file);
        var form = new FormData();
        form.append('image', uploadFile);
        var notePath = encodeURIComponent(currentOpenNote.path);
        var vaultIdParam = '';
        try { vaultIdParam = '?vault_id=' + encodeURIComponent(getCurrentVaultId()); } catch (_) {}
        // Build auth headers from the shared helper (omit Content-Type so the
        // browser sets the correct multipart/form-data boundary automatically).
        var uploadHeaders = headers();
        delete uploadHeaders['Content-Type'];
        // Use apiBase so this request reaches the gateway when the frontend is served
        // from a different origin (e.g. knowtation.store → ICP canister, read-only).
        var uploadBase = (typeof apiBase !== 'undefined' ? apiBase : '').replace(/\/$/, '');
        var res = await fetch(uploadBase + '/api/v1/notes/' + notePath + '/upload-image' + vaultIdParam, {
          method: 'POST',
          headers: uploadHeaders,
          body: form,
        });
        if (!res.ok) {
          var errData = await res.json().catch(function () { return {}; });
          throw new Error(errData.error || 'Upload failed (HTTP ' + res.status + ')');
        }
        var data = await res.json();
        insertAtCursor(textarea, data.inserted_markdown || '![image](' + data.url + ')');
        if (typeof showToast === 'function') showToast('Image uploaded and inserted');
      } catch (e) {
        if (typeof showToast === 'function') showToast('Upload failed: ' + (e.message || String(e)), true);
      }
    };
    fileInput.click();
  }

  function switchNoteToEditMode() {
    if (!currentOpenNote) return;
    closeCreateModal();
    const bodyEl = el('detail-body');
    const actionsEl = el('detail-actions');
    const fm = stripReservedHubFm(materializeFrontmatter(currentOpenNote.frontmatter));
    bodyEl.className = 'detail-edit-container create-panel';
    bodyEl.innerHTML =
      '<p class="muted small">Path (read-only): <code id="detail-edit-path-display"></code></p>' +
      '<label for="detail-edit-title">Title</label>' +
      '<input type="text" id="detail-edit-title" placeholder="Note title" />' +
      '<label for="detail-edit-body">Body (Markdown)</label>' +
      '<textarea id="detail-edit-body" class="detail-edit-body" rows="10" placeholder="Content…"></textarea>' +
      '<label for="detail-edit-date">Date</label>' +
      '<input type="date" id="detail-edit-date" />' +
      '<label for="detail-edit-project">Project (slug)</label>' +
      '<input type="text" id="detail-edit-project" placeholder="slug" />' +
      '<label for="detail-edit-tags">Tags (comma-separated)</label>' +
      '<input type="text" id="detail-edit-tags" placeholder="tag1, tag2" />' +
      '<p class="muted small" style="margin-top:0.5rem;">Temporal and hierarchical (optional):</p>' +
      '<label for="detail-edit-causal-chain">Causal chain ID</label>' +
      '<input type="text" id="detail-edit-causal-chain" placeholder="e.g. auth-decisions" />' +
      '<label for="detail-edit-entity">Entity (comma-separated)</label>' +
      '<input type="text" id="detail-edit-entity" placeholder="e.g. alice, auth" />' +
      '<label for="detail-edit-episode">Episode ID</label>' +
      '<input type="text" id="detail-edit-episode" placeholder="e.g. planning-2025-03" />' +
      '<label for="detail-edit-follows">Follows (vault path)</label>' +
      '<input type="text" id="detail-edit-follows" placeholder="e.g. inbox/prior-note.md" />';
    const pathDisp = el('detail-edit-path-display');
    if (pathDisp) pathDisp.textContent = currentOpenNote.path;
    fillDetailEditFieldsFromFrontmatter(fm);
    attachMediaToolbar();
    actionsEl.innerHTML = '';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'btn-primary';
    saveBtn.onclick = async () => {
      closeCreateModal();
      const body = (el('detail-edit-body') && el('detail-edit-body').value) || '';
      const frontmatter = mergedFrontmatterForDetailSave();
      await withButtonBusy(saveBtn, 'Saving…', async () => {
        try {
          await api('/api/v1/notes', {
            method: 'POST',
            body: stringifyNotePostPayload(currentOpenNote.path, body, frontmatter),
          });
          if (typeof showToast === 'function') showToast('Note saved');
          const refreshed = await api('/api/v1/notes/' + encodeURIComponent(currentOpenNote.path));
          const nfm = materializeFrontmatter(refreshed.frontmatter);
          currentOpenNote = { path: currentOpenNote.path, body: refreshed.body || '', frontmatter: nfm };
          switchNoteToReadMode();
          if (typeof loadNotes === 'function') loadNotes();
          if (typeof loadFacets === 'function') loadFacets();
        } catch (e) {
          if (typeof showToast === 'function') showToast('Save failed: ' + (e.message || String(e)), true);
        }
      });
    };
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => switchNoteToReadMode();
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = 'Delete';
    delBtn.onclick = () => deleteOpenNote();
    actionsEl.append(saveBtn, delBtn, cancelBtn);
  }

  function openNote(path) {
    closeCreateModal();
    currentNotePathForCopy = path;
    currentOpenNote = null;
    const panel = el('detail-panel');
    panel.classList.remove('detail-panel-proposal-wide');
    const title = el('detail-title');
    const bodyEl = el('detail-body');
    const actionsEl = el('detail-actions');
    const btnCopy = el('btn-copy-path');
    title.textContent = path;
    bodyEl.textContent = 'Loading…';
    bodyEl.className = '';
    actionsEl.innerHTML = '';
    btnCopy.classList.remove('hidden');
    panel.classList.remove('hidden');
    api('/api/v1/notes/' + encodeURIComponent(path))
      .then((note) => {
        const fm = materializeFrontmatter(note.frontmatter);
        currentOpenNote = { path, body: note.body || '', frontmatter: fm };
        bodyEl.innerHTML = buildNoteReadHtml(note.body, fm);
        bodyEl.className = 'note-rendered-body';
        attachNoteDetailReadActions(actionsEl);
      })
      .catch((e) => {
        bodyEl.textContent = 'Error: ' + e.message;
        bodyEl.className = '';
      });
  }

  el('btn-copy-path').onclick = () => {
    if (currentNotePathForCopy) navigator.clipboard.writeText(currentNotePathForCopy);
  };

  const btnCopyUserId = el('btn-copy-user-id');
  if (btnCopyUserId) {
    btnCopyUserId.onclick = () => {
      const idEl = el('settings-user-id');
      const text = idEl && idEl.textContent && idEl.textContent !== '—' ? idEl.textContent : '';
      if (text && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          if (typeof showToast === 'function') showToast('User ID copied.');
        }).catch(() => {});
      }
    };
  }
  const btnCopyAgentceptionEnv = el('btn-copy-agentception-env');
  if (btnCopyAgentceptionEnv) {
    btnCopyAgentceptionEnv.onclick = () => {
      const envEl = el('integrations-agentception-env');
      const text = envEl && envEl.textContent ? envEl.textContent.trim() : '';
      if (text && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
          if (typeof showToast === 'function') showToast('Env snippet copied.');
        }).catch(() => {});
      }
    };
  }
  const btnIntegrationsHowToAgentception = el('btn-integrations-how-to-agentception');
  if (btnIntegrationsHowToAgentception) {
    btnIntegrationsHowToAgentception.onclick = () => {
      closeSettings();
      openHowToUse('setup');
    };
  }
  const btnHowToFlexibleNetwork = el('btn-how-to-flexible-network');
  if (btnHowToFlexibleNetwork) {
    btnHowToFlexibleNetwork.onclick = () => {
      closeSettings();
      openHowToUse('setup', 'how-to-flexible-network');
    };
  }

  function renderProposalMarkdownHtml(md) {
    try {
      if (typeof marked !== 'undefined' && marked.parse && typeof DOMPurify !== 'undefined') {
        var raw = marked.parse(isolateVideoUrlLines(md || ''), { breaks: true });
        var withVideo = expandVideoUrls(raw);
        var sanitised = DOMPurify.sanitize(withVideo, SANITIZE_OPTS_NOTE);
        return rewriteGitHubImageUrls(sanitised);
      }
    } catch (_) {
      /* fall through */
    }
    return escapeHtml(md || '');
  }

  /** Canister stores checklist as JSON text; Node may return an array. */
  function parseProposalEvaluationChecklist(raw) {
    if (Array.isArray(raw)) return raw;
    if (raw == null || raw === '') return [];
    const s = String(raw).trim();
    if (!s) return [];
    try {
      const j = JSON.parse(s);
      return Array.isArray(j) ? j : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * Shown when reopening approved/discarded proposals (editable eval UI only exists for proposed).
   */
  function buildProposalEvaluationRecordHtml(p, rubricItems) {
    const st = p.status;
    if (st !== 'approved' && st !== 'discarded') return '';
    const checklist = parseProposalEvaluationChecklist(p.evaluation_checklist);
    const es = p.evaluation_status != null ? String(p.evaluation_status).trim() : '';
    const comment = p.evaluation_comment != null ? String(p.evaluation_comment).trim() : '';
    const grade = p.evaluation_grade != null ? String(p.evaluation_grade).trim() : '';
    const meaningfulStatus = es && es !== 'none';
    let waiverText = '';
    const w = p.evaluation_waiver;
    if (w != null && w !== '') {
      try {
        const o = typeof w === 'object' && w !== null ? w : JSON.parse(String(w));
        if (o && typeof o === 'object') {
          const r1 = o.reason != null ? String(o.reason).trim() : '';
          const r2 = o.waiver_reason != null ? String(o.waiver_reason).trim() : '';
          waiverText = r1 || r2;
        }
      } catch (_) {
        /* ignore */
      }
    }
    if (!meaningfulStatus && !comment && !grade && checklist.length === 0 && !waiverText) return '';
    const rubricById = new Map(
      (Array.isArray(rubricItems) ? rubricItems : []).map((it) => [
        String(it.id || '').trim(),
        String(it.label || it.id || '').trim(),
      ]),
    );
    const rows = checklist
      .map((c) => {
        const rid = c && c.id != null ? String(c.id) : '';
        const lab = (rubricById.get(rid) || rid || 'item').trim() || 'item';
        const pass = c && c.passed === true;
        return '<li class="small">' + escapeHtml(lab) + ': <strong>' + (pass ? 'pass' : 'not pass') + '</strong></li>';
      })
      .join('');
    return (
      '<div class="proposal-eval proposal-eval-readonly">' +
      '<h4 class="proposal-md-heading">Evaluation record</h4>' +
      '<p class="small">' +
      (meaningfulStatus ? '<strong>Outcome</strong>: ' + escapeHtml(es) : '<strong>Outcome</strong>: —') +
      (grade ? ' · <strong>Grade</strong>: ' + escapeHtml(grade) : '') +
      (p.evaluated_by ? ' · <strong>By</strong>: ' + escapeHtml(String(p.evaluated_by)) : '') +
      (p.evaluated_at
        ? ' · <span class="muted">' + escapeHtml(String(p.evaluated_at).slice(0, 19).replace('T', ' ')) + '</span>'
        : '') +
      '</p>' +
      (comment ? '<p class="small proposal-eval-record-comment">' + escapeHtml(comment) + '</p>' : '') +
      (rows ? '<ul class="proposal-eval-readonly-list">' + rows + '</ul>' : '') +
      (waiverText ? '<p class="small"><strong>Approve waiver</strong>: ' + escapeHtml(waiverText) + '</p>' : '') +
      '</div>'
    );
  }

  function openProposal(id) {
    currentNotePathForCopy = '';
    currentOpenNote = null;
    el('btn-copy-path').classList.add('hidden');
    const panel = el('detail-panel');
    panel.classList.add('detail-panel-proposal-wide');
    const title = el('detail-title');
    const body = el('detail-body');
    const actions = el('detail-actions');
    body.className = 'detail-body-proposal';
    panel.classList.remove('hidden');
    body.innerHTML = '<p class="muted">Loading…</p>';
    actions.innerHTML = '';
    const pathEnc = (pth) => encodeURIComponent(String(pth || '').replace(/\\/g, '/'));
    api('/api/v1/proposals/' + encodeURIComponent(id))
      .then((p) =>
        api('/api/v1/notes/' + pathEnc(p.path)).then(
          (note) => ({ p, note }),
          () => ({ p, note: null }),
        ),
      )
      .then(({ p, note }) => {
        title.textContent = p.path + ' (' + p.status + ')';
        const pFm = materializeFrontmatter(p.frontmatter);
        const currentBlock = note
          ? formatDetailReadBody(note.body || '', materializeFrontmatter(note.frontmatter))
          : '(No note at this path in the vault yet — Approve will create or overwrite this path.)';
        const proposedBlock = formatDetailReadBody(p.body || '', pFm);
        const mdHtml = renderProposalMarkdownHtml(p.body || '');
        const chips = [];
        if (p.proposed_by) chips.push('<span class="proposal-chip">by ' + escapeHtml(String(p.proposed_by)) + '</span>');
        if (p.source) chips.push('<span class="proposal-chip">' + escapeHtml(String(p.source)) + '</span>');
        (Array.isArray(p.labels) ? p.labels : []).forEach((x) => {
          chips.push('<span class="proposal-chip">' + escapeHtml(String(x)) + '</span>');
        });
        if (p.external_ref) {
          chips.push('<span class="proposal-chip">ref ' + escapeHtml(String(p.external_ref).slice(0, 40)) + '</span>');
        }
        const role = window.__hubUserRole || 'member';
        const isAdmin = role === 'admin';
        const isEvaluator = role === 'evaluator';
        const canEvaluate = isAdmin || isEvaluator;
        const canApprove = isAdmin || (isEvaluator && window.__hubEvaluatorMayApprove);
        const canDiscard = isAdmin;
        const rubricItems = Array.isArray(window.__hubProposalRubricItems) ? window.__hubProposalRubricItems : [];
        const prevChecklist = parseProposalEvaluationChecklist(p.evaluation_checklist);
        const evalRecordHtml = buildProposalEvaluationRecordHtml(p, rubricItems);
        function prevEvalPassed(rid) {
          const row = prevChecklist.find((c) => c && c.id === rid);
          return Boolean(row && row.passed === true);
        }
        let evalHtml = '';
        let waiverHtml = '';
        if (canEvaluate && p.status === 'proposed') {
          const es = p.evaluation_status || 'none';
          let evalIntro = '';
          if (es && es !== 'none' && es !== 'pending') {
            evalIntro =
              '<div class="proposal-eval-summary"><strong>Recorded evaluation</strong>: ' +
              escapeHtml(es) +
              (p.evaluation_grade ? ' · grade ' + escapeHtml(String(p.evaluation_grade)) : '') +
              (p.evaluated_at ? ' · ' + escapeHtml(String(p.evaluated_at).slice(0, 19).replace('T', ' ')) : '') +
              (p.evaluation_comment
                ? '<p class="small">' + escapeHtml(String(p.evaluation_comment)) + '</p>'
                : '') +
              '</div>';
          } else if (es === 'pending' || window.__hubProposalEvaluationRequired) {
            evalIntro =
              '<p class="small muted">Human evaluation is required before approve, unless you use an approve waiver reason below.</p>';
          }
          const checks = rubricItems.length
            ? rubricItems
                .map((it) => {
                  const rid = String(it.id || '').trim();
                  if (!rid) return '';
                  const lab = String(it.label || rid);
                  const ck = prevEvalPassed(rid) ? ' checked' : '';
                  return (
                    '<label class="proposal-eval-check"><input type="checkbox" data-proposal-eval-id="' +
                    escapeHtml(rid) +
                    '"' +
                    ck +
                    ' /> ' +
                    escapeHtml(lab) +
                    '</label>'
                  );
                })
                .join('')
            : '<p class="small muted">No rubric items loaded. Defaults ship in-repo; optional override: <code>data/hub_proposal_rubric.json</code>.</p>';
          const gradeVal = p.evaluation_grade != null ? escapeHtml(String(p.evaluation_grade)) : '';
          evalHtml =
            '<div class="proposal-eval">' +
            '<h4 class="proposal-md-heading">Evaluation</h4>' +
            evalIntro +
            '<label class="proposal-eval-field">Outcome <select id="proposal-eval-outcome">' +
            '<option value="pass">Pass</option>' +
            '<option value="fail">Fail</option>' +
            '<option value="needs_changes">Needs changes</option>' +
            '</select></label>' +
            '<label class="proposal-eval-field">Grade (optional) <input type="text" id="proposal-eval-grade" maxlength="32" value="' +
            gradeVal +
            '" placeholder="e.g. A or 4" /></label>' +
            '<div class="proposal-eval-checklist">' +
            checks +
            '</div>' +
            '<label class="proposal-eval-field">Comment <textarea id="proposal-eval-comment" rows="3" placeholder="Required for fail / needs changes">' +
            escapeHtml(p.evaluation_comment != null ? String(p.evaluation_comment) : '') +
            '</textarea></label>' +
            '<button type="button" class="btn-secondary" id="proposal-eval-save">Save evaluation</button>' +
            '</div>';
        }
        if (canApprove && p.status === 'proposed') {
          waiverHtml =
            '<div class="proposal-eval-waiver">' +
            '<label class="proposal-eval-field">Approve waiver reason <textarea id="proposal-waiver-reason" rows="2" placeholder="If approving without a passed evaluation, enter at least 3 characters."></textarea></label>' +
            '</div>';
        }
        let autoFlagHtml = '';
        if (Array.isArray(p.auto_flag_reasons) && p.auto_flag_reasons.length) {
          autoFlagHtml =
            '<p class="small muted">Auto-flagged: ' +
            p.auto_flag_reasons.map((x) => escapeHtml(String(x))).join(', ') +
            '</p>';
        } else if (p.auto_flag_reasons_json != null && String(p.auto_flag_reasons_json).trim()) {
          try {
            const ar = JSON.parse(String(p.auto_flag_reasons_json));
            if (Array.isArray(ar) && ar.length) {
              autoFlagHtml =
                '<p class="small muted">Auto-flagged: ' + ar.map((x) => escapeHtml(String(x))).join(', ') + '</p>';
            }
          } catch (_) {
            /* ignore */
          }
        }
        let hintsHtml = '';
        if (p.review_hints) {
          hintsHtml =
            '<div class="proposal-review-hints"><strong>Review hints</strong>' +
            (p.review_hints_model
              ? ' <span class="muted">(' + escapeHtml(String(p.review_hints_model)) + ')</span>'
              : '') +
            (p.review_hints_at
              ? ' <span class="muted">' + escapeHtml(String(p.review_hints_at).slice(0, 19)) + '</span>'
              : '') +
            '<p class="small muted" style="margin: 0.35rem 0 0.5rem;">Use as a review checklist; copy into your comment if helpful — you still decide pass or fail.</p>' +
            '<pre class="proposal-pre">' +
            escapeHtml(String(p.review_hints)) +
            '</pre><p class="small muted">Hints are machine-generated and untrusted — humans decide evaluation outcome.</p></div>';
        }
        let assistantHtml = '';
        if (p.assistant_notes) {
          const sug = (Array.isArray(p.suggested_labels) ? p.suggested_labels : [])
            .map((x) => '<span class="proposal-chip">' + escapeHtml(String(x)) + '</span>')
            .join('');
          assistantHtml =
            '<div class="proposal-assistant"><strong>Assistant</strong>' +
            (p.assistant_model ? ' <span class="muted">(' + escapeHtml(String(p.assistant_model)) + ')</span>' : '') +
            (p.assistant_at ? ' <span class="muted">' + escapeHtml(String(p.assistant_at).slice(0, 19)) + '</span>' : '') +
            '<p class="small muted" style="margin: 0.35rem 0 0.5rem;">Quick summary and label ideas from the model; verify before trusting or reusing (e.g. paste into your comment or frontmatter after approve).</p>' +
            '<p>' +
            escapeHtml(String(p.assistant_notes)) +
            '</p>' +
            (sug ? '<div class="proposal-meta-chips">' + sug + '</div>' : '') +
            '</div>';
        }
        let suggestedFmHtml = '';
        {
          let fm = p.assistant_suggested_frontmatter;
          if (typeof fm === 'string') {
            try {
              fm = JSON.parse(fm);
            } catch {
              fm = null;
            }
          }
          if (fm && typeof fm === 'object' && !Array.isArray(fm)) {
            const keys = Object.keys(fm).filter((k) => {
              const v = fm[k];
              return v !== undefined && v !== null && v !== '';
            });
            if (keys.length) {
              const rows = keys
                .map((k) => {
                  const v = fm[k];
                  let cell;
                  if (Array.isArray(v)) cell = v.map((x) => String(x)).join(', ');
                  else if (v !== null && typeof v === 'object') cell = JSON.stringify(v);
                  else cell = String(v);
                  return (
                    '<tr><th scope="row">' +
                    escapeHtml(k) +
                    '</th><td>' +
                    escapeHtml(cell) +
                    '</td></tr>'
                  );
                })
                .join('');
              suggestedFmHtml =
                '<div class="proposal-suggested-fm">' +
                '<strong>Suggested frontmatter</strong> ' +
                '<button type="button" class="btn-link btn-link-small" id="proposal-suggested-fm-copy">Copy JSON</button>' +
                '<p class="small muted" style="margin: 0.35rem 0 0.5rem;">From the assistant run; not applied on approve — verify before reusing in a note.</p>' +
                '<table class="proposal-suggested-fm-table"><tbody>' +
                rows +
                '</tbody></table></div>';
            }
          }
        }
        const openVaultNoteLine = note
          ? '<p class="small proposal-open-note-wrap"><button type="button" class="btn-link btn-link-small" id="proposal-open-note-btn">Open vault note to edit</button> <span class="muted">— tags, episode, entity, causal chain (frontmatter); use Activity again to return to this proposal.</span></p>'
          : '<p class="small muted">No note file at this path yet — approving creates or overwrites the file from the proposal body; then you can edit frontmatter.</p>';
        body.innerHTML =
          (chips.length ? '<div class="proposal-meta-chips">' + chips.join('') + '</div>' : '') +
          autoFlagHtml +
          '<p class="small muted">Intent: ' +
          escapeHtml(p.intent || '—') +
          ' · base_state_id: ' +
          escapeHtml(p.base_state_id || '—') +
          (p.evaluation_status ? ' · evaluation: ' + escapeHtml(String(p.evaluation_status)) : '') +
          (p.review_queue ? ' · queue: ' + escapeHtml(String(p.review_queue)) : '') +
          (p.review_severity ? ' · severity: ' + escapeHtml(String(p.review_severity)) : '') +
          '</p>' +
          openVaultNoteLine +
          '<div class="proposal-diff-grid">' +
          '<div><h4>Current vault</h4><pre class="proposal-pre">' +
          escapeHtml(currentBlock) +
          '</pre></div>' +
          '<div><h4>Proposed</h4><pre class="proposal-pre">' +
          escapeHtml(proposedBlock) +
          '</pre></div>' +
          '</div>' +
          '<h4 class="proposal-md-heading">Proposed body (rendered)</h4>' +
          '<div class="proposal-md">' +
          mdHtml +
          '</div>' +
          evalRecordHtml +
          evalHtml +
          waiverHtml +
          assistantHtml +
          suggestedFmHtml +
          hintsHtml;
        actions.innerHTML = '';
        const openNoteBtn = body.querySelector('#proposal-open-note-btn');
        if (openNoteBtn && note && p.path) {
          openNoteBtn.onclick = () => openNote(String(p.path));
        }
        const copyFmBtn = body.querySelector('#proposal-suggested-fm-copy');
        if (copyFmBtn) {
          let fmForCopy = p.assistant_suggested_frontmatter;
          if (typeof fmForCopy === 'string') {
            try {
              fmForCopy = JSON.parse(fmForCopy);
            } catch {
              fmForCopy = null;
            }
          }
          if (fmForCopy && typeof fmForCopy === 'object' && !Array.isArray(fmForCopy)) {
            copyFmBtn.onclick = async () => {
              try {
                await navigator.clipboard.writeText(JSON.stringify(fmForCopy, null, 2));
                showToast('Copied suggested frontmatter JSON.');
              } catch (err) {
                showToast(err.message || 'Copy failed', true);
              }
            };
          }
        }
        const saveEvalBtn = body.querySelector('#proposal-eval-save');
        if (saveEvalBtn) {
          saveEvalBtn.onclick = async () => {
            const outcomeEl = body.querySelector('#proposal-eval-outcome');
            const outcome = outcomeEl ? String(outcomeEl.value || 'pass') : 'pass';
            const gradeEl = body.querySelector('#proposal-eval-grade');
            const grade = gradeEl ? String(gradeEl.value || '').trim() : '';
            const commentEl = body.querySelector('#proposal-eval-comment');
            const comment = commentEl ? String(commentEl.value || '').trim() : '';
            const checklist = [];
            body.querySelectorAll('input[data-proposal-eval-id]').forEach((inp) => {
              checklist.push({ id: inp.getAttribute('data-proposal-eval-id'), passed: Boolean(inp.checked) });
            });
            try {
              await withButtonBusy(saveEvalBtn, 'Saving…', async () => {
                await api('/api/v1/proposals/' + encodeURIComponent(id) + '/evaluation', {
                  method: 'POST',
                  body: JSON.stringify({
                    outcome,
                    grade: grade || undefined,
                    comment: comment || undefined,
                    checklist,
                  }),
                });
              });
              showToast('Evaluation saved.');
              openProposal(id);
              loadProposals();
            } catch (err) {
              showToast(err.message || 'Evaluation failed', true);
            }
          };
        }
        if (p.status === 'proposed') {
          if (canApprove) {
            const approveBtn = document.createElement('button');
            approveBtn.textContent = 'Approve';
            approveBtn.onclick = () => approveProposal(id, panel, approveBtn);
            actions.append(approveBtn);
          }
          if (canDiscard) {
            const discardBtn = document.createElement('button');
            discardBtn.textContent = 'Discard';
            discardBtn.onclick = () => discardProposal(id, panel, discardBtn);
            actions.append(discardBtn);
          }
          if (canEvaluate && window.__hubProposalEnrich && hubUserMayEnrichProposal()) {
            const enrichBtn = document.createElement('button');
            enrichBtn.type = 'button';
            enrichBtn.className = 'btn-secondary';
            enrichBtn.textContent = 'Enrich (AI)';
            enrichBtn.onclick = () => enrichProposal(id, panel, enrichBtn);
            actions.append(enrichBtn);
          }
          if (isEvaluator && !canApprove) {
            const hintEv = document.createElement('p');
            hintEv.className = 'muted small';
            hintEv.textContent =
              'You can record evaluation; approve needs permission (admin, or evaluator with “may approve” in Team / host default). Discard is admin-only.';
            actions.append(hintEv);
          } else if (!canEvaluate) {
            const hint = document.createElement('p');
            hint.className = 'muted small';
            hint.textContent =
              'Your role cannot record evaluation here. Admins and evaluators evaluate; approve/discard follows Hub policy.';
            actions.append(hint);
          }
        }
      })
      .catch((e) => {
        body.className = 'detail-body-proposal';
        body.innerHTML = '<p class="muted">Error: ' + escapeHtml(e.message) + '</p>';
      });
  }

  async function enrichProposal(id, panel, btn) {
    try {
      await withButtonBusy(btn, 'Enriching…', async () => {
        await api('/api/v1/proposals/' + encodeURIComponent(id) + '/enrich', { method: 'POST', body: '{}' });
      });
      showToast('Proposal enriched.');
      openProposal(id);
      loadProposals();
      // Scroll the detail panel to the top so enriched content (labels, frontmatter, hints)
      // is visible instead of the browser staying at whatever scroll position it was at.
      const scrollHost = el('detail-body');
      if (scrollHost) requestAnimationFrame(() => scrollHost.scrollTo({ top: 0, behavior: 'smooth' }));
      // Also highlight the matching row in the Suggested/Activity list so the user can see which
      // proposal was enriched.
      requestAnimationFrame(() => {
        const row = document.querySelector('[data-id="' + CSS.escape(id) + '"]');
        if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    } catch (e) {
      showToast(e.message || 'Enrich failed', true);
    }
  }

  async function approveProposal(id, panel, btn) {
    try {
      const db = el('detail-body');
      const waiverEl = db && db.querySelector ? db.querySelector('#proposal-waiver-reason') : null;
      const waiver_reason = waiverEl && waiverEl.value ? String(waiverEl.value).trim() : '';
      const approveBody = {};
      if (waiver_reason) approveBody.waiver_reason = waiver_reason;
      let approveOut = null;
      await withButtonBusy(btn, 'Approving…', async () => {
        approveOut = await api('/api/v1/proposals/' + encodeURIComponent(id) + '/approve', {
          method: 'POST',
          body: JSON.stringify(approveBody),
        });
      });
      if (approveOut && approveOut.approval_log_written === false) {
        showToast(
          approveOut.approval_log_error
            ? 'Approved, but approval log failed: ' + String(approveOut.approval_log_error).slice(0, 120)
            : 'Approved, but approval log was not written. Check server logs and re-index.',
          true,
        );
      }
      hideDetailPanelChrome();
      loadProposals();
      loadNotes();
      loadActivity();
    } catch (e) {
      const db = el('detail-body');
      if (db) {
        const extra = document.createElement('p');
        extra.className = 'muted';
        extra.textContent = 'Approve failed: ' + (e.message || String(e));
        db.appendChild(extra);
      }
    }
  }

  async function discardProposal(id, panel, btn) {
    try {
      await withButtonBusy(btn, 'Discarding…', async () => {
        await api('/api/v1/proposals/' + encodeURIComponent(id) + '/discard', { method: 'POST' });
      });
      hideDetailPanelChrome();
      loadProposals();
      loadActivity();
    } catch (e) {
      const db = el('detail-body');
      if (db) {
        const extra = document.createElement('p');
        extra.className = 'muted';
        extra.textContent = 'Discard failed: ' + (e.message || String(e));
        db.appendChild(extra);
      }
    }
  }

  el('detail-close').onclick = () => closeDetailPanel();
  // Footer close must be resolved inside #detail-panel only: note/proposal HTML can inject ids
  // (e.g. markdown heading ids) that collide with getElementById and steal the handler.
  (function wireDetailPanelFooterClose() {
    const panel = el('detail-panel');
    const footBtn = panel && panel.querySelector('button[data-hub-detail-close]');
    if (footBtn) footBtn.addEventListener('click', () => closeDetailPanel());
  })();

  // Resizable detail panel — drag the left edge to widen/narrow.
  (function initDetailPanelResize() {
    const panel = el('detail-panel');
    if (!panel) return;
    const handle = document.createElement('div');
    handle.className = 'detail-resize-handle';
    handle.title = 'Drag to resize panel';
    panel.prepend(handle);
    const MIN_W = 280;
    const MAX_W = Math.round(window.innerWidth * 0.92);
    let startX = 0, startW = 0, dragging = false;
    const onMove = (e) => {
      if (!dragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const delta = startX - clientX;
      const newW = Math.max(MIN_W, Math.min(MAX_W, startW + delta));
      panel.style.width = newW + 'px';
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      document.body.style.userSelect = '';
    };
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startW = panel.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    handle.addEventListener('touchstart', (e) => {
      dragging = true;
      startX = e.touches[0].clientX;
      startW = panel.offsetWidth;
      handle.classList.add('dragging');
      document.addEventListener('touchmove', onMove, { passive: true });
      document.addEventListener('touchend', onUp);
    });
  })();

  document.addEventListener('keydown', (e) => {
    const inInput = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
      if (e.key === 'Escape') {
      if (el('detail-panel') && !el('detail-panel').classList.contains('hidden')) {
        closeDetailPanel();
        e.preventDefault();
      /* Close the topmost modal first (later in DOM stacks above onboarding when both are open). */
      } else if (el('modal-how-to-use') && !el('modal-how-to-use').classList.contains('hidden')) {
        closeHowToUse();
        e.preventDefault();
      } else if (el('modal-settings') && !el('modal-settings').classList.contains('hidden')) {
        closeSettings();
        e.preventDefault();
      } else if (el('modal-projects-help') && !el('modal-projects-help').classList.contains('hidden')) {
        closeProjectsHelpModal();
        e.preventDefault();
      } else if (el('modal-onboarding') && !el('modal-onboarding').classList.contains('hidden')) {
        closeOnboardingWizardResume();
        e.preventDefault();
      } else if (el('modal-import') && !el('modal-import').classList.contains('hidden')) {
        closeImportModal();
        e.preventDefault();
      } else if (el('modal-create-proposal') && !el('modal-create-proposal').classList.contains('hidden')) {
        closeCreateProposalModal();
        e.preventDefault();
      } else if (el('modal-create') && !el('modal-create').classList.contains('hidden')) {
        closeCreateModal();
        e.preventDefault();
      } else if (el('search-key-help')?.open) {
        el('search-key-help').open = false;
        e.preventDefault();
      }
      return;
    }
    if (inInput && e.key !== 'Escape') return;
    if (e.key === '/') {
      searchQuery.focus();
      e.preventDefault();
      return;
    }
    // Enter: if the search box has text but focus is elsewhere (e.g. after clicking the list),
    // run semantic search instead of opening the selected row (avoids "second search does nothing").
    if (e.key === 'Enter') {
      const q = (searchQuery.value || '').trim();
      if (q) {
        e.preventDefault();
        void runVaultSearch();
        return;
      }
    }
    const notesTabActive = document.querySelector('[data-tab="notes"]')?.classList.contains('active');
    const listViewVisible = !el('notes-view-list').classList.contains('hidden');
    const items = notesList.querySelectorAll('.list-item');
    if (notesTabActive && listViewVisible && items.length > 0) {
      if (e.key === 'j' || e.key === 'J') {
        listSelectedIndex = Math.min(listSelectedIndex + 1, items.length - 1);
        updateListSelection();
        e.preventDefault();
      } else if (e.key === 'k' || e.key === 'K') {
        listSelectedIndex = Math.max(listSelectedIndex - 1, 0);
        updateListSelection();
        e.preventDefault();
      } else if (e.key === 'Enter' && items[listSelectedIndex]) {
        const node = items[listSelectedIndex];
        if (node.dataset.path) openNote(node.dataset.path);
        else if (node.dataset.id) openProposal(node.dataset.id);
        e.preventDefault();
      }
    }
  });

  document.addEventListener('click', (e) => {
    const keyHelp = el('search-key-help');
    if (!keyHelp || !keyHelp.open) return;
    if (keyHelp.contains(e.target)) return;
    keyHelp.open = false;
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.onclick = () => {
      switchHubMainTab(tab.dataset.tab);
    };
  });
  if (btnHeaderSuggested) {
    btnHeaderSuggested.addEventListener('click', () => switchHubMainTab('suggested'));
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  // ── Consolidation UI (Stream 2) ───────────────────────────────

  function consolModeFromSettings(s) {
    if (!s || !s.daemon) return 'off';
    if (s.daemon.enabled) return 'daemon';
    if (s.hosted_delegating || (s.vault_path_display || '').toLowerCase() === 'canister') return 'hosted';
    return 'off';
  }

  function populateConsolSettingsForm(s) {
    if (!s || !s.daemon) return;
    const d = s.daemon;
    const mode = consolModeFromSettings(s);
    document.querySelectorAll('input[name="consol-mode"]').forEach((r) => { r.checked = r.value === mode; });
    applyConsolModeVisibility(mode);
    const iv = el('consol-interval');
    if (iv) iv.value = d.interval_minutes ?? 120;
    const idle = el('consol-idle-only');
    if (idle) idle.checked = d.idle_only !== false;
    const idleTh = el('consol-idle-threshold');
    if (idleTh) idleTh.value = d.idle_threshold_minutes ?? 15;
    const ros = el('consol-run-on-start');
    if (ros) ros.checked = Boolean(d.run_on_start);
    const pc = el('pass-consolidate');
    if (pc) pc.checked = d.passes?.consolidate !== false;
    const pv = el('pass-verify');
    if (pv) pv.checked = d.passes?.verify !== false;
    const pd = el('pass-discover');
    if (pd) pd.checked = Boolean(d.passes?.discover);
    const lp = el('consol-llm-provider');
    if (lp) lp.value = d.llm?.provider || '';
    const lm = el('consol-llm-model');
    if (lm) lm.value = d.llm?.model || '';
    const lb = el('consol-llm-base-url');
    if (lb) lb.value = d.llm?.base_url || '';
    const lbh = el('consol-lookback-hours');
    if (lbh) lbh.value = d.lookback_hours ?? 24;
    const me = el('consol-max-events');
    if (me) me.value = d.max_events_per_pass ?? 200;
    const mt = el('consol-max-topics');
    if (mt) mt.value = d.max_topics_per_pass ?? 10;
    const lmt = el('consol-llm-max-tokens');
    if (lmt) lmt.value = d.llm?.max_tokens ?? 1024;
    const cc = el('consol-cost-cap');
    if (cc) cc.value = d.max_cost_per_day_usd != null ? d.max_cost_per_day_usd : '';
    const chi = el('consol-hosted-interval');
    if (chi && d.interval_minutes != null) {
      const v = String(d.interval_minutes);
      const allowed = ['30', '60', '120', '360', '720', '1440', '10080'];
      chi.value = allowed.includes(v) ? v : '120';
    }
  }

  function buildConsolSettingsPayload() {
    const modeRadio = document.querySelector('input[name="consol-mode"]:checked');
    const mode = modeRadio ? modeRadio.value : 'off';
    const hostedSel = el('consol-hosted-interval');
    const intervalRaw =
      mode === 'hosted' && hostedSel ? hostedSel.value : el('consol-interval')?.value;
    const llm = {
      provider: el('consol-llm-provider')?.value || '',
      model: el('consol-llm-model')?.value || '',
      base_url: el('consol-llm-base-url')?.value || '',
    };
    if (mode === 'daemon') {
      llm.max_tokens = Math.max(
        64,
        Math.min(8192, Math.floor(Number(el('consol-llm-max-tokens')?.value) || 1024)),
      );
    }
    const payload = {
      mode,
      enabled: mode === 'daemon',
      interval_minutes: Math.max(1, Math.floor(Number(intervalRaw) || 120)),
      idle_only: Boolean(el('consol-idle-only')?.checked),
      idle_threshold_minutes: Math.max(1, Math.floor(Number(el('consol-idle-threshold')?.value) || 15)),
      run_on_start: Boolean(el('consol-run-on-start')?.checked),
      passes: {
        consolidate: Boolean(el('pass-consolidate')?.checked),
        verify: Boolean(el('pass-verify')?.checked),
        discover: Boolean(el('pass-discover')?.checked),
      },
      llm,
      max_cost_per_day_usd: el('consol-cost-cap')?.value === '' ? null : Number(el('consol-cost-cap')?.value) || 0,
    };
    if (mode === 'daemon') {
      payload.lookback_hours = Math.max(
        1,
        Math.min(8760, Math.floor(Number(el('consol-lookback-hours')?.value) || 24)),
      );
      payload.max_events_per_pass = Math.max(
        1,
        Math.min(10000, Math.floor(Number(el('consol-max-events')?.value) || 200)),
      );
      payload.max_topics_per_pass = Math.max(
        1,
        Math.min(500, Math.floor(Number(el('consol-max-topics')?.value) || 10)),
      );
    }
    return payload;
  }

  function applyConsolModeVisibility(mode) {
    const daemonSection = el('consol-daemon-settings');
    const hostedSection = el('consol-hosted-settings');
    const llmSection = el('consol-llm-settings');
    const costGuard = el('consol-cost-guard');
    if (daemonSection) daemonSection.style.display = mode === 'daemon' ? '' : 'none';
    if (hostedSection) hostedSection.style.display = mode === 'hosted' ? '' : 'none';
    if (llmSection) llmSection.style.display = mode === 'daemon' ? '' : 'none';
    if (costGuard) costGuard.style.display = mode === 'daemon' ? '' : 'none';
  }

  document.querySelectorAll('input[name="consol-mode"]').forEach((radio) => {
    radio.addEventListener('change', () => applyConsolModeVisibility(radio.value));
  });

  async function loadConsolidationSettings() {
    const msg = el('consol-save-status');
    if (msg) msg.textContent = '';
    try {
      const s = await api('/api/v1/settings');
      populateConsolSettingsForm(s);
    } catch (e) {
      if (msg) { msg.textContent = e?.message || 'Failed to load settings'; msg.className = 'settings-msg err'; }
    }
  }

  const btnConsolSave = el('btn-consol-save');
  if (btnConsolSave) {
    btnConsolSave.addEventListener('click', async () => {
      const msg = el('consol-save-status');
      if (msg) { msg.textContent = ''; msg.className = 'settings-msg'; }
      const payload = buildConsolSettingsPayload();
      if (payload.enabled && payload.interval_minutes < 30) {
        if (msg) { msg.textContent = 'Interval must be at least 30 minutes in daemon mode.'; msg.className = 'settings-msg err'; }
        return;
      }
      setButtonBusy(btnConsolSave, true, 'Saving…');
      try {
        await api('/api/v1/settings/consolidation', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        if (msg) { msg.textContent = 'Saved.'; msg.className = 'settings-msg ok'; }
      } catch (e) {
        if (msg) { msg.textContent = e?.message || 'Failed to save'; msg.className = 'settings-msg err'; }
      }
      setButtonBusy(btnConsolSave, false);
    });
  }

  const linkConsolHelp = el('link-consol-help');
  if (linkConsolHelp) {
    linkConsolHelp.addEventListener('click', (e) => {
      e.preventDefault();
      closeSettings();
      openHowToUse('consolidation');
    });
  }

  // ── Consolidation Dashboard Card ──────────────────────────────

  function formatCostMeter(costUsd, capUsd) {
    const cost = Math.max(0, Number(costUsd) || 0);
    const cap = capUsd != null ? Math.max(0, Number(capUsd) || 0) : null;
    const display = '$' + cost.toFixed(3) + ' today';
    if (cap == null || cap === 0) return { fillPercent: 0, display, capLabel: '', showMeter: false };
    const pct = Math.min(100, (cost / cap) * 100);
    return { fillPercent: pct, display, capLabel: 'cap: $' + cap.toFixed(2), showMeter: true };
  }

  function renderConsolidationHistory(events, container) {
    if (!container) return;
    if (!events || events.length === 0) {
      container.innerHTML = '<p class="muted">No consolidation history found.</p>';
      return;
    }
    let html = '<table class="consol-history-table"><thead><tr><th>Date</th><th>Topics</th><th>Events Merged</th><th>Status</th></tr></thead><tbody>';
    events.forEach((ev) => {
      const ts = ev.ts || ev.timestamp || ev.created_at;
      const date = ts ? new Date(ts).toLocaleString() : '—';
      const rawTopics = ev.data?.topics_count;
      const topics = Array.isArray(rawTopics) ? rawTopics.length : (rawTopics ?? ev.data?.topics?.length ?? '—');
      const merged = ev.data?.total_events ?? ev.data?.event_count ?? '—';
      const status = ev.data?.dry_run ? 'dry-run' : (ev.data?.error ? 'error' : 'complete');
      html += '<tr><td>' + escapeHtml(date) + '</td><td>' + escapeHtml(String(topics)) + '</td><td>' + escapeHtml(String(merged)) + '</td><td>' + escapeHtml(status) + '</td></tr>';
    });
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  async function refreshConsolidationCard() {
    const card = el('consolidation-card');
    const badge = el('consol-status-badge');
    const lastPass = el('consol-last-pass');
    const nextPass = el('consol-next-pass');
    const quotaMeter = el('consol-quota-meter');
    const quotaLabel = el('consol-quota-label');
    const quotaFill = el('consol-quota-fill');
    const btnNow = el('btn-consol-now');
    if (!card) return;

    try {
      const s = await api('/api/v1/settings');
      const mode = consolModeFromSettings(s);
      if (mode === 'off') {
        card.style.display = 'none';
        return;
      }
      card.style.display = '';

      if (mode === 'hosted') {
        try {
          const st = await api('/api/v1/memory/consolidate/status');
          if (badge) {
            badge.textContent = '● Active (hosted)';
            badge.className = 'consol-badge consol-badge-success';
          }
          if (lastPass) lastPass.textContent = 'Last pass: ' + (st.last_pass ? new Date(st.last_pass).toLocaleString() : '—');
          if (nextPass) nextPass.textContent = 'Next pass: scheduled';

          // Quota display using tier limit from local constant (same source as billing-constants.mjs)
          const passUsed = st.pass_count_month ?? 0;
          const currentTier = (typeof window !== 'undefined' && window.__billing_tier) || 'free';
          const passLimit = CONSOLIDATION_PASSES_BY_TIER[currentTier] ?? 0;
          if (quotaMeter) {
            if (passLimit === null) {
              if (quotaLabel) quotaLabel.textContent = passUsed + ' consolidations this month (unlimited)';
              if (quotaFill) quotaFill.style.width = '0%';
            } else if (passLimit > 0) {
              const pct = Math.min(100, Math.round((passUsed / passLimit) * 100));
              if (quotaLabel) quotaLabel.textContent = passUsed + ' of ' + passLimit + ' consolidations used';
              if (quotaFill) quotaFill.style.width = pct + '%';
            }
            quotaMeter.style.display = passLimit !== 0 ? '' : 'none';
          }

          // Disable "Consolidate Now" during cooldown; show time remaining.
          const cooldown = st.cooldown_minutes ?? 0;
          if (btnNow && cooldown > 0) {
            btnNow.disabled = true;
            btnNow.textContent = 'Available in ' + cooldown + ' min';
          } else if (btnNow) {
            btnNow.disabled = false;
            btnNow.textContent = 'Consolidate Now';
          }
        } catch (_) {
          if (badge) { badge.textContent = '● Hosted'; badge.className = 'consol-badge consol-badge-warning'; }
        }
      } else {
        if (badge) {
          badge.textContent = s.daemon.enabled ? '● Daemon enabled' : '● Not running';
          badge.className = 'consol-badge ' + (s.daemon.enabled ? 'consol-badge-success' : 'consol-badge-warning');
        }
        if (lastPass) lastPass.textContent = 'Last pass: —';
        if (nextPass) nextPass.textContent = 'Next pass: ' + (s.daemon.enabled ? 'per daemon schedule' : '—');
        if (quotaMeter) quotaMeter.style.display = 'none';
      }
    } catch (_) {
      card.style.display = 'none';
    }
  }

  const btnConsolNow = el('btn-consol-now');
  if (btnConsolNow) {
    btnConsolNow.addEventListener('click', async () => {
      setButtonBusy(btnConsolNow, true, 'Previewing…');
      try {
        const preview = await api('/api/v1/memory/consolidate', {
          method: 'POST',
          body: JSON.stringify({ dry_run: true }),
        });
        setButtonBusy(btnConsolNow, false);
        const topicsRaw = preview.topics;
        const topics = Array.isArray(topicsRaw) ? topicsRaw.length : (preview.topics_count ?? topicsRaw ?? 0);
        const events = preview.total_events ?? 0;
        // Fetch current quota to show remaining passes in the preview dialog.
        let quotaLine = '';
        try {
          const st = await api('/api/v1/memory/consolidate/status');
          const passUsed = st.pass_count_month ?? 0;
          const currentTier = (typeof window !== 'undefined' && window.__billing_tier) || 'free';
          const passLimit = CONSOLIDATION_PASSES_BY_TIER[currentTier] ?? 0;
          if (passLimit === null) {
            quotaLine = '\nConsolidations this month: ' + passUsed + ' (unlimited)';
          } else if (passLimit > 0) {
            const remaining = Math.max(0, passLimit - passUsed);
            quotaLine = '\nConsolidations remaining: ' + remaining + ' of ' + passLimit;
          }
        } catch (_) {}
        const ok = confirm('Consolidation preview:\n\nTopics found: ' + topics + '\nEvents to merge: ' + events + quotaLine + '\n\nProceed?');
        if (!ok) return;
        setButtonBusy(btnConsolNow, true, 'Consolidating…');
        await api('/api/v1/memory/consolidate', {
          method: 'POST',
          body: JSON.stringify({ dry_run: false }),
        });
        if (typeof showToast === 'function') showToast('Consolidation complete.');
        refreshConsolidationCard();
      } catch (e) {
        const msg = e?.message || 'Consolidation failed';
        if (typeof showToast === 'function') showToast(msg, true);
        // Re-check cooldown after a rate-limit response so the button state updates.
        refreshConsolidationCard();
      }
      setButtonBusy(btnConsolNow, false);
    });
  }

  const btnConsolHistory = el('btn-consol-history');
  if (btnConsolHistory) {
    btnConsolHistory.addEventListener('click', async () => {
      setButtonBusy(btnConsolHistory, true, 'Loading…');
      try {
        const res = await api('/api/v1/memory?type=consolidation_pass&limit=20');
        const events = res.events || res.history || [];
        setButtonBusy(btnConsolHistory, false);
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.setAttribute('aria-modal', 'true');
        modal.innerHTML =
          '<div class="modal-backdrop"></div>' +
          '<div class="modal-card consol-history-modal">' +
          '<div class="modal-header"><h2>Consolidation History</h2><button type="button" class="modal-close" aria-label="Close">×</button></div>' +
          '<div style="padding: 1rem 1.25rem;" id="consol-history-body"></div></div>';
        document.body.appendChild(modal);
        renderConsolidationHistory(events, modal.querySelector('#consol-history-body'));
        modal.querySelector('.modal-backdrop').onclick = () => modal.remove();
        modal.querySelector('.modal-close').onclick = () => modal.remove();
      } catch (e) {
        setButtonBusy(btnConsolHistory, false);
        if (typeof showToast === 'function') showToast(e?.message || 'Failed to load history', true);
      }
    });
  }

  function openSettingsConsolidationTab() {
    openSettings();
    document.querySelectorAll('.settings-tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.settingsTab === 'consolidation');
      t.setAttribute('aria-selected', t.dataset.settingsTab === 'consolidation' ? 'true' : 'false');
    });
    document.querySelectorAll('.settings-panel').forEach((p) => {
      p.classList.toggle('active', p.id === 'settings-panel-consolidation');
    });
    loadConsolidationSettings();
  }

  const btnConsolSettings = el('btn-consol-settings');
  if (btnConsolSettings) {
    btnConsolSettings.addEventListener('click', openSettingsConsolidationTab);
  }

  // Billing panel: consolidation row population (piggyback on loadBillingPanel)
  const _origLoadBillingPanel = typeof loadBillingPanel === 'function' ? loadBillingPanel : null;
  // Billing consolidation row is populated inline in loadBillingPanel's try block.
  // We add to the existing billing flow by hooking the billing API response.

  // Refresh consolidation card when dashboard renders
  const _origRenderDashboard = typeof renderDashboard === 'function' ? renderDashboard : null;
})();
