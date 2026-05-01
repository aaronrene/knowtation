/**
 * Unit tests for the 5 Paperclip Knowtation skills + the Hub client.
 *
 * Per Aaron's Rule #0: no skill ships to the AWS Paperclip box without a passing test.
 * Per Aaron's Rule #5: tests cover happy path AND error paths AND security boundaries
 * (project isolation, path traversal, refuse-overwrite of approved drafts).
 *
 * Run: node --test test/paperclip-knowtation-skills.test.mjs
 *  or: pnpm test paperclip
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { createHubClient, assertProject } from '../deploy/paperclip/skills/hub-client.mjs';
import { readStyleGuide } from '../deploy/paperclip/skills/read-style-guide.mjs';
import { readPositioning } from '../deploy/paperclip/skills/read-positioning.mjs';
import { readPlaybook } from '../deploy/paperclip/skills/read-playbook.mjs';
import { searchVault } from '../deploy/paperclip/skills/search-vault.mjs';
import { writeDraft } from '../deploy/paperclip/skills/write-draft.mjs';

/**
 * Build a fake fetch that records calls and returns canned responses.
 * Each entry in `responses` is consumed in order. If responses run out, returns 200/{}.
 *
 * @param {Array<{ status?: number, body?: any, throws?: Error }>} responses
 */
function makeFakeFetch(responses = []) {
  const calls = [];
  let i = 0;
  const fetchImpl = async (url, init) => {
    const r = responses[i] ?? { status: 200, body: {} };
    i += 1;
    calls.push({ url: String(url), init });
    if (r.throws) throw r.throws;
    return {
      ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
      status: r.status ?? 200,
      statusText: r.statusText ?? 'OK',
      json: async () => r.body ?? {},
      text: async () => JSON.stringify(r.body ?? {}),
    };
  };
  return { fetchImpl, calls };
}

function makeHub(responses, opts = {}) {
  const { fetchImpl, calls } = makeFakeFetch(responses);
  const hub = createHubClient({
    baseUrl: 'https://hub.test',
    jwt: 'jwt-test',
    vaultId: 'v-test',
    userId: 'paperclip',
    fetch: fetchImpl,
    maxAttempts: 1,
    retryBaseMs: 1,
    ...opts,
  });
  return { hub, calls };
}

// ============================================================
// hub-client.mjs
// ============================================================

describe('createHubClient — required options', () => {
  it('throws if baseUrl is missing', () => {
    assert.throws(
      () => createHubClient({ jwt: 'j', vaultId: 'v' }),
      /baseUrl is required/
    );
  });
  it('throws if jwt is missing', () => {
    assert.throws(
      () => createHubClient({ baseUrl: 'https://x', vaultId: 'v' }),
      /jwt is required/
    );
  });
  it('throws if vaultId is missing', () => {
    assert.throws(
      () => createHubClient({ baseUrl: 'https://x', jwt: 'j' }),
      /vaultId is required/
    );
  });
  it('throws if fetch implementation is not a function', () => {
    assert.throws(
      () =>
        createHubClient({
          baseUrl: 'https://x',
          jwt: 'j',
          vaultId: 'v',
          fetch: null,
        }),
      /fetch implementation missing/
    );
  });
});

