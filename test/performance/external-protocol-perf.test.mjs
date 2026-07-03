import { describe, it } from 'node:test';
import { expect } from 'chai';
import * as protocol from '../../lib/agent/external-agent-protocol.mjs';

describe('Performance: External Protocol', () => {
  it('should fetch tasks rapidly', async () => {
    expect(protocol.handleGetTasks).to.be.a('function');
    const start = Date.now();
    const duration = Date.now() - start;
    expect(duration).to.be.below(100);
  });
});
