/**
 * Shared proposal Enrich: LLM prompt, parse, validate/normalize (SPEC-aligned metadata).
 * Used by self-hosted hub/server.mjs and hub/gateway/proposal-enrich-hosted.mjs.
 */

import { normalizeSlug, normalizeTags } from './vault.mjs';

export const ENRICH_VERSION = 2;

/** Keys the model may place inside suggested_frontmatter (SPEC §2.1 + §2.3). */
export const SUGGESTED_FRONTMATTER_KEYS = new Set([
  'title',
  'project',
  'tags',
  'date',
  'updated',
  'source',
  'source_id',
  'intent',
  'follows',
  'causal_chain_id',
  'entity',
  'episode_id',
  'summarizes',
  'summarizes_range',
  'state_snapshot',
]);

const FORBIDDEN_KEY_PREFIXES = ['knowtation_'];
const FORBIDDEN_KEYS = new Set([
  'author_kind',
  'network',
  'wallet_address',
  'tx_hash',
  'payment_status',
  'kind', // approval_log etc.
]);

const MAX_SUMMARY_CHARS = 8000;
const MAX_LABELS = 8;
const MAX_LABEL_LEN = 64;
const MAX_SCALAR_CHARS = 512;
const MAX_TITLE_CHARS = 500;
const MAX_INTENT_CHARS = 2000;
const MAX_PATH_SEGMENTS = 20;
const MAX_JSON_OUTPUT_CHARS = 14000;

function isForbiddenKey(k) {
  if (typeof k !== 'string' || !k) return true;
  const lower = k.toLowerCase();
  if (FORBIDDEN_KEYS.has(lower)) return true;
  for (const p of FORBIDDEN_KEY_PREFIXES) {
    if (lower.startsWith(p)) return true;
  }
  return false;
}

/**
 * Vault-relative path segment check: no escape, no null bytes.
 * @param {string} s
 */
function isSafeVaultPathLike(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim().replace(/\\/g, '/');
  if (!t || t.includes('\0')) return false;
  if (t.startsWith('/') || t.includes('..')) return false;
  const parts = t.split('/').filter(Boolean);
  if (parts.length > MAX_PATH_SEGMENTS) return false;
  for (const seg of parts) {
    if (seg === '..' || seg === '.') return false;
  }
  return true;
}

function clampStr(s, max) {
  if (typeof s !== 'string') return '';
  const t = s.trim();
  return t.length <= max ? t : t.slice(0, max);
}

/**
 * @param {{ path?: string, intent?: string, body?: string }} input
 * @param {{ bodyMaxChars?: number }} [opts]
 * @returns {{ system: string, user: string }}
 */
export function buildEnrichMessages(input, opts = {}) {
  const bodyMax = opts.bodyMaxChars ?? 12_000;
  const path = input.path != null ? String(input.path) : '';
  const intent = input.intent != null ? String(input.intent) : '—';
  const body = input.body != null ? String(input.body).slice(0, bodyMax) : '';
  const keyList = [...SUGGESTED_FRONTMATTER_KEYS].sort().join(', ');
  const system = `Reply with ONLY valid JSON (no markdown fences). Schema:
{
  "enrich_version": ${ENRICH_VERSION},
  "summary": "one short paragraph describing the proposed change",
  "suggested_labels": ["short-tag", ...],
  "suggested_frontmatter": { ... optional; only keys from this allow-list: ${keyList} }
}
Rules:
- suggested_labels: at most ${MAX_LABELS} strings; lowercase slugs (a-z, 0-9, hyphen).
- suggested_frontmatter: only use keys from the allow-list. Omit keys you are unsure about.
- For project, causal_chain_id, episode_id, entity (if string), tags: use slug form (lowercase, hyphens).
- entity may be a string or array of strings (each normalized as slug).
- follows and summarizes may be a vault-relative path string or array of such paths (e.g. inbox/note.md).
- state_snapshot must be boolean if present.
- Do NOT include knowtation_* keys, author_kind, or blockchain fields (network, wallet_address, tx_hash, payment_status).`;
  const user = `Path: ${path}\nIntent: ${intent}\n---\n${body}`;
  return { system, user };
}

/**
 * @param {string} rawText
 * @returns {{
 *   enrich_version: number,
 *   summary: string,
 *   suggested_labels: string[],
 *   suggested_frontmatter: Record<string, unknown>,
 *   parseOk: boolean,
 * }}
 */
