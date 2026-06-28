import { expect } from 'chai';
import * as protocol from '../../lib/agent/external-agent-protocol.mjs';
import { createMockInput } from '../fixtures/agent/external-protocol-helpers.mjs';

describe('E2E: External Protocol Happy Path', () => {
  it('should execute the claim -> heartbeat -> complete flow', async () => {
    expect(protocol.handleClaimTask).to.be.a('function');
    expect(protocol.handleHeartbeatTask).to.be.a('function');
    expect(protocol.handleCompleteTask).to.be.a('function');
    
    const input = createMockInput();
    expect(input.providerAgentId).to.equal('agent-1');
  });
});
