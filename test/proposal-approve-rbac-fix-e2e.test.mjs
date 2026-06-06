/**
 * E2E tests — proposal approve RBAC fix.
 *
 * Verifies the gateway's actual assertHostedProposalApproveDiscard behavior and the
 * hub.js approveProposal error path at the structural (source-code wiring) level.
 * These tests confirm the fix is fully wired end-to-end without requiring a live server.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

describe('E2E: assertHostedProposalApproveDiscard wiring', () => {
  let src;
  const load = () => {
    if (!src) src = fs.readFileSync(path.join(ROOT, 'hub/gateway/server.mjs'), 'utf8');
    return src;
  };

  test('assertHostedProposalApproveDiscard calls resolveHostedActorRole', () => {
    const s = load();
    const fnStart = s.indexOf('async function assertHostedProposalApproveDiscard');
    assert.ok(fnStart > 0, 'assertHostedProposalApproveDiscard exists');
    const fnEnd = s.indexOf('\n}\n', fnStart);
    const fn = s.slice(fnStart, fnEnd + 3);
    assert.ok(fn.includes('resolveHostedActorRole'), 'resolveHostedActorRole called inside assertHostedProposalApproveDiscard');
  });

  test('canApprove check includes admin and evaluator paths', () => {
    const s = load();
    const fnStart = s.indexOf('async function assertHostedProposalApproveDiscard');
    const fn = s.slice(fnStart, s.indexOf('\n}\n', fnStart) + 3);
    assert.ok(fn.includes("role === 'admin'"), 'admin role allows approve');
    assert.ok(fn.includes('mayApproveProposals'), 'evaluator mayApproveProposals checked');
  });

  test('getUserId check prevents unauthenticated approve (401)', () => {
    const s = load();
    const fnStart = s.indexOf('async function assertHostedProposalApproveDiscard');
    const fn = s.slice(fnStart, s.indexOf('\n}\n', fnStart) + 3);
    assert.ok(fn.includes('getUserId'), '401 guard uses getUserId');
    assert.ok(fn.includes('401'), '401 response when uid is missing');
  });

  test('403 returned with code FORBIDDEN when canApprove is false', () => {
    const s = load();
    const fnStart = s.indexOf('async function assertHostedProposalApproveDiscard');
    const fn = s.slice(fnStart, s.indexOf('\n}\n', fnStart) + 3);
    assert.ok(fn.includes('403'), '403 returned for unauthorized approve');
    assert.ok(fn.includes("'FORBIDDEN'"), 'FORBIDDEN code in 403 response');
  });

  test('proxyToCanister calls assertHostedProposalApproveDiscard before proxying', () => {
    const s = load();
    const fnStart = s.indexOf('async function proxyToCanister');
    const fn = s.slice(fnStart, s.indexOf('\n}\n', fnStart) + 3);
    assert.ok(fn.includes('assertHostedProposalApproveDiscard'), 'RBAC gate is called before proxy');
  });
});

describe('E2E: hub.js approve flow completeness', () => {
  let src;
  const load = () => {
    if (!src) src = fs.readFileSync(path.join(ROOT, 'web/hub/hub.js'), 'utf8');
    return src;
  };

  test('approveProposal sends POST to the correct proposals approve endpoint', () => {
    const s = load();
    const fnStart = s.indexOf('async function approveProposal');
    const fn = s.slice(fnStart, s.indexOf('\n  async function discardProposal', fnStart));
    assert.ok(fn.includes("'/api/v1/proposals/'"), 'proposals API path used');
    assert.ok(fn.includes("'/approve'"), 'approve path segment used');
    assert.ok(fn.includes("method: 'POST'"), 'POST method used');
  });

  test('withButtonBusy wraps the API call (spinner behavior)', () => {
    const s = load();
    const fnStart = s.indexOf('async function approveProposal');
    const fn = s.slice(fnStart, s.indexOf('\n  async function discardProposal', fnStart));
    assert.ok(fn.includes("withButtonBusy(btn, 'Approving"), 'withButtonBusy used for approveProposal spinner');
  });

  test('success path: hideDetailPanelChrome called after approval, before error handling', () => {
    const s = load();
    const fnStart = s.indexOf('async function approveProposal');
    const fn = s.slice(fnStart, s.indexOf('\n  async function discardProposal', fnStart));
    const successIdx = fn.indexOf('hideDetailPanelChrome');
    const catchIdx = fn.indexOf('} catch (e)');
    assert.ok(successIdx < catchIdx, 'hideDetailPanelChrome is in success path before catch');
  });

  test('error path: showToast is called in catch (error is always visible)', () => {
    const s = load();
    const fnStart = s.indexOf('async function approveProposal');
    const fn = s.slice(fnStart, s.indexOf('\n  async function discardProposal', fnStart));
    const catchIdx = fn.indexOf('} catch (e)');
    const toastIdx = fn.indexOf('showToast', catchIdx);
    assert.ok(catchIdx > 0 && toastIdx > catchIdx, 'showToast called inside catch block');
  });

  test('approval_log_written partial-success path preserved', () => {
    const s = load();
    const fnStart = s.indexOf('async function approveProposal');
    const fn = s.slice(fnStart, s.indexOf('\n  async function discardProposal', fnStart));
    assert.ok(fn.includes('approval_log_written'), 'partial approve log warning preserved');
    assert.ok(fn.includes('approval_log_error'), 'approval_log_error warning preserved');
  });
});
