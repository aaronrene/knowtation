import { expect } from 'chai';
import * as protocol from '../../lib/agent/external-agent-protocol.mjs';

describe('Unit: External Protocol Constants & Helpers', () => {
  it('should have default lease TTL defined', () => {
    expect(protocol.DEFAULT_LEASE_TTL_SECONDS).to.be.a('number');
    expect(protocol.DEFAULT_LEASE_TTL_SECONDS).to.equal(900);
  });

  it('should format task view for external protocol correctly', () => {
    const mockTask = { task_id: 'task-123', status: 'open' };
    const view = protocol.taskViewForExternalProtocol(mockTask, 'strict');
    expect(view).to.be.an('object');
    expect(view.task_id).to.equal('task-123');
  });
  
  it('should define protocolError', () => {
    expect(protocol.protocolError).to.be.a('function');
  });
});
