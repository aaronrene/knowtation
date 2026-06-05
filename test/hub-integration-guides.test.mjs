/**
 * Integration guide module — 7-tier tests (unit through security).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  INTEGRATION_GUIDES,
  getIntegrationGuide,
  listIntegrationGuideIds,
  renderIntegrationGuideHtml,
  escapeHtml,
  wireIntegrationTiles,
} from '../web/hub/hub-integration-guides.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hubIndex = readFileSync(join(root, 'web/hub/index.html'), 'utf8');
const hubJs = readFileSync(join(root, 'web/hub/hub.js'), 'utf8');

describe('hub-integration-guides — unit', () => {
  it('lists every expected capture and import tile id', () => {
    const ids = listIntegrationGuideIds();
    for (const id of [
      'slack',
      'discord',
      'telegram',
      'whatsapp',
      'chatgpt-export',
      'claude-export',
      'openclaw',
      'hermes',
      'imports',
    ]) {
      assert.ok(ids.includes(id), `missing guide: ${id}`);
    }
  });

  it('getIntegrationGuide returns null for unknown ids', () => {
    assert.equal(getIntegrationGuide(''), null);
    assert.equal(getIntegrationGuide('not-a-source'), null);
  });

  it('hermes guide includes export and markdown import commands', () => {
    const g = getIntegrationGuide('hermes');
    assert.ok(g);
    const code = g.sections.filter((s) => s.type === 'code').map((s) => s.code).join('\n');
    assert.match(code, /hermes memory export/);
    assert.match(code, /knowtation import markdown/);
    assert.match(code, /MEMORY\.md/);
  });

  it('imports guide merges local and team paths', () => {
    const g = getIntegrationGuide('imports');
    assert.ok(g);
    assert.equal(g.name, 'Imports');
    const text = g.sections.filter((s) => s.type === 'text').map((s) => s.html).join(' ');
    assert.match(text, /Local/i);
    assert.match(text, /Team/i);
  });

  it('escapeHtml neutralizes script injection in code blocks', () => {
    const out = escapeHtml('<script>alert(1)</script>');
    assert.equal(out, '&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renderIntegrationGuideHtml escapes code but preserves author text html', () => {
    const g = getIntegrationGuide('slack');
    assert.ok(g);
    const html = renderIntegrationGuideHtml(g);
    assert.match(html, /integ-guide-code-block/);
    assert.doesNotMatch(html, /<script>/i);
    assert.match(html, /CAPTURE_URL/);
  });
});

describe('hub-integration-guides — integration', () => {
  it('wireIntegrationTiles invokes onOpen with the matching guide', () => {
    const rootEl = {
      querySelectorAll(sel) {
        if (sel !== '[data-integ-id]') return [];
        return [{ getAttribute: () => 'hermes', addEventListener: (_ev, fn) => { rootEl._fn = fn; } }];
      },
      _fn: null,
    };
    let opened = null;
    wireIntegrationTiles(rootEl, {
      onOpen(g) {
        opened = g;
      },
    });
    assert.equal(typeof rootEl._fn, 'function');
    rootEl._fn();
    assert.equal(opened?.id, 'hermes');
  });

  it('hub index tiles use data-integ-id for every integration button', () => {
    assert.match(hubIndex, /data-integ-id="hermes"/);
    assert.match(hubIndex, /data-integ-id="openclaw"/);
    assert.match(hubIndex, /data-integ-id="imports"/);
    assert.doesNotMatch(hubIndex, /Local Imports/);
    assert.doesNotMatch(hubIndex, /Team Imports/);
    const tileButtons = hubIndex.match(/class="integ-source-tile"/g) || [];
    assert.ok(tileButtons.length >= 20, 'expected many clickable integration tiles');
  });

  it('hub.js wires integration guide modal with document delegation', () => {
    assert.match(hubJs, /HubIntegrationGuides/);
    assert.match(hubJs, /openIntegGuideModal/);
    assert.match(hubJs, /modal-integ-guide/);
    assert.match(hubJs, /closeIntegGuideModal/);
    assert.match(hubJs, /bindIntegrationGuideModalControlsOnce/);
    assert.match(hubJs, /#settings-panel-integrations \[data-integ-id\]/);
  });

  it('integration guide modal stacks above settings modal', () => {
    const hubCss = readFileSync(join(root, 'web/hub/hub.css'), 'utf8');
    assert.match(hubCss, /#modal-integ-guide\s*\{\s*z-index:\s*110/);
    const integIdx = hubIndex.indexOf('id="modal-integ-guide"');
    const settingsIdx = hubIndex.indexOf('id="modal-settings"');
    assert.ok(integIdx > settingsIdx, 'integ guide modal should follow settings modal in DOM');
  });
});

describe('hub-integration-guides — end-to-end (static contract)', () => {
  it('each HTML data-integ-id resolves to a guide with matching name', () => {
    const ids = [...hubIndex.matchAll(/data-integ-id="([^"]+)"/g)].map((m) => m[1]);
    const integIds = ids.filter((id, i, arr) => arr.indexOf(id) === i && INTEGRATION_GUIDES[id]);
    assert.ok(integIds.length >= 18);
    for (const id of integIds) {
      const g = getIntegrationGuide(id);
      assert.ok(g, id);
      assert.ok(g.name);
      assert.ok(g.sections.length > 0);
    }
  });

  it('import-capable guides with hub dropdown options expose sourceType', () => {
    const chatgpt = getIntegrationGuide('chatgpt-export');
    assert.equal(chatgpt?.sourceType, 'chatgpt-export');
    assert.equal(chatgpt?.hubImport, true);
  });
});

describe('hub-integration-guides — stress', () => {
  it('renderIntegrationGuideHtml handles repeated calls without growth errors', () => {
    const g = getIntegrationGuide('wallet-csv');
    assert.ok(g);
    let last = '';
    for (let i = 0; i < 200; i++) {
      last = renderIntegrationGuideHtml(g);
    }
    assert.match(last, /wallet-csv/);
  });

  it('listIntegrationGuideIds returns stable count under repeated reads', () => {
    const counts = new Set();
    for (let i = 0; i < 50; i++) counts.add(listIntegrationGuideIds().length);
    assert.equal(counts.size, 1);
    assert.ok([...counts][0] >= 20);
  });
});

describe('hub-integration-guides — data-integrity', () => {
  it('INTEGRATION_GUIDES is frozen and guides are not mutated by getters', () => {
    assert.throws(() => {
      /** @type {Record<string, unknown>} */ (INTEGRATION_GUIDES).new = {};
    });
    const before = getIntegrationGuide('hermes');
    assert.ok(before);
    const copy = { ...before, name: 'mutated' };
    assert.notEqual(getIntegrationGuide('hermes')?.name, copy.name);
  });

  it('render output does not embed raw user-supplied angle brackets from code sections', () => {
    const fake = {
      id: 'x',
      icon: '!',
      name: 'X',
      desc: 'd',
      kind: 'import',
      sections: [{ type: 'code', code: 'foo <bar> baz' }],
    };
    const html = renderIntegrationGuideHtml(fake);
    assert.match(html, /foo &lt;bar&gt; baz/);
    assert.doesNotMatch(html, /foo <bar>/);
  });
});

