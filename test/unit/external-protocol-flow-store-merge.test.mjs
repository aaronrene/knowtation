import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeFlowStoreJson } from '../../hub/bridge/external-agent-blob-store.mjs';

describe('mergeFlowStoreJson', () => {
  it('merges tasks by task_id keeping fresher updated timestamp', () => {
    const blob = JSON.stringify({
      vaults: {
        default: {
          tasks: [
            {
              task_id: 'task_a',
              status: 'pending',
              updated: '2026-06-28T00:00:00.000Z',
              title: 'blob',
            },
          ],
        },
      },
    });
    const local = JSON.stringify({
      vaults: {
        default: {
          tasks: [
            {
              task_id: 'task_a',
              status: 'blocked',
              updated: '2026-06-28T01:00:00.000Z',
              title: 'local',
            },
            {
              task_id: 'task_b',
              status: 'pending',
              updated: '2026-06-28T01:00:00.000Z',
              title: 'new',
            },
          ],
        },
      },
    });

    const merged = JSON.parse(mergeFlowStoreJson(local, blob));
    const tasks = merged.vaults.default.tasks;
    assert.equal(tasks.length, 2);
    const taskA = tasks.find((t) => t.task_id === 'task_a');
    assert.equal(taskA.title, 'local');
    assert.equal(tasks.find((t) => t.task_id === 'task_b').title, 'new');
  });
});
