/**
 * Pure payload builder for local + hosted capture (stable paths with fixed clock).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCaptureInboxWritePayload } from '../lib/capture-inbox.mjs';

describe('buildCaptureInboxWritePayload', () => {
  /** Fixed instant; path time segment follows local `Date#getHours` like production capture. */
  const fixed = new Date(Date.UTC(2026, 3, 18, 15, 30, 45));
  const hh = String(fixed.getHours()).padStart(2, '0');
  const mm = String(fixed.getMinutes()).padStart(2, '0');
  const ss = String(fixed.getSeconds()).padStart(2, '0');
  const tseg = `${hh}${mm}${ss}`;

  it('builds default inbox path, body, and frontmatter', () => {
    const o = buildCaptureInboxWritePayload('Hello World!', {}, fixed);
    assert.equal(o.path, `inbox/2026-04-18-${tseg}-hello-world.md`);
    assert.equal(o.body, 'Hello World!');
    assert.equal(o.frontmatter.source, 'mcp-capture');
    assert.equal(o.frontmatter.date, '2026-04-18');
    assert.equal(o.frontmatter.inbox, true);
    assert.equal(o.frontmatter.project, undefined);
    assert.equal(o.frontmatter.tags, undefined);
  });

  it('honors source, project slug, and tags', () => {
    const o = buildCaptureInboxWritePayload('Note body', { source: 'slack', project: 'Launch', tags: ['a', ' B '] }, fixed);
    assert.equal(o.path, `projects/launch/inbox/2026-04-18-${tseg}-note-body.md`);
    assert.equal(o.body, 'Note body');
    assert.equal(o.frontmatter.source, 'slack');
    assert.equal(o.frontmatter.project, 'launch');
    assert.equal(o.frontmatter.tags, 'a, b');
  });

  it('uses project inbox directory when project is set', () => {
    const o = buildCaptureInboxWritePayload('x', { project: 'My-Project' }, fixed);
    assert.equal(o.path, `projects/my-project/inbox/2026-04-18-${tseg}-x.md`);
  });
});
