/**
 * Hosted proposal LLM prefs: data/hosted_proposal_llm_prefs.json or Netlify Blob (gateway-billing store).
 * Same blob accessor as billing; distinct key.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getProposalEvaluationRequired } from '../../lib/hub-proposal-policy.mjs';

let projectRoot;
try {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  projectRoot = path.resolve(__dirname, '..', '..');
} catch (_) {
  projectRoot = process.cwd();
}

const PREFS_FILE = path.join(projectRoot, 'data', 'hosted_proposal_llm_prefs.json');
const BLOB_KEY = 'proposal-llm-prefs-v1';

function getBlobStore() {
  return globalThis.__knowtation_gateway_blob;
}

/** @param {unknown} v */
function envTriState(v) {
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return null;
}

function emptyPrefs() {
  return {
    proposal_evaluation_required: false,
    review_hints_enabled: false,
    enrich_enabled: false,
  };
}

function normalizePrefs(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const out = emptyPrefs();
  if (typeof d.proposal_evaluation_required === 'boolean') out.proposal_evaluation_required = d.proposal_evaluation_required;
  if (typeof d.review_hints_enabled === 'boolean') out.review_hints_enabled = d.review_hints_enabled;
  if (typeof d.enrich_enabled === 'boolean') out.enrich_enabled = d.enrich_enabled;
  return out;
}

async function readFromBlob() {
  const store = getBlobStore();
  if (!store) return null;
  const raw = await store.get(BLOB_KEY, { type: 'json' });
  return normalizePrefs(raw);
}

async function writeToBlob(prefs) {
  const store = getBlobStore();
  if (!store) throw new Error('Netlify Blob store not configured');
  await store.setJSON(BLOB_KEY, prefs);
}

async function readFromFile() {
  try {
    const raw = await fs.readFile(PREFS_FILE, 'utf8');
    return normalizePrefs(JSON.parse(raw));
  } catch (e) {
    if (e.code === 'ENOENT') return emptyPrefs();
    throw e;
  }
}

async function writeToFile(prefs) {
  await fs.mkdir(path.dirname(PREFS_FILE), { recursive: true });
  await fs.writeFile(PREFS_FILE, JSON.stringify(prefs, null, 2), 'utf8');
}

export async function loadHostedProposalLlmPrefs() {
  if (getBlobStore()) {
    const fromBlob = await readFromBlob();
    if (fromBlob) return fromBlob;
    return emptyPrefs();
  }
  return readFromFile();
}

export async function saveHostedProposalLlmPrefs(prefs) {
  if (getBlobStore()) {
    await writeToBlob(prefs);
  } else {
    await writeToFile(prefs);
  }
}

/**
 * @param {Awaited<ReturnType<typeof loadHostedProposalLlmPrefs>>} prefs
 * @param {string} dataDir - e.g. path.join(projectRoot, 'data')
 */
export function effectiveHostedEvaluationRequired(prefs, dataDir) {
  const fromEnv = envTriState(process.env.HUB_PROPOSAL_EVALUATION_REQUIRED);
  if (fromEnv !== null) return fromEnv;
  if (typeof prefs?.proposal_evaluation_required === 'boolean') return prefs.proposal_evaluation_required;
  return getProposalEvaluationRequired(dataDir);
}

/** @param {Awaited<ReturnType<typeof loadHostedProposalLlmPrefs>>} prefs */
export function effectiveHostedReviewHints(prefs) {
  const fromEnv = envTriState(process.env.KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS);
  if (fromEnv !== null) return fromEnv;
  return Boolean(prefs?.review_hints_enabled);
}

/** @param {Awaited<ReturnType<typeof loadHostedProposalLlmPrefs>>} prefs */
export function effectiveHostedEnrich(prefs) {
  const fromEnv = envTriState(process.env.KNOWTATION_HUB_PROPOSAL_ENRICH);
  if (fromEnv !== null) return fromEnv;
  return Boolean(prefs?.enrich_enabled);
}

/**
 * Merge partial into stored prefs (admin UI). Skips keys locked by env.
 * @param {Partial<{ proposal_evaluation_required: boolean, review_hints_enabled: boolean, enrich_enabled: boolean }>} partial
 */
export async function mergeHostedProposalLlmPrefs(partial) {
  const locks = {
    proposal_evaluation_required: envTriState(process.env.HUB_PROPOSAL_EVALUATION_REQUIRED) !== null,
    review_hints_enabled: envTriState(process.env.KNOWTATION_HUB_PROPOSAL_REVIEW_HINTS) !== null,
    enrich_enabled: envTriState(process.env.KNOWTATION_HUB_PROPOSAL_ENRICH) !== null,
  };
  const cur = await loadHostedProposalLlmPrefs();
  const next = { ...cur };
  if (partial.proposal_evaluation_required !== undefined && !locks.proposal_evaluation_required) {
    next.proposal_evaluation_required = Boolean(partial.proposal_evaluation_required);
  }
  if (partial.review_hints_enabled !== undefined && !locks.review_hints_enabled) {
    next.review_hints_enabled = Boolean(partial.review_hints_enabled);
  }
  if (partial.enrich_enabled !== undefined && !locks.enrich_enabled) {
    next.enrich_enabled = Boolean(partial.enrich_enabled);
  }
  await saveHostedProposalLlmPrefs(next);
  return next;
}
