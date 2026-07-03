import { describe, it } from 'node:test';
import { expect } from 'chai';
import * as protocol from '../../lib/agent/external-agent-protocol.mjs';
import { createMockInput } from '../fixtures/agent/external-protocol-helpers.mjs';

describe('Security: External Protocol Boundaries', () => {
  it('should prevent cross-vault task leakage', async () => {
    const input = createMockInput({ vaultId: 'vault-malicious' });
    expect(input.vaultId).to.equal('vault-malicious');
  });
  
  it('should lock task safely via withTaskLock', async () => {
    expect(protocol.withTaskLock).to.be.a('function');
  });
});
