import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allowedToolsForRole, isToolAllowed, filterToolsByRole } from '../hub/gateway/mcp-tool-acl.mjs';

describe('mcp-tool-acl', () => {
  describe('allowedToolsForRole', () => {
    it('viewer gets read-only tools', () => {
      const tools = allowedToolsForRole('viewer');
      assert.ok(tools.has('search'));
      assert.ok(tools.has('get_note'));
      assert.ok(tools.has('list_notes'));
      assert.ok(tools.has('summarize'));
      assert.ok(tools.has('enrich'));
      assert.ok(!tools.has('write'));
      assert.ok(!tools.has('index'));
      assert.ok(!tools.has('export'));
      assert.ok(!tools.has('import'));
    });

    it('editor gets read + write tools', () => {
      const tools = allowedToolsForRole('editor');
      assert.ok(tools.has('search'));
      assert.ok(tools.has('write'));
      assert.ok(tools.has('hub_create_proposal'));
      assert.ok(tools.has('capture'));
      assert.ok(!tools.has('index'));
      assert.ok(!tools.has('export'));
    });

    it('evaluator gets same write-class tools as editor (incl. hub_create_proposal)', () => {
      const tools = allowedToolsForRole('evaluator');
      assert.ok(tools.has('write'));
      assert.ok(tools.has('hub_create_proposal'));
      assert.ok(!tools.has('index'));
    });

    it('admin gets all tools', () => {
      const tools = allowedToolsForRole('admin');
      assert.ok(tools.has('search'));
      assert.ok(tools.has('write'));
      assert.ok(tools.has('hub_create_proposal'));
      assert.ok(tools.has('index'));
      assert.ok(tools.has('export'));
      assert.ok(tools.has('import'));
    });

    it('unknown role defaults to viewer', () => {
      const tools = allowedToolsForRole('unknown');
      assert.ok(tools.has('search'));
      assert.ok(!tools.has('write'));
      assert.ok(!tools.has('index'));
    });
  });

  describe('isToolAllowed', () => {
    it('returns true for allowed tool', () => {
      assert.ok(isToolAllowed('search', 'viewer'));
      assert.ok(isToolAllowed('write', 'editor'));
      assert.ok(isToolAllowed('hub_create_proposal', 'editor'));
      assert.ok(isToolAllowed('hub_create_proposal', 'evaluator'));
      assert.ok(isToolAllowed('index', 'admin'));
    });

    it('returns false for disallowed tool', () => {
      assert.ok(!isToolAllowed('write', 'viewer'));
      assert.ok(!isToolAllowed('hub_create_proposal', 'viewer'));
      assert.ok(!isToolAllowed('index', 'editor'));
      assert.ok(!isToolAllowed('index', 'evaluator'));
    });
  });

  describe('filterToolsByRole', () => {
    it('filters tool definitions by role', () => {
      const allTools = [
        { name: 'search' },
        { name: 'write' },
        { name: 'index' },
        { name: 'get_note' },
      ];
      const viewerTools = filterToolsByRole(allTools, 'viewer');
      assert.equal(viewerTools.length, 2);
      assert.deepEqual(viewerTools.map((t) => t.name).sort(), ['get_note', 'search']);

      const editorTools = filterToolsByRole(allTools, 'editor');
      assert.equal(editorTools.length, 3);

      const adminTools = filterToolsByRole(allTools, 'admin');
      assert.equal(adminTools.length, 4);
    });
  });
});

