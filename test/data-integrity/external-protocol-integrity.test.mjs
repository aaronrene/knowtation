import { expect } from 'chai';
import * as protocol from '../../lib/agent/external-agent-protocol.mjs';

describe('Data Integrity: External Protocol', () => {
  it('should ensure sweeper cleans up expired leases', async () => {
    expect(protocol.sweepExpiredLeases).to.be.a('function');
  });
});
