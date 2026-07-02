/**
 * Tier 1 — UNIT: Attachment store helpers, id derivation, and projections.
 *
 * @see docs/ATTACHMENT-STORE-CONTRACT-2F-b.md §9
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATTACHMENT_ID_RE,
  NOTE_REF_RE,
  deriveAttachmentId,
  normalizeUrlForId,
  noteRefFromPath,
  attachmentSummaryForClient,
  attachmentForClient,
  urlHostOnly,
  MAX_LINKED_NOTES,
} from '../lib/attachments/attachment-store.mjs';
import { getVaultAttachmentPolicies } from '../lib/attachments/attachment-store-file.mjs';
import { buildAttachmentFixtureVault, FIXTURE_MIST_ID } from './fixtures/attachment-fixture.mjs';
import { listAttachments, getAttachment } from '../lib/attachments/attachment-store.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpRoot = path.join(__dirname, 'fixtures', 'tmp-attachment-unit');

describe('Attachment store — id regexes', () => {
  it('ATTACHMENT_ID_RE accepts canonical ids and rejects malformed', () => {
    const id = deriveAttachmentId('file', 'file:media/x.png');
    assert.ok(ATTACHMENT_ID_RE.test(id));
    assert.ok(!ATTACHMENT_ID_RE.test('att_file_SHORT'));
    assert.ok(!ATTACHMENT_ID_RE.test('att_FILE_' + 'a'.repeat(32)));
    assert.ok(!ATTACHMENT_ID_RE.test('media_file_' + 'a'.repeat(32)));
  });

  it('NOTE_REF_RE accepts canonical refs and rejects traversal', () => {
    assert.ok(NOTE_REF_RE.test('note:inbox/foo.md'));
    assert.equal(noteRefFromPath('../escape.md'), '');
    assert.equal(noteRefFromPath('/absolute.md'), 'note:absolute.md');
  });

  it('id derivation is deterministic and source-distinct', () => {
    const a = deriveAttachmentId('file', 'file:media/a.png');
    const b = deriveAttachmentId('file', 'file:media/b.png');
    const c = deriveAttachmentId('mist', `mist:${FIXTURE_MIST_ID}`);
    assert.equal(a, deriveAttachmentId('file', 'file:media/a.png'));
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });
});

describe('Attachment store — client projections', () => {
  const sample = {
    schema: 'knowtation.attachment/v0',
    attachment_id: deriveAttachmentId('file', 'file:media/x.png'),
    source: 'vault_file',
    storage_kind: 'vault_blob',
    mime_class: 'image',
    mime_type: 'image/png',
    scope: 'personal',
    display_label: 'x',
    byte_size: 100,
    linked_note_refs: ['note:inbox/x.md'],
    agent_visible: false,
    created: '2026-07-02T00:00:00Z',
    updated: '2026-07-02T00:00:00Z',
    truncated: false,
  };

  it('attachmentSummaryForClient drops sensitive list fields', () => {
    const summary = attachmentSummaryForClient(sample);
    assert.equal('byte_size' in summary, false);
    assert.equal('linked_note_refs' in summary, false);
    assert.equal('agent_visible' in summary, false);
    assert.equal('mime_type' in summary, false);
    assert.equal(summary.attachment_id, sample.attachment_id);
  });

  it('attachmentForClient caps linked_note_refs and sets truncated', () => {
    const refs = Array.from({ length: MAX_LINKED_NOTES + 3 }, (_, i) => `note:ref${i}.md`);
    const client = attachmentForClient({ ...sample, linked_note_refs: refs });
    assert.equal(client.linked_note_refs.length, MAX_LINKED_NOTES);
    assert.equal(client.truncated, true);
  });

  it('display_label for embedded_url uses host only', () => {
    assert.equal(urlHostOnly('https://user:pass@cdn.example.com/x.png?sig=abc'), 'cdn.example.com');
  });
});

describe('Attachment store — overlay defaults', () => {
  const dataDir = path.join(tmpRoot, 'overlay');

  beforeEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('missing overlay ⇒ agent_visible:false default', () => {
    const fx = buildAttachmentFixtureVault(tmpRoot);
    const policies = getVaultAttachmentPolicies(fx.dataDir, fx.vaultId);
    assert.deepEqual(policies, {});

    const list = listAttachments(fx.dataDir, fx.vaultPath, fx.vaultId, {
      filterScopes: new Set(['personal', 'project', 'org']),
      effectiveScope: 'org',
    });
    const got = getAttachment(fx.dataDir, fx.vaultPath, fx.vaultId, fx.mistId, {
      visibleScopes: new Set(['personal', 'project', 'org']),
    });
    assert.ok(got);
    assert.equal(got.agent_visible, false);
    assert.ok(list.attachments.length >= 1);
  });
});
