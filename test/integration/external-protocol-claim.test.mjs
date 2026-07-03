import { describe, it } from 'node:test';
import { expect } from 'chai';
import * as protocol from '../../lib/agent/external-agent-protocol.mjs';
import { createMockInput } from '../fixtures/agent/external-protocol-helpers.mjs';

describe('Integration: External Protocol Claim Flow', () => {
  it('should have handleClaimTask exported', async () => {
    expect(protocol.handleClaimTask).to.be.a('function');
  });
  
  it('should simulate a task claim validation', async () => {
    const input = createMockInput();
    expect(input.taskId).to.equal('task-1');
  });
});
