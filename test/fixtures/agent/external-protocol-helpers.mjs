export function createMockTask(taskId = 'task-1') {
  return {
    id: taskId,
    status: 'open',
    title: 'Mock Task'
  };
}

export function createMockInput(overrides = {}) {
  return {
    dataDir: '/tmp/mock-data-dir',
    vaultId: 'vault-1',
    taskId: 'task-1',
    providerAgentId: 'agent-1',
    ...overrides
  };
}