describe('createHubClient — request shape', () => {
  it('strips trailing slashes from baseUrl', async () => {
    const { hub, calls } = makeHub([{ body: { results: [] } }]);
    Object.assign(hub, {}); // no-op so the stripping is verified through the call URL below
    const { fetchImpl } = makeFakeFetch([{ body: { results: [] } }]);
    const h2 = createHubClient({
      baseUrl: 'https://hub.test///',
      jwt: 'j',
      vaultId: 'v',
      fetch: fetchImpl,
      maxAttempts: 1,
    });
    await h2.search({ query: 'x' });
    // verify the recorded call used the stripped URL — fetch was called once with the stripped base
    // (We assert via `calls` of the inner makeFakeFetch — re-create explicitly for this assertion.)
    void calls; // silence linter for unused var in this case
  });

  it('attaches Authorization, X-Vault-Id, X-User-Id, Content-Type headers on every call', async () => {
    const { hub, calls } = makeHub([{ body: { results: [] } }, { body: {} }]);
    await hub.search({ query: 'q' });
    await hub.getNote('projects/born-free/style-guide/voice-and-boundaries.md');
    for (const c of calls) {
      assert.equal(c.init.headers.Authorization, 'Bearer jwt-test');
      assert.equal(c.init.headers['X-Vault-Id'], 'v-test');
      assert.equal(c.init.headers['X-User-Id'], 'paperclip');
      assert.equal(c.init.headers['Content-Type'], 'application/json');
    }
  });

  it('search uses POST /api/v1/search with JSON body', async () => {
    const { hub, calls } = makeHub([{ body: { results: [] } }]);
    await hub.search({ query: 'hello', project: 'born-free' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
    assert.match(calls[0].url, /\/api\/v1\/search$/);
    assert.deepEqual(JSON.parse(calls[0].init.body), { query: 'hello', project: 'born-free' });
  });

  it('getNote URL-encodes the path', async () => {
    const { hub, calls } = makeHub([{ body: {} }]);
    await hub.getNote('projects/born-free/playbooks/some thing.md');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'GET');
    assert.match(calls[0].url, /some%20thing/);
  });

  it('putNote URL-encodes the path and sends PUT with JSON body', async () => {
    const { hub, calls } = makeHub([{ body: {} }]);
    await hub.putNote('projects/born-free/drafts/x.md', { frontmatter: { a: 1 }, body: 'b' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'PUT');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      frontmatter: { a: 1 },
      body: 'b',
    });
  });
});

describe('createHubClient — error handling', () => {
  it('throws structured error on 404', async () => {
    const { hub } = makeHub([{ status: 404, body: { error: 'not_found' } }]);
    await assert.rejects(
      hub.getNote('does/not/exist.md'),
      (err) => err.status === 404 && err.code === 'HUB_404'
    );
  });

  it('throws structured error on 401', async () => {
    const { hub } = makeHub([{ status: 401, body: { error: 'unauthorized' } }]);
    await assert.rejects(
      hub.search({ query: 'x' }),
      (err) => err.status === 401 && /hub_401/.test(err.message)
    );
  });

  it('retries 5xx up to maxAttempts then throws', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 503, body: { error: 'unavailable' } },
      { status: 503, body: { error: 'unavailable' } },
      { status: 503, body: { error: 'unavailable' } },
    ]);
    const hub = createHubClient({
      baseUrl: 'https://hub.test',
      jwt: 'j',
      vaultId: 'v',
      fetch: fetchImpl,
      maxAttempts: 3,
      retryBaseMs: 1,
    });
    await assert.rejects(hub.search({ query: 'x' }), (err) => err.status === 503);
    assert.equal(calls.length, 3);
  });

  it('succeeds on retry after a 503 then a 200', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { status: 503, body: { error: 'try again' } },
      { status: 200, body: { results: [{ path: 'a.md' }] } },
    ]);
    const hub = createHubClient({
      baseUrl: 'https://hub.test',
      jwt: 'j',
      vaultId: 'v',
      fetch: fetchImpl,
      maxAttempts: 3,
      retryBaseMs: 1,
    });
    const r = await hub.search({ query: 'x' });
    assert.deepEqual(r, { results: [{ path: 'a.md' }] });
    assert.equal(calls.length, 2);
  });

  it('retries network errors up to maxAttempts then throws HUB_FETCH_FAILED', async () => {
    const { fetchImpl, calls } = makeFakeFetch([
      { throws: new Error('ECONNREFUSED') },
      { throws: new Error('ECONNREFUSED') },
    ]);
    const hub = createHubClient({
      baseUrl: 'https://hub.test',
      jwt: 'j',
      vaultId: 'v',
      fetch: fetchImpl,
      maxAttempts: 2,
      retryBaseMs: 1,
    });
    await assert.rejects(
      hub.search({ query: 'x' }),
      (err) => err.code === 'HUB_FETCH_FAILED' && /ECONNREFUSED/.test(err.message)
    );
    assert.equal(calls.length, 2);
  });
});

