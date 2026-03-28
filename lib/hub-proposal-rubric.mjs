/**
 * Load proposal evaluation rubric: data_dir/hub_proposal_rubric.json overrides hub/proposal-rubric-default.json.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

function fallbackItems() {
  return [
    { id: 'accurate', label: 'Content appears accurate and appropriate for this vault' },
    { id: 'no_secrets', label: 'No obvious secrets, API keys, or credentials in the body' },
  ];
}
