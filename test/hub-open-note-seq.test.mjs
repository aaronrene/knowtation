/**
 * Contract: openNote uses a monotonic sequence so concurrent fetches cannot duplicate detail-actions buttons.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hubJs = path.join(__dirname, '..', 'web', 'hub', 'hub.js');

describe('hub openNote stale-response guard', () => {
  it('hub.js increments hubOpenNoteSeq and ignores stale fetch completions', () => {
    const src = fs.readFileSync(hubJs, 'utf8');
    assert.match(src, /\blet hubOpenNoteSeq\b/);
    assert.match(src, /const seq = \+\+hubOpenNoteSeq/);
    assert.ok(src.includes('if (seq !== hubOpenNoteSeq) return;'));
    assert.ok(
      src.includes('attachNoteDetailReadActions(actionsEl)') &&
        /actionsEl\.innerHTML = '';\s*\n\s*attachNoteDetailReadActions\(actionsEl\)/.test(src),
    );
  });
});