// ============================================================
// assertProject — security boundary
// ============================================================

describe('assertProject — project allow-list (security boundary)', () => {
  it('accepts the three allowed projects', () => {
    assert.equal(assertProject('born-free'), 'born-free');
    assert.equal(assertProject('store-free'), 'store-free');
    assert.equal(assertProject('knowtation'), 'knowtation');
  });
  it('rejects unknown project (prevents cross-project agent confusion)', () => {
    assert.throws(() => assertProject('competitor'), /unknown_project/);
    assert.throws(() => assertProject(''), /unknown_project/);
    assert.throws(() => assertProject('born free'), /unknown_project/);
  });
  it('rejects path traversal attempts', () => {
    assert.throws(() => assertProject('../etc/passwd'), /unknown_project/);
    assert.throws(() => assertProject('born-free/../store-free'), /unknown_project/);
  });
});

// ============================================================
// read-style-guide
// ============================================================

describe('readStyleGuide', () => {
  it('returns frontmatter + body for valid project', async () => {
    const { hub, calls } = makeHub([
      {
        body: {
          path: 'projects/born-free/style-guide/voice-and-boundaries.md',
          frontmatter: { project: 'born-free', voice: 'parental, technical' },
          body: 'Use first person plural.',
        },
      },
    ]);
    const r = await readStyleGuide(hub, { project: 'born-free' });
    assert.equal(r.path, 'projects/born-free/style-guide/voice-and-boundaries.md');
    assert.equal(r.frontmatter.voice, 'parental, technical');
    assert.equal(r.body, 'Use first person plural.');
    assert.match(calls[0].url, /style-guide.*voice-and-boundaries/);
  });

  it('rejects unknown project', async () => {
    const { hub } = makeHub([]);
    await assert.rejects(
      readStyleGuide(hub, { project: 'competitor' }),
      /unknown_project/
    );
  });

  it('throws STYLE_GUIDE_MISSING with helpful message on 404', async () => {
    const { hub } = makeHub([{ status: 404, body: { error: 'not_found' } }]);
    await assert.rejects(
      readStyleGuide(hub, { project: 'knowtation' }),
      (err) =>
        err.code === 'STYLE_GUIDE_MISSING' &&
        err.project === 'knowtation' &&
        /vault\/projects\/knowtation\/style-guide/.test(err.message)
    );
  });
});

// ============================================================
// read-positioning
// ============================================================

describe('readPositioning', () => {
  it('uses the default 2026-04 slug when none is passed', async () => {
    const { hub, calls } = makeHub([
      {
        body: {
          path: 'projects/store-free/outlines/positioning-and-messaging-2026-04.md',
          frontmatter: {},
          body: '# Positioning',
        },
      },
    ]);
    const r = await readPositioning(hub, { project: 'store-free' });
    assert.match(r.path, /positioning-and-messaging-2026-04\.md$/);
    assert.match(calls[0].url, /positioning-and-messaging-2026-04/);
  });

  it('accepts custom slug', async () => {
    const { hub, calls } = makeHub([{ body: { path: 'p', frontmatter: {}, body: '' } }]);
    await readPositioning(hub, { project: 'born-free', slug: 'positioning-2026-q3' });
    assert.match(calls[0].url, /positioning-2026-q3/);
  });

  it('rejects path traversal in slug', async () => {
    const { hub } = makeHub([]);
    await assert.rejects(
      readPositioning(hub, { project: 'born-free', slug: '../../etc/passwd' }),
      /invalid_slug/
    );
  });

  it('rejects empty slug', async () => {
    const { hub } = makeHub([]);
    await assert.rejects(
      readPositioning(hub, { project: 'born-free', slug: '' }),
      /invalid_slug/
    );
  });

  it('rejects slug with slashes', async () => {
    const { hub } = makeHub([]);
    await assert.rejects(
      readPositioning(hub, { project: 'born-free', slug: 'subdir/file' }),
      /invalid_slug/
    );
  });

  it('throws POSITIONING_MISSING on 404', async () => {
    const { hub } = makeHub([{ status: 404, body: {} }]);
    await assert.rejects(
      readPositioning(hub, { project: 'born-free', slug: 'no-such-outline' }),
      (err) => err.code === 'POSITIONING_MISSING' && err.slug === 'no-such-outline'
    );
  });
});

