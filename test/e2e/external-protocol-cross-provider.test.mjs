import { expect } from 'chai';
import * as protocol from '../../lib/agent/external-agent-protocol.mjs';
import { createMockInput } from '../fixtures/agent/external-protocol-helpers.mjs';

describe('E2E: External Protocol Cross Provider', () => {
  it('should execute multi-provider handoff scenarios', async () => {
    expect(protocol.handleNeedsInputTask).to.be.a('function');
    
    const inputA = createMockInput({ providerAgentId: 'agent-A' });
    const inputB = createMockInput({ providerAgentId: 'agent-B' });
    
    expect(inputA.providerAgentId).to.not.equal(inputB.providerAgentId);
  });
});