export function parseEnrichModelOutput(rawText) {
  const raw = rawText != null ? String(rawText) : '';
  let summary = raw.trim();
  const suggested_labels = [];
  /** @type {Record<string, unknown>} */
  const suggested_frontmatter = {};
  let enrich_version = 1;
  let parseOk = false;
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/m, '').trim();
    const j = JSON.parse(cleaned);
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      parseOk = true;
      if (typeof j.summary === 'string') summary = j.summary;
      if (typeof j.enrich_version === 'number' && Number.isFinite(j.enrich_version)) {
        enrich_version = j.enrich_version;
      }
      if (Array.isArray(j.suggested_labels)) {
        for (const x of j.suggested_labels) {
          suggested_labels.push(String(x));
        }
      }
      const sf = j.suggested_frontmatter;
      if (sf && typeof sf === 'object' && !Array.isArray(sf)) {
        for (const [k, v] of Object.entries(sf)) {
          suggested_frontmatter[k] = v;
        }
      }
    }
  } catch (_) {
    /* keep summary = raw */
  }
  return {
    enrich_version,
    summary: clampStr(summary, MAX_SUMMARY_CHARS),
    suggested_labels,
    suggested_frontmatter,
    parseOk,
  };
}

/**
 * Normalize labels for storage (slug-like tags).
 * @param {string[]} labels
 */
export function normalizeSuggestedLabels(labels) {
  if (!Array.isArray(labels)) return [];
  const out = normalizeTags(labels.map((x) => String(x))).filter(Boolean);
  return [...new Set(out)].slice(0, MAX_LABELS).map((t) => (t.length > MAX_LABEL_LEN ? t.slice(0, MAX_LABEL_LEN) : t));
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {Record<string, unknown>}
 */
export function validateAndNormalizeSuggestedFrontmatter(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!SUGGESTED_FRONTMATTER_KEYS.has(key) || isForbiddenKey(key)) continue;
    if (key === 'tags') {
      const tags = normalizeTags(Array.isArray(val) ? val : val != null ? [String(val)] : []);
      if (tags.length) out.tags = tags.slice(0, 32);
      continue;
    }
    if (key === 'entity') {
      if (Array.isArray(val)) {
        const ents = val.map((x) => normalizeSlug(String(x))).filter(Boolean).slice(0, 32);
        if (ents.length) out.entity = ents.length === 1 ? ents[0] : ents;
      } else if (val != null && String(val).trim()) {
        const e = normalizeSlug(String(val));
        if (e) out.entity = e;
      }
      continue;
    }
    if (key === 'project' || key === 'causal_chain_id' || key === 'episode_id') {
      const s = normalizeSlug(String(val ?? ''));
      if (s) out[key] = s;
      continue;
    }
    if (key === 'follows' || key === 'summarizes') {
      if (Array.isArray(val)) {
        const paths = [];
        for (const p of val) {
          const ps = String(p).trim();
          if (isSafeVaultPathLike(ps)) paths.push(ps.replace(/\\/g, '/'));
        }
        if (paths.length) out[key] = paths.length === 1 ? paths[0] : paths.slice(0, 32);
      } else if (val != null) {
        const ps = String(val).trim();
        if (isSafeVaultPathLike(ps)) out[key] = ps.replace(/\\/g, '/');
      }
      continue;
    }
    if (key === 'state_snapshot') {
      if (val === true || val === false) out.state_snapshot = val;
      else if (val === 'true' || val === 'false') out.state_snapshot = val === 'true';
      continue;
    }
    if (key === 'title') {
      const s = clampStr(String(val ?? ''), MAX_TITLE_CHARS);
      if (s) out.title = s;
      continue;
    }
    if (key === 'intent') {
      const s = clampStr(String(val ?? ''), MAX_INTENT_CHARS);
      if (s) out.intent = s;
      continue;
    }
    if (key === 'date' || key === 'updated' || key === 'source' || key === 'source_id' || key === 'summarizes_range') {
      const s = clampStr(String(val ?? ''), MAX_SCALAR_CHARS);
      if (s) out[key] = s;
    }
  }
  return out;
}

/**
 * Full pipeline after LLM returns raw text.
 * @param {string} rawText
 */
export function validateAndNormalizeEnrichResult(rawText) {
  const parsed = parseEnrichModelOutput(rawText);
  const suggested_labels = normalizeSuggestedLabels(parsed.suggested_labels);
  const suggested_frontmatter = validateAndNormalizeSuggestedFrontmatter(parsed.suggested_frontmatter);
  let jsonSize = 0;
  try {
    jsonSize = JSON.stringify(suggested_frontmatter).length;
  } catch (_) {
    jsonSize = MAX_JSON_OUTPUT_CHARS + 1;
  }
  let fm = suggested_frontmatter;
  if (jsonSize > MAX_JSON_OUTPUT_CHARS) {
    fm = {};
  }
  return {
    enrich_version: parsed.enrich_version,
    summary: parsed.summary,
    suggested_labels,
    suggested_frontmatter: fm,
    parseOk: parsed.parseOk,
  };
}

/**
 * Serialize normalized frontmatter for canister / API (bounded).
 * @param {Record<string, unknown>} fm
 */
export function serializeSuggestedFrontmatterJson(fm) {
  try {
    const s = JSON.stringify(fm == null ? {} : fm);
    if (s.length > MAX_JSON_OUTPUT_CHARS) return '{}';
    return s;
  } catch (_) {
    return '{}';
  }
}

export { MAX_JSON_OUTPUT_CHARS as ENRICH_SUGGESTED_FRONTMATTER_MAX_JSON_CHARS };
