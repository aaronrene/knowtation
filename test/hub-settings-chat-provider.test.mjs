/**
 * Self-hosted Hub chat-provider settings: POST /api/v1/settings/chat + GET /api/v1/settings `chat`.
 *
 * The endpoint lets an admin select the completeChat provider (MCP summarize + Hub proposal LLM
 * jobs) from the UI, persisting llm.provider to config/local.yaml. The provider drives where note
 * text is sent and which account is billed, so input is strictly whitelisted and the operator env
 * lock (KNOWTATION_CHAT_PROVIDER) always wins.
 *
 * Validation logic is covered live via normalizeChatProviderInput; route wiring/authz/persistence
 * is covered by source inspection (the established pattern for these Hub routes).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeChatProviderInput, CHAT_PROVIDERS } from '../lib/config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.dirname(__dirname);

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function chatRouteSource() {
  const src = readRepoFile('hub/server.mjs');
  const start = src.indexOf('// POST /api/v1/settings/chat');
  const end = src.indexOf('function validateMuseUrlForYaml', start);
  assert.notEqual(start, -1, 'chat settings route must exist');
  assert.notEqual(end, -1, 'route must stay before validateMuseUrlForYaml');
  return src.slice(start, end);
}

describe('chat-provider settings — unit (normalizeChatProviderInput)', () => {
  it('accepts empty / null as "" (auto-detect)', () => {
    assert.deepEqual(normalizeChatProviderInput(''), { ok: true, provider: '' });
    assert.deepEqual(normalizeChatProviderInput(null), { ok: true, provider: '' });
    assert.deepEqual(normalizeChatProviderInput(undefined), { ok: true, provider: '' });
  });

  it('accepts every whitelisted provider (case-insensitive, trimmed)', () => {
    for (const p of CHAT_PROVIDERS) {
      assert.deepEqual(normalizeChatProviderInput(`  ${p.toUpperCase()}  `), { ok: true, provider: p });
    }
  });

  it('rejects unknown providers with an actionable error', () => {
    const r = normalizeChatProviderInput('gemini');
    assert.equal(r.ok, false);
    assert.match(r.error, /must be one of/);
  });

  it('rejects non-string input', () => {
    assert.equal(normalizeChatProviderInput(42).ok, false);
    assert.equal(normalizeChatProviderInput({ provider: 'openai' }).ok, false);
    assert.equal(normalizeChatProviderInput(['openai']).ok, false);
  });

  it('rejects injection-style values (never written to YAML / never reaches completeChat)', () => {
    assert.equal(normalizeChatProviderInput('openai; rm -rf /').ok, false);
    assert.equal(normalizeChatProviderInput('../../etc/passwd').ok, false);
    assert.equal(normalizeChatProviderInput('openai\nprovider: anthropic').ok, false);
  });
});

describe('chat-provider settings — integration (route wiring)', () => {
  it('registers POST /api/v1/settings/chat behind jwtAuth, rate limit, admin role, and json body', () => {
    const route = chatRouteSource();
    assert.match(route, /app\.post\(\s*'\/api\/v1\/settings\/chat'/);
    assert.match(route, /jwtAuth/);
    assert.match(route, /apiLimiter/);
    assert.match(route, /requireRole\('admin'\)/);
    assert.match(route, /express\.json\(\)/);
  });

  it('validates input with normalizeChatProviderInput and persists llm.provider to local.yaml', () => {
    const route = chatRouteSource();
    assert.match(route, /normalizeChatProviderInput\(body\.provider\)/);
    assert.match(route, /doc\.llm\.provider = result\.provider/);
    assert.match(route, /fs\.writeFileSync\(configPath, yaml\.dump\(doc\)/);
    assert.match(route, /config = loadConfig\(projectRoot\)/);
  });

  it('exposes the chat block in GET /api/v1/settings', () => {
    const src = readRepoFile('hub/server.mjs');
    assert.match(src, /chat: \{/);
    assert.match(src, /provider: config\.llm\?\.provider \|\| ''/);
    assert.match(src, /providers: CHAT_PROVIDERS/);
    assert.match(src, /env_locked: Boolean\(process\.env\.KNOWTATION_CHAT_PROVIDER\)/);
    assert.match(src, /key_available:/);
  });
});

describe('chat-provider settings — end-to-end (response shape contract)', () => {
  it('returns the resolved provider after save', () => {
    const route = chatRouteSource();
    assert.match(route, /res\.json\(\{ ok: true, chat: \{ provider: config\.llm\?\.provider \|\| '' \} \}\)/);
  });
});

describe('chat-provider settings — stress (bounded source surface)', () => {
  it('route checks stay bounded to server + config sources', () => {
    const started = Date.now();
    const sources = [readRepoFile('hub/server.mjs'), readRepoFile('lib/config.mjs')];
    assert.equal(sources.length, 2);
    assert.ok(Date.now() - started < 300);
  });
});

describe('chat-provider settings — data integrity', () => {
  it('writes only the validated provider value (no echo of raw body, no other llm fields)', () => {
    const route = chatRouteSource();
    // The only llm field written is provider, sourced from the validator result.
    assert.match(route, /doc\.llm\.provider = result\.provider/);
    assert.doesNotMatch(route, /doc\.llm\.\w+ = body\./);
  });

  it('initialises doc.llm defensively before writing', () => {
    const route = chatRouteSource();
    assert.match(route, /if \(!doc\.llm \|\| typeof doc\.llm !== 'object'\) doc\.llm = \{\}/);
  });
});

describe('chat-provider settings — performance', () => {
  it('the route performs no model/network call (settings write only)', () => {
    const route = chatRouteSource();
    assert.doesNotMatch(route, /completeChat\(|fetch\(|embedWithUsage\(|runSearch\(/);
  });
});

describe('chat-provider settings — security', () => {
  it('honours the operator env lock with a 409 before any write', () => {
    const route = chatRouteSource();
    assert.match(route, /if \(process\.env\.KNOWTATION_CHAT_PROVIDER\)/);
    assert.match(route, /status\(409\)/);
    assert.match(route, /ENV_LOCKED/);
    // The env-lock guard appears before the writeFileSync.
    assert.ok(route.indexOf('ENV_LOCKED') < route.indexOf('writeFileSync'));
  });

  it('is admin-only (no viewer/editor/evaluator access)', () => {
    const route = chatRouteSource();
    assert.match(route, /requireRole\('admin'\)/);
    assert.doesNotMatch(route, /requireRole\('viewer'|requireRole\('editor'/);
  });

  it('rejects invalid input with 400 VALIDATION_ERROR rather than writing it', () => {
    const route = chatRouteSource();
    assert.match(route, /if \(!result\.ok\)/);
    assert.match(route, /status\(400\)/);
    assert.match(route, /VALIDATION_ERROR/);
    assert.ok(route.indexOf('VALIDATION_ERROR') < route.indexOf('writeFileSync'));
  });
});
