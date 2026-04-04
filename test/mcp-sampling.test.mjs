import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { trySampling, trySamplingJson, clientSupportsSampling, samplingResultToText } from '../mcp/sampling.mjs';

function makeMockServer({ sampling = true, createMessageResult = null, createMessageThrows = false } = {}) {
  return {
    server: {
      getClientCapabilities: () => (sampling ? { sampling: {} } : {}),
      createMessage: async (req) => {
        if (createMessageThrows) throw new Error('sampling failed');
        return createMessageResult ?? {
          content: { type: 'text', text: `response to: ${req.messages[0]?.content?.text}` },
          model: 'mock',
          role: 'assistant',
        };
      },
    },
  };
}

describe('samplingResultToText', () => {
  it('handles single text content', () => {
    assert.equal(samplingResultToText({ content: { type: 'text', text: 'hello' } }), 'hello');
  });
  it('handles array content', () => {
    assert.equal(
      samplingResultToText({
        content: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      }),
      'a\nb'
    );
  });
  it('returns empty for null', () => {
    assert.equal(samplingResultToText(null), '');
    assert.equal(samplingResultToText({}), '');
    assert.equal(samplingResultToText({ content: null }), '');
  });
});

describe('clientSupportsSampling', () => {
  it('returns true when sampling capability present', () => {
    assert.equal(clientSupportsSampling(makeMockServer({ sampling: true })), true);
  });
  it('returns false when sampling capability absent', () => {
    assert.equal(clientSupportsSampling(makeMockServer({ sampling: false })), false);
  });
});

describe('trySampling', () => {
  it('returns text when sampling available', async () => {
    const result = await trySampling(makeMockServer(), { system: 'sys', user: 'hello', maxTokens: 100 });
    assert.equal(result, 'response to: hello');
  });

  it('returns null when sampling not available', async () => {
    const result = await trySampling(makeMockServer({ sampling: false }), { system: 'sys', user: 'hello' });
    assert.equal(result, null);
  });

  it('returns null on createMessage error', async () => {
    const result = await trySampling(
      makeMockServer({ createMessageThrows: true }),
      { system: 'sys', user: 'hello' }
    );
    assert.equal(result, null);
  });

  it('returns null for empty response', async () => {
    const result = await trySampling(
      makeMockServer({ createMessageResult: { content: { type: 'text', text: '' } } }),
      { system: 'sys', user: 'hello' }
    );
    assert.equal(result, null);
  });

  it('clamps maxTokens to 1-8192', async () => {
    let capturedReq = null;
    const server = {
      server: {
        getClientCapabilities: () => ({ sampling: {} }),
        createMessage: async (req) => {
          capturedReq = req;
          return { content: { type: 'text', text: 'ok' } };
        },
      },
    };
    await trySampling(server, { system: 'sys', user: 'u', maxTokens: 99999 });
    assert.equal(capturedReq.maxTokens, 8192);
    await trySampling(server, { system: 'sys', user: 'u', maxTokens: -5 });
    assert.equal(capturedReq.maxTokens, 1);
  });

  it('defaults maxTokens to 512', async () => {
    let capturedReq = null;
    const server = {
      server: {
        getClientCapabilities: () => ({ sampling: {} }),
        createMessage: async (req) => {
          capturedReq = req;
          return { content: { type: 'text', text: 'ok' } };
        },
      },
    };
    await trySampling(server, { system: 'sys', user: 'u' });
    assert.equal(capturedReq.maxTokens, 512);
  });
});

describe('trySamplingJson', () => {
  it('parses valid JSON from sampling response', async () => {
    const server = makeMockServer({
      createMessageResult: {
        content: { type: 'text', text: '{"project":"test","tags":["a","b"]}' },
      },
    });
    const result = await trySamplingJson(server, { system: 'sys', user: 'u' });
    assert.deepEqual(result, { project: 'test', tags: ['a', 'b'] });
  });

  it('strips markdown fences from JSON', async () => {
    const server = makeMockServer({
      createMessageResult: {
        content: { type: 'text', text: '```json\n{"ok": true}\n```' },
      },
    });
    const result = await trySamplingJson(server, { system: 'sys', user: 'u' });
    assert.deepEqual(result, { ok: true });
  });

  it('returns null for invalid JSON', async () => {
    const server = makeMockServer({
      createMessageResult: {
        content: { type: 'text', text: 'not valid json at all' },
      },
    });
    const result = await trySamplingJson(server, { system: 'sys', user: 'u' });
    assert.equal(result, null);
  });

  it('returns null when sampling unavailable', async () => {
    const result = await trySamplingJson(makeMockServer({ sampling: false }), { system: 'sys', user: 'u' });
    assert.equal(result, null);
  });
});
