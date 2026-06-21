/**
 * Tier 4 — STRESS: concurrent mints bounded; no bearer in list under load.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  handleFlowExternalGrantMintRequest,
  handleFlowExternalGrantListRequest,
} from '../lib/flow/external-agent.mjs';
import { upsertFlowVersion } from '../lib/flow/flow-store.mjs';
import {
  writeExternalAgentPolicy,
  makeExternalToolFlowBundle,
} from './fixtures/flow/external-agent-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-flow-external-agent-stress');

describe('Flow external-agent — stress', () => {
  const dataDir = path.join(tmpRoot, 'data');
  const vaultId = 'default';

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    writeExternalAgentPolicy(dataDir);
    process.env.FLOW_EXTERNAL_AGENT_ENABLED = '1';
    const bundle = makeExternalToolFlowBundle();
    upsertFlowVersion(dataDir, vaultId, bundle.flow, bundle.steps);
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    delete process.env.FLOW_EXTERNAL_AGENT_ENABLED;
  });

  it('many concurrent mints stay bounded and list has no bearer', async () => {
    const mints = await Promise.all(
      Array.from({ length: 32 }, () =>
        handleFlowExternalGrantMintRequest({
          dataDir,
          vaultId,
          flowId: 'flow_ext_agent_test',
          flowVersion: '1.0.0',
          requestedTools: ['web_search'],
        }),
      ),
    );
    for (const m of mints) {
      assert.equal(m.ok, true);
    }
    const list = handleFlowExternalGrantListRequest({ dataDir, vaultId });
    assert.equal(list.ok, true);
    assert.equal(list.payload.grants.length, 32);
    assert.equal(JSON.stringify(list.payload).includes('fgrnt_bearer_'), false);
  });
});
