import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { maybeAppendSamplingPrefill } from '../mcp/prompts/helpers.mjs';

function makeMockServer({ sampling = true, response = 'Draft response here' } = {}) {
  return {
    server: {
      getClientCapabilities: () => (sampling ? { sampling: {} } : {}),
      createMessage: async () => ({
        content: { type: 'text', text: response },
        model: 'mock',
        role: 'assistant',
      }),
    },
  };
}

describe('maybeAppendSamplingPrefill', () => {
  it('appends assistant message when sampling available', async () => {
    const result = await maybeAppendSamplingPrefill(
      makeMockServer(),
      {
        description: 'test',
        messages: [
          { role: 'user', content: { type: 'text', text: 'Summarize my notes.' } },
        ],
      }
    );
    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[1].role, 'assistant');
    assert.equal(result.messages[1].content.text, 'Draft response here');
  });

  it('does not append when sampling unavailable', async () => {
    const result = await maybeAppendSamplingPrefill(
      makeMockServer({ sampling: false }),
      {
        description: 'test',
        messages: [
          { role: 'user', content: { type: 'text', text: 'Summarize.' } },
        ],
      }
    );
    assert.equal(result.messages.length, 1);
  });

  it('does not append when last message is already assistant', async () => {
    const result = await maybeAppendSamplingPrefill(
      makeMockServer(),
      {
        messages: [
          { role: 'user', content: { type: 'text', text: 'Hello' } },
          { role: 'assistant', content: { type: 'text', text: 'Existing prefill' } },
        ],
      }
    );
    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[1].content.text, 'Existing prefill');
  });

  it('returns unchanged for empty messages', async () => {
    const result = await maybeAppendSamplingPrefill(makeMockServer(), { messages: [] });
    assert.deepEqual(result.messages, []);
  });

  it('returns unchanged for null input', async () => {
    const result = await maybeAppendSamplingPrefill(makeMockServer(), null);
    assert.equal(result, null);
  });

  it('handles string content in user message', async () => {
    const result = await maybeAppendSamplingPrefill(
      makeMockServer(),
      {
        messages: [{ role: 'user', content: 'plain string content' }],
      }
    );
    assert.equal(result.messages.length, 2);
    assert.equal(result.messages[1].role, 'assistant');
  });

  it('preserves description field', async () => {
    const result = await maybeAppendSamplingPrefill(
      makeMockServer(),
      {
        description: 'My description',
        messages: [{ role: 'user', content: { type: 'text', text: 'test' } }],
      }
    );
    assert.equal(result.description, 'My description');
  });
});