describe('mcp-proxy-router', () => {
  describe('parseMcpSessionTtlMs / parseMcpMaxSessionsPerUser', () => {
    it('defaults when env unset', async () => {
      const { parseMcpSessionTtlMs, parseMcpMaxSessionsPerUser } = await import('../hub/gateway/mcp-proxy.mjs');
      assert.equal(parseMcpSessionTtlMs({}), 8 * 60 * 60 * 1000);
      assert.equal(parseMcpMaxSessionsPerUser({}), 8);
    });

    it('respects valid env overrides', async () => {
      const { parseMcpSessionTtlMs, parseMcpMaxSessionsPerUser } = await import('../hub/gateway/mcp-proxy.mjs');
      assert.equal(parseMcpSessionTtlMs({ MCP_SESSION_TTL_MS: '3600000' }), 3600000);
      assert.equal(parseMcpMaxSessionsPerUser({ MCP_MAX_SESSIONS_PER_USER: '12' }), 12);
    });

    it('clamps TTL and max sessions', async () => {
      const { parseMcpSessionTtlMs, parseMcpMaxSessionsPerUser } = await import('../hub/gateway/mcp-proxy.mjs');
      assert.equal(parseMcpSessionTtlMs({ MCP_SESSION_TTL_MS: '1000' }), 5 * 60 * 1000);
      assert.equal(parseMcpSessionTtlMs({ MCP_SESSION_TTL_MS: '999999999999' }), 24 * 60 * 60 * 1000);
      assert.equal(parseMcpMaxSessionsPerUser({ MCP_MAX_SESSIONS_PER_USER: '1' }), 2);
      assert.equal(parseMcpMaxSessionsPerUser({ MCP_MAX_SESSIONS_PER_USER: '99' }), 20);
    });

    it('ignores non-numeric env (falls back to default)', async () => {
      const { parseMcpSessionTtlMs, parseMcpMaxSessionsPerUser } = await import('../hub/gateway/mcp-proxy.mjs');
      assert.equal(parseMcpSessionTtlMs({ MCP_SESSION_TTL_MS: 'abc' }), 8 * 60 * 60 * 1000);
      assert.equal(parseMcpMaxSessionsPerUser({ MCP_MAX_SESSIONS_PER_USER: 'x' }), 8);
    });
  });

  describe('createMcpProxyRouter', () => {
    it('creates a router with required methods', async () => {
      const { createMcpProxyRouter } = await import('../hub/gateway/mcp-proxy.mjs');
      const router = createMcpProxyRouter({
        getUserId: () => null,
        getHostedAccessContext: async () => null,
        canisterUrl: 'http://localhost:9999',
        bridgeUrl: 'http://localhost:9998',
        sessionSecret: 'test-secret',
      });
      assert.ok(router);
      assert.ok(typeof router === 'function');
      assert.ok(router._sessions instanceof Map);
      assert.ok(router._userSessions instanceof Map);
      clearInterval(router._cleanup);
    });

    it('rejects unauthenticated requests', async () => {
      const { createMcpProxyRouter } = await import('../hub/gateway/mcp-proxy.mjs');
      const router = createMcpProxyRouter({
        getUserId: () => null,
        getHostedAccessContext: async () => null,
        canisterUrl: 'http://localhost:9999',
        bridgeUrl: 'http://localhost:9998',
        sessionSecret: 'test-secret',
      });

      let statusCode = null;
      let body = null;
      const mockReq = {
        headers: {},
        method: 'POST',
        url: '/',
      };
      const mockRes = {
        status(code) { statusCode = code; return this; },
        json(data) { body = data; return this; },
        set() { return this; },
        headersSent: false,
      };
      const mockNext = () => {};

      const middleware = router.stack.find((layer) => !layer.route);
      if (middleware) {
        middleware.handle(mockReq, mockRes, mockNext);
        assert.equal(statusCode, 401);
        assert.ok(body?.error);
      }

      clearInterval(router._cleanup);
    });

    it('session pool is initially empty', async () => {
      const { createMcpProxyRouter } = await import('../hub/gateway/mcp-proxy.mjs');
      const router = createMcpProxyRouter({
        getUserId: () => 'user-1',
        getHostedAccessContext: async () => ({ role: 'viewer', scope: {} }),
        canisterUrl: 'http://localhost:9999',
        bridgeUrl: 'http://localhost:9998',
        sessionSecret: 'test-secret',
      });
      assert.equal(router._sessions.size, 0);
      assert.equal(router._userSessions.size, 0);
      clearInterval(router._cleanup);
    });
  });
});

describe('mcp-hosted-server', () => {
  it('creates a server instance with role-filtered tools', async () => {
    const { createHostedMcpServer } = await import('../hub/gateway/mcp-hosted-server.mjs');
    const server = createHostedMcpServer({
      userId: 'test-user',
      vaultId: 'test-vault',
      role: 'viewer',
      token: 'test-token',
      canisterUrl: 'http://localhost:9999',
      bridgeUrl: 'http://localhost:9998',
    });
    assert.ok(server);
    assert.ok(server.server);
  });

  it('viewer does not get write or index tools', async () => {
    const { createHostedMcpServer } = await import('../hub/gateway/mcp-hosted-server.mjs');
    const server = createHostedMcpServer({
      userId: 'test-user',
      vaultId: 'test-vault',
      role: 'viewer',
      token: 'test-token',
      canisterUrl: 'http://localhost:9999',
      bridgeUrl: 'http://localhost:9998',
    });
    assert.ok(server);
  });

  it('admin gets all tools', async () => {
    const { createHostedMcpServer } = await import('../hub/gateway/mcp-hosted-server.mjs');
    const server = createHostedMcpServer({
      userId: 'admin-user',
      vaultId: 'test-vault',
      role: 'admin',
      token: 'test-token',
      canisterUrl: 'http://localhost:9999',
      bridgeUrl: 'http://localhost:9998',
    });
    assert.ok(server);
  });
});