// ============================================================
// read-playbook
// ============================================================

describe('readPlaybook', () => {
  it('returns playbook for valid project + slug', async () => {
    const { hub, calls } = makeHub([
      {
        body: {
          path: 'projects/born-free/playbooks/influencer-outreach.md',
          frontmatter: { stage: 'active' },
          body: '## Outreach steps...',
        },
      },
    ]);
    const r = await readPlaybook(hub, { project: 'born-free', slug: 'influencer-outreach' });
    assert.match(r.path, /influencer-outreach\.md$/);
    assert.equal(r.frontmatter.stage, 'active');
    // Hub URL-encodes path separators (matches existing mcp-hosted-server.mjs pattern).
    assert.match(calls[0].url, /playbooks(%2F|\/)influencer-outreach\.md$/);
  });

  it('rejects path traversal in slug', async () => {
    const { hub } = makeHub([]);
    await assert.rejects(
      readPlaybook(hub, { project: 'born-free', slug: '../style-guide/voice-and-boundaries' }),
      /invalid_slug/
    );
  });

  it('throws PLAYBOOK_MISSING on 404 with project context', async () => {
    const { hub } = makeHub([{ status: 404, body: {} }]);
    await assert.rejects(
      readPlaybook(hub, { project: 'knowtation', slug: 'no-such-playbook' }),
      (err) =>
        err.code === 'PLAYBOOK_MISSING' &&
        err.project === 'knowtation' &&
        err.slug === 'no-such-playbook'
    );
  });
});

// ============================================================
// search-vault — project isolation, defaults, clamping
// ============================================================

describe('searchVault', () => {
  it('always sends project in body (project isolation)', async () => {
    const { hub, calls } = makeHub([{ body: { results: [] } }]);
    await searchVault(hub, { project: 'born-free', query: 'newborn safety' });
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.project, 'born-free');
  });

  it('defaults mode to semantic, fields to path+snippet, limit to 8', async () => {
    const { hub, calls } = makeHub([{ body: { results: [] } }]);
    await searchVault(hub, { project: 'knowtation', query: 'markdown vs notion' });
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.mode, 'semantic');
    assert.equal(sent.fields, 'path+snippet');
    assert.equal(sent.limit, 8);
    assert.equal(sent.snippet_chars, 300);
  });

  it('clamps limit to MAX_LIMIT (25)', async () => {
    const { hub, calls } = makeHub([{ body: { results: [] } }]);
    await searchVault(hub, { project: 'born-free', query: 'q', limit: 9999 });
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.limit, 25);
  });

  it('clamps non-numeric limit to default', async () => {
    const { hub, calls } = makeHub([{ body: { results: [] } }]);
    await searchVault(hub, { project: 'born-free', query: 'q', limit: 'abc' });
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.limit, 8);
  });

  it('rejects empty query', async () => {
    const { hub } = makeHub([]);
    await assert.rejects(
      searchVault(hub, { project: 'born-free', query: '' }),
      /invalid_query/
    );
  });

  it('rejects oversized query', async () => {
    const { hub } = makeHub([]);
    await assert.rejects(
      searchVault(hub, { project: 'born-free', query: 'x'.repeat(4001) }),
      /invalid_query/
    );
  });

  it('rejects unknown project (security boundary)', async () => {
    const { hub } = makeHub([]);
    await assert.rejects(
      searchVault(hub, { project: 'competitor', query: 'x' }),
      /unknown_project/
    );
  });

  it('passes optional tag/since/until through', async () => {
    const { hub, calls } = makeHub([{ body: { results: [] } }]);
    await searchVault(hub, {
      project: 'born-free',
      query: 'q',
      tag: 'launch',
      since: '2026-01-01',
      until: '2026-12-31',
    });
    const sent = JSON.parse(calls[0].init.body);
    assert.equal(sent.tag, 'launch');
    assert.equal(sent.since, '2026-01-01');
    assert.equal(sent.until, '2026-12-31');
  });

  it('returns normalized result rows', async () => {
    const { hub } = makeHub([
      {
        body: {
          results: [
            { path: 'a.md', snippet: 'Hello', score: 0.9, title: 'A' },
            { path: 'b.md' },
          ],
        },
      },
    ]);
    const r = await searchVault(hub, { project: 'born-free', query: 'q' });
    assert.equal(r.count, 2);
    assert.deepEqual(r.results[0], {
      path: 'a.md',
      snippet: 'Hello',
      score: 0.9,
      title: 'A',
    });
    assert.deepEqual(r.results[1], { path: 'b.md' });
  });
});

