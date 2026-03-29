/**
 * Load proposal evaluation rubric: data_dir/hub_proposal_rubric.json overrides hub/proposal-rubric-default.json.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Netlify gateway bundle: import.meta.url may be missing at load time — never throw here.
function libDirname() {
  try {
    const u = typeof import.meta !== 'undefined' ? import.meta.url : '';
    if (u) return path.dirname(fileURLToPath(u));
  } catch (_) {}
  return path.join(process.cwd(), 'lib');
}

const __dirname = libDirname();
const PACKAGED_DEFAULT = path.join(__dirname, '..', 'hub', 'proposal-rubric-default.json');

/**
 * @returns {{ items: { id: string, label: string }[] }}
 */
export function loadProposalRubric(dataDir) {
  const overridePath = path.join(dataDir, 'hub_proposal_rubric.json');
  let raw;
  if (fs.existsSync(overridePath)) {
    try {
      raw = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    } catch {
      raw = null;
    }
  }
  if (!raw || !Array.isArray(raw.items)) {
    try {
      raw = JSON.parse(fs.readFileSync(PACKAGED_DEFAULT, 'utf8'));
    } catch {
      raw = { items: [] };
    }
  }
  const items = (raw.items || [])
    .map((x) => ({
      id: typeof x.id === 'string' ? x.id.trim().slice(0, 64) : '',
      label: typeof x.label === 'string' ? x.label.trim().slice(0, 500) : '',
    }))
    .filter((x) => x.id && x.label);
  return { items: items.length ? items : fallbackItems() };
}

/**
 * Used when override + packaged default file are unreadable (e.g. Netlify bundles the gateway
 * without `hub/proposal-rubric-default.json` next to the resolved `__dirname`). Keep in sync
 * with `hub/proposal-rubric-default.json`.
 */
function fallbackItems() {
  return [
    { id: 'accurate', label: 'Content appears accurate and appropriate for this vault' },
    { id: 'no_secrets', label: 'No obvious secrets, API keys, or credentials in the body' },
    { id: 'matches_intent', label: 'Change matches the stated intent (if any)' },
    { id: 'pii', label: 'No unnecessary personal data (PII) unless the note is meant to store it' },
    { id: 'tone', label: 'Tone and structure fit the rest of the vault' },
  ];
}