describe('hub-integration-guides — performance', () => {
  it('renders all guides in under 500ms total', () => {
    const t0 = performance.now();
    for (const id of listIntegrationGuideIds()) {
      renderIntegrationGuideHtml(getIntegrationGuide(id));
    }
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 500, `render all guides took ${elapsed}ms`);
  });
});

describe('hub-integration-guides — security', () => {
  it('code copy buttons store escaped attribute payloads only', () => {
    const fake = {
      id: 'x',
      icon: '!',
      name: 'X',
      desc: 'd',
      kind: 'import',
      sections: [{ type: 'code', code: 'echo "test"' }],
    };
    const html = renderIntegrationGuideHtml(fake);
    assert.match(html, /data-copy="echo &quot;test&quot;"/);
  });

  it('does not document pasting secrets into Hub UI for supabase', () => {
    const g = getIntegrationGuide('supabase-memory');
    assert.ok(g);
    const blob = g.sections.map((s) => (s.type === 'code' ? s.code : s.html)).join('\n');
    assert.match(blob, /never paste secrets/i);
  });

  it('hermes doc link uses https official docs', () => {
    const g = getIntegrationGuide('hermes');
    assert.ok(g?.docUrl?.startsWith('https://'));
  });
});

describe('OpenRouter model-provider guide + chat-provider UI', () => {
  it('unit: openrouter guide exists as a provider-kind tile with an https doc link', () => {
    const g = getIntegrationGuide('openrouter');
    assert.ok(g, 'openrouter guide must exist');
    assert.equal(g.id, 'openrouter');
    assert.equal(g.name, 'OpenRouter');
    assert.equal(g.kind, 'provider');
    assert.ok(g.docUrl?.startsWith('https://'));
    assert.ok(g.sections.length > 0);
  });

  it('unit: guide documents the BYO-key env wiring and no managed fallback', () => {
    const g = getIntegrationGuide('openrouter');
    const code = g.sections.filter((s) => s.type === 'code').map((s) => s.code).join('\n');
    const text = g.sections.filter((s) => s.type === 'text').map((s) => s.html).join(' ');
    assert.match(code, /KNOWTATION_CHAT_PROVIDER=openrouter/);
    assert.match(code, /OPENROUTER_API_KEY=/);
    assert.match(text, /bring-your-own-key|BYO/i);
    assert.match(text, /never (silently )?re-routed|never metered/i);
  });

  it('integration: the integrations panel renders an OpenRouter tile', () => {
    assert.match(hubIndex, /data-integ-id="openrouter"/);
    const tileIdx = hubIndex.indexOf('data-integ-id="openrouter"');
    const panelIdx = hubIndex.indexOf('id="settings-panel-integrations"');
    assert.ok(tileIdx > panelIdx, 'OpenRouter tile must live in the integrations panel');
  });

  it('integration: chat-provider selector exposes every selectable provider plus auto-detect', () => {
    const selStart = hubIndex.indexOf('id="chat-provider-select"');
    assert.notEqual(selStart, -1, 'chat-provider-select must exist');
    const selBlock = hubIndex.slice(selStart, hubIndex.indexOf('</select>', selStart));
    for (const v of ['value=""', 'value="openai"', 'value="anthropic"', 'value="deepinfra"', 'value="openrouter"', 'value="ollama"']) {
      assert.ok(selBlock.includes(v), `chat-provider-select missing option ${v}`);
    }
  });

  it('integration: hub.js loads, gates, and saves the chat provider via the settings API', () => {
    assert.match(hubJs, /function applyChatProviderSettings/);
    assert.match(hubJs, /applyChatProviderSettings\(s\)/);
    assert.match(hubJs, /\/api\/v1\/settings\/chat/);
    assert.match(hubJs, /method: 'POST'/);
  });

  it('security: env lock + admin gating are honoured in the UI load path', () => {
    assert.match(hubJs, /chat\.env_locked/);
    assert.match(hubJs, /KNOWTATION_CHAT_PROVIDER/);
    assert.match(hubJs, /String\(s && s\.role\) === 'admin'/);
    // disabled when env-locked or non-admin
    assert.match(hubJs, /sel\.disabled = envLocked \|\| !isAdmin/);
  });

  it('security: guide keeps the API key in server env, not the Hub UI', () => {
    const g = getIntegrationGuide('openrouter');
    const text = g.sections.filter((s) => s.type === 'text').map((s) => s.html).join(' ');
    assert.match(text, /server env/i);
    // No real-looking key is embedded in the guide content.
    const blob = g.sections.map((s) => (s.type === 'code' ? s.code : s.html)).join('\n');
    assert.doesNotMatch(blob, /sk-or-v1-[A-Za-z0-9]{20,}/);
  });

  it('end-to-end: the OpenRouter tile resolves through the same modal contract', () => {
    const html = renderIntegrationGuideHtml(getIntegrationGuide('openrouter'));
    assert.match(html, /integ-guide-code-block/);
    assert.match(html, /KNOWTATION_CHAT_PROVIDER=openrouter/);
    assert.doesNotMatch(html, /<script>/i);
    assert.match(html, /href="https:\/\/openrouter\.ai/);
  });
});