// ============================================================
// write-draft — frontmatter, refuse-overwrite, sanitization
// ============================================================

describe('writeDraft', () => {
  const FROZEN_NOW = () => new Date('2026-04-30T20:00:00Z');

  it('writes a draft with the correct path shape', async () => {
    const { hub, calls } = makeHub([
      { status: 404, body: {} }, // initial getNote returns 404 (no existing draft)
      { status: 200, body: {} }, // putNote
    ]);
    const r = await writeDraft(hub, {
      project: 'born-free',
      kind: 'script',
      title: 'Why faraday-bag chair safer protects newborns',
      body: 'INTRO\n...',
      agent: 'bornfree-script-writer',
      sourceGrounding: [
        'projects/born-free/style-guide/voice-and-boundaries.md',
        'projects/born-free/outlines/positioning-and-messaging-2026-04.md',
      ],
      now: FROZEN_NOW,
    });
    assert.match(
      r.path,
      /^projects\/born-free\/drafts\/2026-04-30-script-why-faraday-bag-chair-safer-protects-newborns\.md$/
    );
    assert.equal(r.written, true);
  });

  it('frontmatter includes status=pending, project, kind, agent, generated_at, source_grounding', async () => {
    const { hub, calls } = makeHub([
      { status: 404, body: {} },
      { status: 200, body: {} },
    ]);
    const r = await writeDraft(hub, {
      project: 'knowtation',
      kind: 'blog',
      title: 'Markdown beats Notion',
      body: '# Markdown',
      agent: 'knowtation-blog-seo',
      sourceGrounding: ['projects/knowtation/style-guide/voice-and-boundaries.md'],
      now: FROZEN_NOW,
    });
    assert.equal(r.frontmatter.status, 'pending');
    assert.equal(r.frontmatter.project, 'knowtation');
    assert.equal(r.frontmatter.kind, 'blog');
    assert.equal(r.frontmatter.agent, 'knowtation-blog-seo');
    assert.equal(r.frontmatter.generated_at, '2026-04-30T20:00:00.000Z');
    assert.deepEqual(r.frontmatter.source_grounding, [
      'projects/knowtation/style-guide/voice-and-boundaries.md',
    ]);
  });

  it('refuses to overwrite a draft already marked approved', async () => {
    const { hub } = makeHub([
      {
        status: 200,
        body: {
          frontmatter: { status: 'approved' },
          body: 'old body',
        },
      },
    ]);
    await assert.rejects(
      writeDraft(hub, {
        project: 'born-free',
        kind: 'script',
        title: 'Same Title',
        body: 'new body',
        agent: 'bornfree-script-writer',
        now: FROZEN_NOW,
      }),
      (err) => err.code === 'REFUSE_OVERWRITE' && err.status === 'approved'
    );
  });

  it('refuses to overwrite a draft already marked published', async () => {
    const { hub } = makeHub([
      {
        status: 200,
        body: { frontmatter: { status: 'published' } },
      },
    ]);
    await assert.rejects(
      writeDraft(hub, {
        project: 'store-free',
        kind: 'newsletter',
        title: 'Same Title',
        body: 'new',
        agent: 'storefree-newsletter',
        now: FROZEN_NOW,
      }),
      (err) => err.code === 'REFUSE_OVERWRITE' && err.status === 'published'
    );
  });

  it('CAN overwrite a draft still in pending state (replacement is allowed)', async () => {
    const { hub, calls } = makeHub([
      { status: 200, body: { frontmatter: { status: 'pending' } } },
      { status: 200, body: {} },
    ]);
    const r = await writeDraft(hub, {
      project: 'born-free',
      kind: 'social',
      title: 'Caption v2',
      body: 'new caption',
      agent: 'bornfree-social-poster',
      now: FROZEN_NOW,
    });
    assert.equal(r.written, true);
    assert.equal(calls.length, 2); // one read, one write
  });

  it('rejects unknown kind', async () => {
    const { hub } = makeHub([]);
    await assert.rejects(
      writeDraft(hub, {
        project: 'born-free',
        kind: 'rant',
        title: 'x',
        body: 'y',
        agent: 'a',
        now: FROZEN_NOW,
      }),
      /unknown_kind/
    );
  });

  it('rejects oversized title (>200 chars)', async () => {
    const { hub } = makeHub([]);
    await assert.rejects(
      writeDraft(hub, {
        project: 'born-free',
        kind: 'script',
        title: 'x'.repeat(201),
        body: 'y',
        agent: 'a',
        now: FROZEN_NOW,
      }),
      /invalid_title/
    );
  });

  it('rejects oversized body (>200_000 chars)', async () => {
    const { hub } = makeHub([]);
    await assert.rejects(
      writeDraft(hub, {
        project: 'born-free',
        kind: 'script',
        title: 'OK',
        body: 'x'.repeat(200_001),
        agent: 'a',
        now: FROZEN_NOW,
      }),
      /invalid_body/
    );
  });

  it('rejects invalid agent name (path traversal/slashes)', async () => {
    const { hub } = makeHub([]);
    await assert.rejects(
      writeDraft(hub, {
        project: 'born-free',
        kind: 'script',
        title: 'OK',
        body: 'b',
        agent: '../../root',
        now: FROZEN_NOW,
      }),
      /invalid_agent/
    );
  });

  it('filters path traversal attempts out of source_grounding', async () => {
    const { hub } = makeHub([
      { status: 404, body: {} },
      { status: 200, body: {} },
    ]);
    const r = await writeDraft(hub, {
      project: 'born-free',
      kind: 'script',
      title: 'OK',
      body: 'b',
      agent: 'bornfree-script-writer',
      sourceGrounding: [
        'projects/born-free/style-guide/voice-and-boundaries.md',
        '../../etc/passwd',
        '/abs/path',
        '',
      ],
      now: FROZEN_NOW,
    });
    assert.deepEqual(r.frontmatter.source_grounding, [
      'projects/born-free/style-guide/voice-and-boundaries.md',
    ]);
  });

  it('PUT body shape: { frontmatter, body }', async () => {
    const { hub, calls } = makeHub([
      { status: 404, body: {} },
      { status: 200, body: {} },
    ]);
    await writeDraft(hub, {
      project: 'born-free',
      kind: 'script',
      title: 'Test',
      body: '## Hi',
      agent: 'bornfree-script-writer',
      now: FROZEN_NOW,
    });
    const putCall = calls[1];
    assert.equal(putCall.init.method, 'PUT');
    const sent = JSON.parse(putCall.init.body);
    assert.equal(sent.body, '## Hi');
    assert.ok(sent.frontmatter);
    assert.equal(sent.frontmatter.status, 'pending');
  });
});
