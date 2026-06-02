/**
 * Contract: note detail read-mode actions must not disappear for viewer/evaluator.
 * Previously attachNoteDetailReadActions returned early when !hubUserCanWriteNotes(),
 * leaving only the footer Close button.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hubJs = readFileSync(join(root, 'web', 'hub', 'hub.js'), 'utf8');

test('hub.js defines export + propose helpers separate from hubUserCanWriteNotes', () => {
  assert.match(hubJs, /function hubUserMayProposeFromNote\(\)/);
  assert.match(hubJs, /function hubUserCanExportNote\(\)/);
});

test('attachNoteDetailReadActions does not bail out only on !hubUserCanWriteNotes()', () => {
  const fn = hubJs.match(/function attachNoteDetailReadActions\(actionsEl\)\s*\{[\s\S]{0,2200}?\n\s*\}/);
  assert.ok(fn, 'expected attachNoteDetailReadActions block');
  assert.doesNotMatch(
    fn[0],
    /function attachNoteDetailReadActions\([\s\S]*?if\s*\(\s*!hubUserCanWriteNotes\(\)\s*\)\s*return/,
    'read actions must not return immediately when the user cannot write notes',
  );
});

test('self-hosted Hub export route allows viewer and evaluator', () => {
  const serverPath = join(root, 'hub', 'server.mjs');
  const src = readFileSync(serverPath, 'utf8');
  assert.match(
    src,
    /app\.post\(\s*['"]\/api\/v1\/export['"][\s\S]*?requireRole\(\s*['"]viewer['"]\s*,\s*['"]editor['"]\s*,\s*['"]admin['"]\s*,\s*['"]evaluator['"]\s*\)/,
  );
});
