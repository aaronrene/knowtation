/**
 * Knowtation Hub UI — list, calendar, overview, quick add, presets. Phase 11C.
 */

(function () {
  const params = new URLSearchParams(location.search);
  // Build-time or deployment config: set window.HUB_API_BASE_URL (e.g. from config.js). Empty string = same origin (when static host proxies /api to the gateway).
  const apiBase = (function resolveApiBase() {
    if (typeof window === 'undefined') return 'http://localhost:3333';
    if (Object.prototype.hasOwnProperty.call(window, 'HUB_API_BASE_URL')) {
      const v = window.HUB_API_BASE_URL;
      if (v == null) return params.get('api') || localStorage.getItem('hub_api_url') || location.origin || 'http://localhost:3333';
      const s = String(v).trim();
      if (s === '') return (location.origin || 'http://localhost:3333').replace(/\/$/, '');
      return s.replace(/\/$/, '');
    }
    return (
      params.get('api') ||
      localStorage.getItem('hub_api_url') ||
      location.origin ||
      'http://localhost:3333'
    );
  })();
  let token = params.get('token') || localStorage.getItem('hub_token');
  if (token) {
    localStorage.setItem('hub_token', token);
    if (params.has('token')) {
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
  const btnSearch = el('btn-search');
  const btnClearSearch = el('btn-clear-search');
  const btnApplyFilters = el('btn-apply-filters');
  const btnReindex = el('btn-reindex');
  const notesList = el('notes-list');
  const notesTotal = el('notes-total');
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
  let listSelectedIndex = 0;
  /** @type {import('chart.js').Chart[]} */
  let chartInstances = [];

  const ACCENT_STORAGE_KEY = 'hub_accent_color';
  const THEME_STORAGE_KEY = 'hub_theme';
  const DEFAULT_ACCENT = '#22d3ee';
  const DEFAULT_THEME = 'dark';
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
  (function initThemeAndAccent() {
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (savedTheme === 'light') applyTheme('light');
      const savedAccent = localStorage.getItem(ACCENT_STORAGE_KEY);
      if (savedAccent) applyAccent(savedAccent);
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
    let res;
    try {
      res = await fetch(apiBase + path, {
        ...opts,
        cache: opts.cache != null ? opts.cache : 'no-store',
        headers: { ...headers(), ...opts.headers },
      });
    } catch (e) {
      const m = e && e.message ? String(e.message) : String(e);
      if (m === 'Failed to fetch' || m.includes('NetworkError')) {
        throw new Error(
          'Could not reach the API (' +
            apiBase +
            '). Check gateway status, CORS (HUB_CORS_ORIGIN), ad blockers, and Netlify limits.',
        );
      }
      throw e instanceof Error ? e : new Error(m);
    }
    if (res.status === 401) {
      token = null;
      localStorage.removeItem('hub_token');
      if (app) app.classList.add('login-screen');
      main.classList.add('hidden');
      loginRequired.classList.remove('hidden');
      browseToolbar.classList.add('hidden');
      btnNewNote.classList.add('hidden');
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
          `Server returned a web page (${res.status}) instead of API JSON. If you just updated Knowtation, stop and restart the Hub (npm run hub) so routes like git-init are loaded.`,
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

  const HOSTED_BACKUP_REPO_LS = 'knowtation_hosted_backup_repo';
  const VAULT_ID_LS = 'hub_vault_id';

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
    const allowed = Array.isArray(allowedVaultIds) && allowedVaultIds.length ? allowedVaultIds : (vaultList.length ? vaultList.map((v) => v.id) : ['default']);
    const list = Array.isArray(vaultList) && vaultList.length ? vaultList : [{ id: 'default', label: 'Default' }];
    const options = list.filter((v) => allowed.includes(v.id));
    select.innerHTML = options.map((v) => '<option value="' + escapeHtml(v.id) + '">' + escapeHtml(v.label || v.id) + '</option>').join('');
    select.value = getCurrentVaultId();
    if (!allowed.includes(select.value)) select.value = allowed[0] || 'default';
    setCurrentVaultId(select.value);
    wrap.classList.toggle('hidden', list.length <= 1);
    if (list.length >= 2 && options.length === 1) {
      select.title = 'This Hub has more vaults. To use them, copy your User ID from Settings → Backup into Vault access on Settings → Vaults, then save and refresh.';
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
      } catch (_) {
        userName.textContent = 'Logged in';
        window.__hubUserRole = 'member';
        if (btnNewNote) btnNewNote.classList.remove('hidden');
        if (btnImport) btnImport.classList.remove('hidden');
      }
    } else {
      if (btnNewNote) btnNewNote.classList.remove('hidden');
      if (btnImport) btnImport.classList.remove('hidden');
    }
  }

  function loginUrl(provider) {
    const u = apiBase + '/api/v1/auth/login?provider=' + provider;
    const invite = params.get('invite');
    return invite ? u + '&invite=' + encodeURIComponent(invite) : u;
  }
  btnLoginGoogle.onclick = () => { window.location.href = loginUrl('google'); };
  btnLoginGithub.onclick = () => { window.location.href = loginUrl('github'); };

  btnLogout.onclick = () => {
    token = null;
    localStorage.removeItem('hub_token');
    if (app) app.classList.add('login-screen');
    main.classList.add('hidden');
    browseToolbar.classList.add('hidden');
    btnNewNote.classList.add('hidden');
    if (btnImport) btnImport.classList.add('hidden');
    if (btnHowToUse) btnHowToUse.classList.add('hidden');
    if (btnSettings) btnSettings.classList.add('hidden');
    loginRequired.classList.remove('hidden');
    if (loginIntro) loginIntro.classList.remove('hidden');
    showLoginChrome();
  };

  async function initProviders() {
    try {
      const r = await fetch(apiBase + '/api/v1/auth/providers', { cache: 'no-store' });
      if (!r.ok) throw new Error('providers');
      providers = await r.json();
    } catch (_) {
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
            if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
          }
        }
        if (typeof showToast === 'function') showToast(lastErr?.message || 'Invite could not be applied.', true);
      })();
    }
    showMain();
    (async function ensureVaultAndSwitcherThenLoad() {
      try {
        const s = await api('/api/v1/settings');
        if (s.role) window.__hubUserRole = String(s.role);
        const allowed = s.allowed_vault_ids || [];
        const current = getCurrentVaultId();
        if (allowed.length && !allowed.includes(current)) {
          setCurrentVaultId(allowed[0] || 'default');
        }
        updateVaultSwitcher(s.vault_list || [], s.allowed_vault_ids || []);
      } catch (_) {}
      loadFacets();
      loadNotes();
      loadProposals();
      loadActivity();
      renderPresets();
    })();
    initProviders();
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
    const inviteBanner = el('login-invite-banner');
    if (inviteBanner && params.get('invite')) {
      inviteBanner.textContent = "You've been invited. Sign in to join.";
      inviteBanner.classList.remove('hidden');
    }
    initProviders();
  }
  if (token && params.get('invite_accepted') === '1') {
    setTimeout(() => {
      if (typeof showToast === 'function') showToast("You've been added. Your role is shown in Settings.");
      const u = new URL(location.href);
      u.searchParams.delete('invite_accepted');
      history.replaceState({}, '', u.toString());
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

  function isoDateUtcFromMs(ms) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return y + '-' + mo + '-' + day;
  }

  /** When frontmatter is empty, infer YYYY-MM-DD from `note-<epochMs>.md` quick-capture paths (hosted legacy rows). */
  function inferredDisplayDateFromNotePath(notePath) {
    if (!notePath || typeof notePath !== 'string') return null;
    const base = notePath.split('/').pop() || '';
    const m = /^note-(\d{10,})\.md$/i.exec(base);
    if (!m) return null;
    const ms = Number(m[1]);
    if (!Number.isFinite(ms)) return null;
    return isoDateUtcFromMs(ms);
  }

  /** YYYY-MM-DD for calendar, overview, and range filters when `date` is unset (hosted notes often only have knowtation_edited_at). */
  function listItemDisplayDate(n, fm) {
    if (n.date != null && String(n.date).trim()) return String(n.date).trim().slice(0, 10);
    if (fm.date != null && String(fm.date).trim()) return String(fm.date).trim().slice(0, 10);
    const ke = fm.knowtation_edited_at;
    if (ke != null && String(ke).trim()) return String(ke).trim().slice(0, 10);
    const inferred = inferredDisplayDateFromNotePath(n.path);
    return inferred || null;
  }

  function noteSortOrCalendarDay(n) {
    return dateSlice(n.date || n.updated || '');
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
      const facets = await fetchFacetsResolved();
      filterProject.innerHTML = '<option value="">All projects</option>' + (facets.projects || []).map((p) => '<option value="' + escapeHtml(p) + '">' + escapeHtml(p) + '</option>').join('');
      filterTag.innerHTML = '<option value="">All tags</option>' + (facets.tags || []).map((t) => '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + '</option>').join('');
      filterFolder.innerHTML = '<option value="">All folders</option>' + (facets.folders || []).map((f) => '<option value="' + escapeHtml(f) + '">' + escapeHtml(f) + '</option>').join('');
      if (facets.projects?.includes(savedProject)) filterProject.value = savedProject;
      if (facets.tags?.includes(savedTag)) filterTag.value = savedTag;
      if (facets.folders?.includes(savedFolder)) filterFolder.value = savedFolder;
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

  function renderFilterChips(facets) {
    filterChipsEl.innerHTML = '<span class="toolbar-label">Quick</span>';
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
        filterChipsEl.appendChild(b);
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
        filterChipsEl.appendChild(b);
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
        filterChipsEl.appendChild(b);
      });
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
      b.title = [p.folder && 'folder:' + p.folder, p.project && 'project:' + p.project, p.tag && 'tag:' + p.tag, p.since && 'since:' + p.since, p.until && 'until:' + p.until].filter(Boolean).join(' ');
      b.onclick = () => {
        filterProject.value = p.project || '';
        filterTag.value = p.tag || '';
        filterFolder.value = p.folder || '';
        if (filterSince) filterSince.value = p.since || '';
        if (filterUntil) filterUntil.value = p.until || '';
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
    const chips = [];
    if (n.project) chips.push('<span class="chip chip-project">' + escapeHtml(n.project) + '</span>');
    (n.tags || []).slice(0, 3).forEach((t) => chips.push('<span class="chip chip-tag">' + escapeHtml(t) + '</span>'));
    const meta = [n.date].filter(Boolean).join(' · ');
    return (
      '<div class="list-item" data-path="' +
      escapeHtml(n.path) +
      '"><span class="row-title">' +
      escapeHtml(title) +
      '</span><div class="row-chips">' +
      chips.join('') +
      '</div>' +
      (meta ? '<div class="status">' + escapeHtml(meta) + '</div>' : '') +
      '</div>'
    );
  }

  function bindNoteClicks(container) {
    container.querySelectorAll('.list-item').forEach((item) => {
      item.onclick = () => openNote(item.dataset.path);
    });
  }

  async function loadNotes() {
    const q = new URLSearchParams();
    q.set('limit', '100');
    if (filterFolder.value) q.set('folder', filterFolder.value);
    if (filterProject.value) q.set('project', filterProject.value);
    if (filterTag.value) q.set('tag', filterTag.value);
    if (filterSince && filterSince.value) q.set('since', filterSince.value);
    if (filterUntil && filterUntil.value) q.set('until', filterUntil.value);
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
      });
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
    } catch (e) {
      notesList.innerHTML = '<p class="muted">' + escapeHtml(e.message) + '</p>';
      notesTotal.textContent = '';
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

  function formatSearchScopeSummary() {
    const parts = [];
    if (filterProject.value) parts.push('project: ' + filterProject.value);
    if (filterTag.value) parts.push('tag: ' + filterTag.value);
    if (filterFolder.value) parts.push('folder: ' + filterFolder.value);
    if (filterSince && filterSince.value) parts.push('since ' + filterSince.value);
    if (filterUntil && filterUntil.value) parts.push('until ' + filterUntil.value);
    return parts.length ? parts.join(' · ') : '';
  }

  function semanticMatchStrengthLabel(score) {
    if (score == null || typeof score !== 'number' || Number.isNaN(score)) return '';
    const pct = Math.round(Math.min(1, Math.max(0, score)) * 100);
    return 'Match strength ~' + pct + '% (higher = closer in meaning)';
  }

  if (btnClearSearch) {
    btnClearSearch.onclick = () => {
      searchQuery.value = '';
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

  if (btnReindex) {
    btnReindex.onclick = async () => {
      btnReindex.disabled = true;
      btnReindex.textContent = 'Indexing…';
      try {
        const out = await api('/api/v1/index', { method: 'POST' });
        const n = out.notesProcessed ?? 0;
        const c = out.chunksIndexed ?? 0;
        showToast('Indexed ' + n + ' notes, ' + c + ' chunks.');
        loadFacets();
        loadNotes();
      } catch (e) {
        showToast(e.message || 'Re-index failed', true);
      } finally {
        btnReindex.disabled = false;
        btnReindex.textContent = 'Re-index';
      }
    };
  }

  async function loadProposals() {
    const emptySuggested = '<div class="empty-state">No proposals waiting for review. Add notes with <strong>+ New note</strong> above, or have an agent or the CLI create a proposal for you to approve.</div>';
    const emptyDiscarded = '<div class="empty-state">No discarded proposals.</div>';
    [
      { kind: 'suggested', status: 'proposed', empty: emptySuggested },
      { kind: 'problem', status: 'discarded', empty: emptyDiscarded },
    ].forEach(({ kind, status, empty: emptyHtml }) => {
      const container = el('proposals-' + kind);
      if (!container) return;
      container.innerHTML = loadingHtml;
      api('/api/v1/proposals?status=' + status + '&limit=20')
        .then((out) => {
          const list = out.proposals || [];
          if (list.length === 0) {
            container.innerHTML = emptyHtml;
            return;
          }
          container.innerHTML = list
            .map(
              (p) =>
                '<div class="list-item" data-id="' +
                escapeHtml(p.proposal_id) +
                '"><span class="row-title">' +
                escapeHtml(p.path) +
                '</span><div class="status">' +
                escapeHtml(p.status) +
                (p.updated_at ? ' · ' + p.updated_at.slice(0, 10) : '') +
                '</div></div>'
            )
            .join('');
          container.querySelectorAll('.list-item').forEach((item) => {
            item.onclick = () => openProposal(item.dataset.id);
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
      const out = await api('/api/v1/proposals?limit=50');
      const list = (out.proposals || []).sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''));
      if (list.length === 0) {
        container.innerHTML = '<div class="empty-state">No proposal activity yet.</div>';
        return;
      }
      container.innerHTML = list
        .map((p) => {
          const statusClass = p.status === 'approved' ? 'status-approved' : p.status === 'discarded' ? 'status-discarded' : 'status-proposed';
          const date = (p.updated_at || p.created_at || '').slice(0, 19).replace('T', ' ');
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
            '</div></div>'
          );
        })
        .join('');
      container.querySelectorAll('.list-item').forEach((item) => {
        item.onclick = () => openProposal(item.dataset.id);
      });
    } catch (e) {
      container.innerHTML = '<p class="muted">' + escapeHtml(e.message) + '</p>';
    }
  }

  async function runVaultSearch() {
    const query = searchQuery.value.trim();
    if (!query) return;
    switchNotesView('list');
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
    document.querySelector('[data-tab="notes"]').classList.add('active');
    el('tab-notes').classList.remove('hidden');
    notesList.innerHTML = loadingHtml;
    notesTotal.textContent = '';
    try {
      const body = { query, limit: 20 };
      if (filterProject.value) body.project = filterProject.value;
      if (filterTag.value) body.tag = filterTag.value;
      if (filterFolder.value) body.folder = filterFolder.value;
      if (filterSince && filterSince.value) body.since = filterSince.value;
      if (filterUntil && filterUntil.value) body.until = filterUntil.value;
      const out = await api('/api/v1/search', { method: 'POST', body: JSON.stringify(body) });
      const results = out.results || [];
      if (results.length === 0) {
        notesList.innerHTML =
          '<div class="empty-state">No notes matched this query under the current filters. Semantic search finds <em>similar meaning</em>, not exact words — try other phrases, clear filters, or use Quick chips + Apply filters for exact tags/projects.</div>';
        notesTotal.textContent = '0 semantic results';
        return;
      }
      notesList.innerHTML = results
        .map((r) => {
          const chips = [];
          if (r.project) chips.push('<span class="chip chip-project">' + escapeHtml(r.project) + '</span>');
          (r.tags || []).slice(0, 3).forEach((t) => chips.push('<span class="chip chip-tag">' + escapeHtml(t) + '</span>'));
          const strength = semanticMatchStrengthLabel(r.score);
          return (
            '<div class="list-item" data-path="' +
            escapeHtml(r.path) +
            '"><span class="row-title">' +
            escapeHtml(r.path) +
            '</span><div class="row-chips">' +
            chips.join('') +
            '</div>' +
            (strength ? '<div class="status muted small">' + escapeHtml(strength) + '</div>' : '') +
            (r.snippet ? '<div class="status">' + escapeHtml(r.snippet.slice(0, 120)) + '…</div>' : '') +
            '</div>'
          );
        })
        .join('');
      const scope = formatSearchScopeSummary();
      notesTotal.textContent =
        results.length +
        ' semantic result' +
        (results.length === 1 ? '' : 's') +
        (scope ? ' · scope: ' + scope : ' · scope: entire vault (use dropdowns to narrow)');
      bindNoteClicks(notesList);
      listSelectedIndex = 0;
      updateListSelection();
    } catch (e) {
      notesList.innerHTML = '<p class="muted">' + escapeHtml(e.message) + '</p>';
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

  function switchNotesView(view) {
    document.querySelectorAll('.view-tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    el('notes-view-list').classList.toggle('hidden', view !== 'list');
    el('notes-view-calendar').classList.toggle('hidden', view !== 'calendar');
    el('notes-view-graph').classList.toggle('hidden', view !== 'graph');
    if (view === 'calendar') renderCalendar();
    if (view === 'graph') renderDashboard();
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
        x: { ticks: { color: '#a1a1a1' }, grid: { color: '#262626' } },
        y: { ticks: { color: '#a1a1a1' }, grid: { color: '#262626' } },
      },
    };

    const ctxP = el('chart-projects').getContext('2d');
    chartInstances.push(
      new Chart(ctxP, {
        type: 'bar',
        data: {
          labels: topProjects.map((x) => x[0]),
          datasets: [{ label: 'Notes', data: topProjects.map((x) => x[1]), backgroundColor: 'rgba(34, 211, 238, 0.5)', borderColor: '#22d3ee' }],
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
          datasets: [{ data: topTags.map((x) => x[1]), backgroundColor: ['#22d3ee', '#22c55e', '#a78bfa', '#f472b6', '#fb923c', '#38bdf8', '#4ade80', '#c084fc'] }],
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
          datasets: [{ label: 'Notes per month', data: weeks.map((w) => byWeek[w]), borderColor: '#22d3ee', backgroundColor: 'rgba(34, 211, 238, 0.1)', fill: true, tension: 0.2 }],
        },
        options: { ...commonOpts, plugins: { ...commonOpts.plugins, title: { display: true, text: 'By month (note date)', color: '#fafafa' } } },
      })
    );
  }

  function openCreateModal() {
    const panel = el('detail-panel');
    if (panel) panel.classList.add('hidden');
    el('modal-create').classList.remove('hidden');
    el('create-msg-quick').textContent = '';
    el('create-msg-quick').className = 'create-msg';
    el('create-msg-full').textContent = '';
    el('create-msg-full').className = 'create-msg';
  }
  function closeCreateModal() {
    el('modal-create').classList.add('hidden');
  }
  btnNewNote.onclick = openCreateModal;
  el('modal-create-backdrop').onclick = closeCreateModal;
  el('modal-create-close').onclick = closeCreateModal;

  function openImportModal() {
    closeCreateModal();
    const panel = el('detail-panel');
    if (panel) panel.classList.add('hidden');
    el('modal-import').classList.remove('hidden');
    el('import-msg').textContent = '';
    el('import-file').value = '';
  }
  function closeImportModal() {
    el('modal-import').classList.add('hidden');
  }
  if (btnImport) btnImport.onclick = openImportModal;
  el('modal-import-backdrop').onclick = closeImportModal;
  el('modal-import-close').onclick = closeImportModal;
  el('btn-import-submit').onclick = async () => {
    const sourceType = el('import-source-type').value;
    const fileInput = el('import-file');
    const msgEl = el('import-msg');
    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      msgEl.textContent = 'Choose a file or ZIP to import.';
      msgEl.className = 'create-msg err';
      return;
    }
    const formData = new FormData();
    formData.append('source_type', sourceType);
    formData.append('file', fileInput.files[0]);
    const project = (el('import-project') && el('import-project').value) ? el('import-project').value.trim() : '';
    const tags = (el('import-tags') && el('import-tags').value) ? el('import-tags').value.trim() : '';
    if (project) formData.append('project', project);
    if (tags) formData.append('tags', tags);
    msgEl.textContent = 'Importing…';
    msgEl.className = 'create-msg';
    try {
      const res = await fetch(apiBase + '/api/v1/import', {
        method: 'POST',
        cache: 'no-store',
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        msgEl.textContent = data.error || res.statusText || 'Import failed';
        msgEl.className = 'create-msg err';
        return;
      }
      msgEl.textContent = 'Imported ' + (data.count ?? data.imported?.length ?? 0) + ' note(s).';
      msgEl.className = 'create-msg ok';
      if (typeof loadNotes === 'function') loadNotes();
      if (typeof loadFacets === 'function') loadFacets();
      if (typeof showToast === 'function') showToast('Import complete');
    } catch (e) {
      msgEl.textContent = e.message || 'Import failed';
      msgEl.className = 'create-msg err';
    }
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

  function openSettings() {
    closeCreateModal();
    el('modal-settings').classList.remove('hidden');
    document.querySelectorAll('.settings-tab').forEach((t) => t.classList.toggle('active', t.dataset.settingsTab === 'backup'));
    document.querySelectorAll('.settings-panel').forEach((p) => {
      p.classList.toggle('active', p.id === 'settings-panel-backup');
    });
    syncAccentUI();
    syncThemeUI();
    el('settings-sync-msg').textContent = '';
    el('settings-sync-msg').className = 'settings-msg';
    el('settings-save-msg').textContent = '';
    el('settings-save-msg').className = 'settings-msg';
    el('settings-mode-display').textContent = 'Loading…';
    el('settings-vault-display').textContent = 'Loading…';
    el('settings-git-status').textContent = 'Loading…';
    const ghStatus = el('settings-github-status');
    if (ghStatus) ghStatus.textContent = 'Loading…';
    fetchSettingsForBackupModal()
      .then((s) => {
        lastBackupSettingsPayload = s;
        if (s.role) window.__hubUserRole = String(s.role);
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
        // Guided Setup checklist: step 1 = vault path set, step 4 = backup configured
        const step1 = document.getElementById('setup-step-1');
        const step4 = document.getElementById('setup-step-4');
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
        const allowedIds = s.allowed_vault_ids || [];
        if (allowedIds.length && !allowedIds.includes(getCurrentVaultId())) {
          setCurrentVaultId(allowedIds[0] || 'default');
        }
        updateVaultSwitcher(s.vault_list || [], allowedIds);
        const connectBtn = el('btn-connect-github');
        const ghStatus = el('settings-github-status');
        if (s.github_connect_available) {
          if (connectBtn) {
            // Pass JWT so the bridge knows who is connecting (link is a full navigation; no Authorization header sent)
            connectBtn.href = apiBase + '/api/v1/auth/github-connect' + (token ? '?token=' + encodeURIComponent(token) : '');
            connectBtn.classList.remove('hidden');
          }
          if (ghStatus) ghStatus.textContent = s.github_connected ? 'Connected (token stored for push)' : 'Not connected';
        } else {
          if (connectBtn) connectBtn.classList.add('hidden');
          if (ghStatus) ghStatus.textContent = '—';
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
      })
      .catch(() => {
        const roleEl = el('settings-role-display');
        if (roleEl) roleEl.textContent = '—';
        const userIdEl = el('settings-user-id');
        if (userIdEl) userIdEl.textContent = '—';
        if (el('settings-mode-display')) el('settings-mode-display').textContent = '—';
        el('settings-vault-display').textContent = '—';
        el('settings-git-status').textContent = 'Could not load';
        const configureSection = el('settings-configure-backup-section');
        const configureHr = el('settings-hr-configure');
        if (configureSection) configureSection.style.display = '';
        if (configureHr) configureHr.style.display = '';
        const ghStatus = el('settings-github-status');
        if (ghStatus) ghStatus.textContent = '—';
        if (el('btn-settings-sync')) el('btn-settings-sync').disabled = true;
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
  if (btnSettings) btnSettings.onclick = openSettings;
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
        if (msg) { msg.textContent = 'Copied.'; msg.className = 'settings-msg'; }
        setTimeout(() => { if (msg) msg.textContent = ''; }, 2000);
      }).catch(() => {
        if (msg) { msg.textContent = 'Copy failed'; msg.className = 'settings-msg err'; }
      });
    } else {
      if (msg) { msg.textContent = 'Clipboard not available'; msg.className = 'settings-msg err'; }
    }
  };

  document.querySelectorAll('.settings-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const id = tab.dataset.settingsTab;
      document.querySelectorAll('.settings-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.settingsTab === id);
        t.setAttribute('aria-selected', t.dataset.settingsTab === id ? 'true' : 'false');
      });
      document.querySelectorAll('.settings-panel').forEach((p) => {
        p.classList.toggle('active', (id === 'backup' && p.id === 'settings-panel-backup') || (id === 'team' && p.id === 'settings-panel-team') || (id === 'vaults' && p.id === 'settings-panel-vaults') || (id === 'integrations' && p.id === 'settings-panel-integrations') || (id === 'appearance' && p.id === 'settings-panel-appearance') || (id === 'agents' && p.id === 'settings-panel-agents'));
      });
      if (id === 'team') {
        loadTeamRolesList();
        loadInvitesList();
      }
      if (id === 'vaults') loadVaultsPanel();
    });
  });

  async function loadVaultsPanel() {
    const listContainer = el('vaults-list-container');
    const serverView = el('vaults-server-view');
    const vaultsJson = el('vaults-json');
    const accessText = el('vault-access-json');
    const scopeText = el('scope-json');
      const helpHosted = el('vaults-help-hosted');
      const helpSelf = el('vaults-help-self-hosted');
      const selfHostedEditors = el('vaults-self-hosted-editors');
      const hostedCreate = el('vaults-hosted-create');
      if (listContainer) listContainer.textContent = 'Loading…';
      if (serverView) serverView.textContent = 'Loading…';
      try {
        const settingsRes = await api('/api/v1/settings');
        const isHosted = String(settingsRes.vault_path_display || '').toLowerCase() === 'canister';
        if (helpHosted) helpHosted.classList.toggle('hidden', !isHosted);
        if (helpSelf) helpSelf.classList.toggle('hidden', isHosted);
        if (selfHostedEditors) selfHostedEditors.classList.toggle('hidden', isHosted);
        if (hostedCreate) hostedCreate.classList.toggle('hidden', !isHosted);
        const hostedCreateMsg = el('vaults-hosted-create-msg');
        if (hostedCreateMsg && isHosted) {
          hostedCreateMsg.textContent = '';
          hostedCreateMsg.className = 'settings-msg';
        }

      let vRes;
      let aRes = { access: {} };
      let sRes = { scope: {} };
      if (isHosted) {
        vRes = await api('/api/v1/vaults');
      } else {
        const out = await Promise.all([
          api('/api/v1/vaults'),
          api('/api/v1/vault-access'),
          api('/api/v1/scope'),
        ]);
        vRes = out[0];
        aRes = out[1];
        sRes = out[2];
      }
      const vaults = vRes.vaults || [];
      if (serverView) {
        const uid = settingsRes.user_id != null ? String(settingsRes.user_id) : '—';
        const allowed = settingsRes.allowed_vault_ids;
        const allowedStr = Array.isArray(allowed) && allowed.length ? allowed.join(', ') : '—';
        if (isHosted) {
          serverView.innerHTML =
            '<strong>Server view (hosted):</strong> Your user ID: <code>' +
            escapeHtml(uid) +
            '</code>. Vault IDs reported for your account: <code>' +
            escapeHtml(allowedStr) +
            '</code>. Storage is the canister (not a local folder). The header <strong>Vault</strong> menu lists these ids when there are two or more.';
        } else {
          const dataDir =
            settingsRes.data_dir_display != null ? escapeHtml(String(settingsRes.data_dir_display)) : 'data';
          serverView.innerHTML =
            '<strong>Server view:</strong> Your user ID: <code>' +
            escapeHtml(uid) +
            '</code>. Allowed vaults: <code>' +
            escapeHtml(allowedStr) +
            '</code>. Data dir: <code>' +
            dataDir +
            '</code>. The header Vault menu only shows vaults you’re allowed here. The Scope form lists every vault on this Hub so admins can configure rules. If a vault is missing from the header, add a Vault access key that <em>exactly</em> matches your user ID (same as Backup tab) with <code>["default", "bornfree"]</code>, save, then refresh.';
        }
      }
      if (listContainer) {
        if (isHosted) {
          listContainer.innerHTML =
            vaults.length === 0
              ? '<p class="muted small">No extra vaults yet — only <code>default</code> until you add a note under another vault id (see note above).</p>'
              : '<pre class="settings-vaults-pre">' + escapeHtml(JSON.stringify(vaults, null, 2)) + '</pre>';
        } else {
          listContainer.innerHTML =
            vaults.length === 0
              ? '<p class="muted small">No vaults (using default from vault path). Add via JSON below and Save.</p>'
              : '<pre class="settings-vaults-pre">' + escapeHtml(JSON.stringify(vaults, null, 2)) + '</pre>';
        }
      }
      if (vaultsJson) vaultsJson.value = JSON.stringify(vaults, null, 2);
      if (accessText) accessText.value = JSON.stringify(aRes.access || {}, null, 2);
      if (scopeText) scopeText.value = JSON.stringify(sRes.scope || {}, null, 2);
      const scopeVaultSelect = el('scope-form-vault-id');
      if (scopeVaultSelect) {
        scopeVaultSelect.innerHTML =
          vaults.length === 0
            ? '<option value="default">default</option>'
            : vaults.map((v) => '<option value="' + escapeHtml(v.id) + '">' + escapeHtml(v.label || v.id) + '</option>').join('');
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
      const parsed = sanitizeNewHostedVaultId(inp && inp.value);
      if (parsed.error) {
        setCreateVaultMsg(parsed.error, true);
        return;
      }
      const { id } = parsed;
      btnHostedVaultCreate.disabled = true;
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
      } finally {
        btnHostedVaultCreate.disabled = false;
      }
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
    const raw = (el('vaults-json') && el('vaults-json').value) || '[]';
    try {
      const vaults = JSON.parse(raw);
      if (!Array.isArray(vaults)) throw new Error('Must be a JSON array');
      await api('/api/v1/vaults', { method: 'POST', body: JSON.stringify({ vaults }) });
      if (msg) { msg.textContent = 'Saved.'; msg.className = 'settings-msg ok'; }
      loadVaultsPanel();
    } catch (e) {
      if (msg) { msg.textContent = e.message || 'Save failed'; msg.className = 'settings-msg err'; }
    }
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
    if (isHostedHubFromSettings()) {
      if (msg) {
        msg.textContent = 'Vault access JSON is for self-hosted Hub only (file-backed).';
        msg.className = 'settings-msg err';
      }
      return;
    }
    const raw = (el('vault-access-json') && el('vault-access-json').value) || '{}';
    try {
      const access = JSON.parse(raw);
      const err = validateVaultAccess(access);
      if (err) throw new Error(err);
      await api('/api/v1/vault-access', { method: 'POST', body: JSON.stringify({ access }) });
      if (msg) { msg.textContent = 'Saved.'; msg.className = 'settings-msg ok'; }
    } catch (e) {
      if (msg) { msg.textContent = e.message || 'Save failed'; msg.className = 'settings-msg err'; }
    }
  };
  const btnScopeSave = el('btn-scope-save');
  if (btnScopeSave) btnScopeSave.onclick = async () => {
    const msg = el('scope-save-msg');
    if (isHostedHubFromSettings()) {
      if (msg) {
        msg.textContent = 'Per-user scope is not available on hosted yet.';
        msg.className = 'settings-msg err';
      }
      return;
    }
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
  };

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
      try {
        const out = await api('/api/v1/invites', { method: 'POST', body: JSON.stringify({ role }) });
        if (inviteLinkUrl) inviteLinkUrl.value = out.invite_url || '';
        if (inviteLinkBlock) inviteLinkBlock.classList.remove('hidden');
        if (inviteCreateMsg) { inviteCreateMsg.textContent = 'Link created. Copy and share.'; inviteCreateMsg.className = 'settings-msg ok'; }
        loadInvitesList();
      } catch (e) {
        if (inviteCreateMsg) { inviteCreateMsg.textContent = e.message || 'Failed'; inviteCreateMsg.className = 'settings-msg err'; }
      }
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

  async function loadTeamRolesList() {
    const listEl = el('team-roles-list');
    if (!listEl) return;
    listEl.textContent = 'Loading…';
    try {
      const out = await api('/api/v1/roles');
      const roles = out.roles || {};
      const entries = Object.entries(roles);
      if (entries.length === 0) {
        listEl.innerHTML = 'No roles assigned yet. When you add one above, it appears here.';
      } else {
        listEl.innerHTML = entries.map(([uid, role]) => '<div class="team-role-row">' + escapeHtml(uid) + ' → ' + escapeHtml(role) + '</div>').join('');
      }
    } catch (e) {
      listEl.textContent = 'Could not load: ' + (e.message || '');
    }
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
      try {
        await api('/api/v1/roles', { method: 'POST', body: JSON.stringify({ user_id: userId, role }) });
        if (msgEl) { msgEl.textContent = 'Saved. They have role: ' + role + '.'; msgEl.className = 'settings-msg'; }
        userIdInput.value = '';
        loadTeamRolesList();
      } catch (e) {
        if (msgEl) { msgEl.textContent = e.message || 'Failed'; msgEl.className = 'settings-msg err'; }
      }
    };
  }

  const currentAccent = () => document.documentElement.style.getPropertyValue('--accent').trim() || DEFAULT_ACCENT;
  document.querySelectorAll('.accent-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hex = btn.dataset.accent;
      if (hex) {
        applyAccent(hex);
        document.querySelectorAll('.accent-swatch').forEach((b) => b.classList.toggle('active', b.dataset.accent === hex));
        const custom = el('accent-custom');
        if (custom) custom.value = hex;
      }
    });
  });
  const customAccentEl = el('accent-custom');
  if (customAccentEl) {
    customAccentEl.addEventListener('input', () => {
      const hex = customAccentEl.value;
      if (hex) {
        applyAccent(hex);
        document.querySelectorAll('.accent-swatch').forEach((b) => b.classList.remove('active'));
      }
    });
  }
  function syncAccentUI() {
    const hex = currentAccent();
    document.querySelectorAll('.accent-swatch').forEach((b) => b.classList.toggle('active', b.dataset.accent === hex));
    if (customAccentEl) customAccentEl.value = hex;
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
  document.querySelectorAll('.theme-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      if (theme) {
        applyTheme(theme);
        syncThemeUI();
      }
    });
  });

  el('btn-settings-sync').onclick = async () => {
    const msg = el('settings-sync-msg');
    msg.textContent = 'Syncing…';
    msg.className = 'settings-msg';
    try {
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
      const result = await api('/api/v1/vault/sync', opts);
      msg.textContent = result.message || 'Done.';
      const initBtnOk = el('btn-vault-git-init');
      if (initBtnOk) initBtnOk.classList.add('hidden');
      if (hostedPath && s) {
        const refreshed = await api('/api/v1/settings');
        lastBackupSettingsPayload = refreshed;
        const vg = refreshed.vault_git || {};
        const vd = refreshed.vault_path_display || '';
        const ih = (vd + '').toLowerCase() === 'canister';
        const syncBtn = el('btn-settings-sync');
        if (syncBtn) syncBtn.disabled = settingsSyncDisabled(refreshed, vg, ih);
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
    }
  };
  const btnVaultGitInit = el('btn-vault-git-init');
  if (btnVaultGitInit) {
    btnVaultGitInit.onclick = async () => {
      const msg = el('settings-sync-msg');
      msg.textContent = 'Initializing Git…';
      msg.className = 'settings-msg';
      try {
        const out = await api('/api/v1/vault/git-init', { method: 'POST' });
        msg.textContent = out.message || 'Git initialized. Try Back up now.';
        msg.className = 'settings-msg ok';
        btnVaultGitInit.classList.add('hidden');
      } catch (e) {
        msg.textContent = e.message || 'Git init failed';
        msg.className = 'settings-msg err';
      }
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
    };
  }

  function defaultFullPath() {
    return 'inbox/note-' + Date.now() + '.md';
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
        if (el('full-path') && !el('full-path').value.trim()) el('full-path').value = defaultFullPath();
      }
    };
  });

  el('btn-quick-save').onclick = async () => {
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
  };

  el('btn-full-save').onclick = async () => {
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
    try {
      await api('/api/v1/notes', { method: 'POST', body: stringifyNotePostPayload(notePath, body, fm) });
      msg.textContent = 'Created: ' + notePath;
      msg.className = 'create-msg ok';
      el('full-path').value = defaultFullPath();
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
  };

  function formatDetailReadBody(body, fm) {
    const o = fm && typeof fm === 'object' && !Array.isArray(fm) ? fm : {};
    const keys = Object.keys(o);
    let text = (body || '') + '\n\n---\n' + JSON.stringify(keys.length ? o : {}, null, 2);
    if (keys.length === 0 && hubUserCanWriteNotes()) {
      text +=
        '\n\n—\nNo metadata is stored for this file on the server yet (common for older hosted notes). Hosted Hub uses the same read view as self-hosted: after you Edit → Save once, the JSON block here fills with keys like title, tags, date, and provenance—same idea as on localhost. Overview and Quick tags then pick that up. To fix many notes at once from a computer, use scripts/resave-hosted-empty-frontmatter.mjs (see scripts/archive/hosted-operational-resave.txt).';
    }
    return text;
  }

  function switchNoteToReadMode() {
    if (!currentOpenNote) return;
    const bodyEl = el('detail-body');
    const actionsEl = el('detail-actions');
    bodyEl.innerHTML = '';
    bodyEl.textContent = formatDetailReadBody(currentOpenNote.body, currentOpenNote.frontmatter);
    bodyEl.className = '';
    const canEdit = hubUserCanWriteNotes();
    actionsEl.innerHTML = '';
    if (canEdit) {
      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.onclick = () => switchNoteToEditMode();
      const exportBtn = document.createElement('button');
      exportBtn.textContent = 'Export';
      exportBtn.onclick = () => exportCurrentNote('md');
      actionsEl.append(editBtn, exportBtn);
    }
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
    actionsEl.innerHTML = '';
    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'btn-primary';
    saveBtn.onclick = async () => {
      closeCreateModal();
      const body = (el('detail-edit-body') && el('detail-edit-body').value) || '';
      const frontmatter = mergedFrontmatterForDetailSave();
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
    };
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => switchNoteToReadMode();
    actionsEl.append(saveBtn, cancelBtn);
  }

  function openNote(path) {
    closeCreateModal();
    currentNotePathForCopy = path;
    currentOpenNote = null;
    const panel = el('detail-panel');
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
        bodyEl.textContent = formatDetailReadBody(note.body, fm);
        const canEdit = hubUserCanWriteNotes();
        if (canEdit) {
          const editBtn = document.createElement('button');
          editBtn.textContent = 'Edit';
          editBtn.onclick = () => switchNoteToEditMode();
          const exportBtn = document.createElement('button');
          exportBtn.textContent = 'Export';
          exportBtn.onclick = () => exportCurrentNote('md');
          actionsEl.append(editBtn, exportBtn);
        }
      })
      .catch((e) => {
        bodyEl.textContent = 'Error: ' + e.message;
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

  function openProposal(id) {
    currentNotePathForCopy = '';
    currentOpenNote = null;
    el('btn-copy-path').classList.add('hidden');
    const panel = el('detail-panel');
    const title = el('detail-title');
    const body = el('detail-body');
    const actions = el('detail-actions');
    panel.classList.remove('hidden');
    api('/api/v1/proposals/' + encodeURIComponent(id))
      .then((p) => {
        title.textContent = p.path + ' (' + p.status + ')';
        body.textContent =
          (p.body || '') + '\n\n---\nIntent: ' + (p.intent || '—') + '\nBase state: ' + (p.base_state_id || '—');
        actions.innerHTML = '';
        const isAdmin = window.__hubUserRole === 'admin';
        if (p.status === 'proposed' && isAdmin) {
          const approveBtn = document.createElement('button');
          approveBtn.textContent = 'Approve';
          approveBtn.onclick = () => approveProposal(id, panel);
          const discardBtn = document.createElement('button');
          discardBtn.textContent = 'Discard';
          discardBtn.onclick = () => discardProposal(id, panel);
          actions.append(approveBtn, discardBtn);
        } else if (p.status === 'proposed' && !isAdmin) {
          const hint = document.createElement('p');
          hint.className = 'muted small';
          hint.textContent = 'Only admins can approve or discard proposals.';
          actions.append(hint);
        }
      })
      .catch((e) => {
        body.textContent = 'Error: ' + e.message;
      });
  }

  async function approveProposal(id, panel) {
    try {
      await api('/api/v1/proposals/' + encodeURIComponent(id) + '/approve', { method: 'POST' });
      panel.classList.add('hidden');
      loadProposals();
      loadNotes();
      loadActivity();
    } catch (e) {
      el('detail-body').textContent += '\n\nApprove failed: ' + e.message;
    }
  }

  async function discardProposal(id, panel) {
    try {
      await api('/api/v1/proposals/' + encodeURIComponent(id) + '/discard', { method: 'POST' });
      panel.classList.add('hidden');
      loadProposals();
      loadActivity();
    } catch (e) {
      el('detail-body').textContent += '\n\nDiscard failed: ' + e.message;
    }
  }

  el('detail-close').onclick = () => {
    currentOpenNote = null;
    el('detail-panel').classList.add('hidden');
  };

  document.addEventListener('keydown', (e) => {
    const inInput = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (e.key === 'Escape') {
      if (el('detail-panel') && !el('detail-panel').classList.contains('hidden')) {
        currentOpenNote = null;
        el('detail-panel').classList.add('hidden');
        e.preventDefault();
      } else if (el('modal-create') && !el('modal-create').classList.contains('hidden')) {
        closeCreateModal();
        e.preventDefault();
      } else if (el('modal-how-to-use') && !el('modal-how-to-use').classList.contains('hidden')) {
        closeHowToUse();
        e.preventDefault();
      } else if (el('modal-settings') && !el('modal-settings').classList.contains('hidden')) {
        closeSettings();
        e.preventDefault();
      } else if (el('modal-import') && !el('modal-import').classList.contains('hidden')) {
        closeImportModal();
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

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      const panel = el('tab-' + (name === 'notes' ? 'notes' : name === 'activity' ? 'activity' : name === 'suggested' ? 'suggested' : 'problem'));
      if (panel) panel.classList.remove('hidden');
      if (name === 'activity') loadActivity();
    };
  });

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }
})();
