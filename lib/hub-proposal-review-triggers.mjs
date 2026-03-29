/**
 * Deterministic review triggers: phrases, path prefixes, labels → pending + queue metadata.
 * Override: data/hub_proposal_review_triggers.json (same shape as packaged default).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizePathPrefix, notePathMatchesPrefix } from './write.mjs';

// Netlify gateway bundle: import.meta.url may be missing at load time — never throw here.
function libDirname() {
  try {
    const u = typeof import.meta !== 'undefined' ? import.meta.url : '';
    if (u) return path.dirname(fileURLToPath(u));
  } catch (_) {}
  return path.join(process.cwd(), 'lib');
}

const __dirname = libDirname();
const PACKAGED_DEFAULT = path.join(__dirname, '..', 'hub', 'proposal-review-triggers-default.json');

const MAX_PHRASES = 200;
const MAX_PHRASE_LEN = 128;
const MAX_PREFIX_RULES = 64;
const MAX_LABEL_RULES = 64;

/**
 * @returns {{
 *   literal_phrases: { match: string, review_queue?: string, review_severity?: string }[],
 *   path_prefixes: { prefix: string, review_queue?: string, review_severity?: string }[],
 *   label_any: { labels: string[], review_queue?: string, review_severity?: string }[],
 * }}
 */
export function loadReviewTriggers(dataDir) {
  const overridePath = path.join(dataDir, 'hub_proposal_review_triggers.json');
  let raw;
  if (fs.existsSync(overridePath)) {
    try {
      raw = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    } catch {
      raw = null;
    }
  }
  if (!raw || typeof raw !== 'object') {
    try {
      raw = JSON.parse(fs.readFileSync(PACKAGED_DEFAULT, 'utf8'));
    } catch {
      raw = { literal_phrases: [], path_prefixes: [], label_any: [] };
    }
  }
  return normalizeTriggers(raw);
}

function normalizeTriggers(raw) {
  const literal_phrases = [];
  const arr = Array.isArray(raw.literal_phrases) ? raw.literal_phrases : [];
  for (const row of arr.slice(0, MAX_PHRASES)) {
    if (!row || typeof row !== 'object') continue;
    const m = typeof row.match === 'string' ? row.match.trim().slice(0, MAX_PHRASE_LEN) : '';
    if (!m) continue;
    literal_phrases.push({
      match: m,
      review_queue: normQueue(row.review_queue),
      review_severity: normSeverity(row.review_severity),
    });
  }
  const path_prefixes = [];
  const pfx = Array.isArray(raw.path_prefixes) ? raw.path_prefixes : [];
  for (const row of pfx.slice(0, MAX_PREFIX_RULES)) {
    if (!row || typeof row !== 'object') continue;
    const pr = typeof row.prefix === 'string' ? row.prefix.trim().replace(/\\/g, '/') : '';
    if (!pr) continue;
    let prefixNorm;
    try {
      prefixNorm = normalizePathPrefix(pr);
    } catch {
      continue;
    }
    path_prefixes.push({
      prefix: prefixNorm,
      review_queue: normQueue(row.review_queue),
      review_severity: normSeverity(row.review_severity),
    });
  }
  const label_any = [];
  const lab = Array.isArray(raw.label_any) ? raw.label_any : [];
  for (const row of lab.slice(0, MAX_LABEL_RULES)) {
    if (!row || typeof row !== 'object') continue;
    const labels = Array.isArray(row.labels)
      ? [...new Set(row.labels.map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, 32)
      : [];
    if (!labels.length) continue;
    label_any.push({
      labels,
      review_queue: normQueue(row.review_queue),
      review_severity: normSeverity(row.review_severity),
    });
  }
  return { literal_phrases, path_prefixes, label_any };
}

function normQueue(v) {
  if (v == null || typeof v !== 'string') return undefined;
  const s = v.trim().slice(0, 64);
  return s || undefined;
}

function normSeverity(v) {
  if (v === 'elevated' || v === 'standard') return v;
  return undefined;
}

/**
 * @param {ReturnType<typeof loadReviewTriggers>} triggers
 * @param {{ path: string, body: string, intent?: string, labels: string[] }} input
 * @returns {{ forcePending: boolean, review_queue?: string, review_severity?: 'standard'|'elevated', auto_flag_reasons: string[] }}
 */
export function applyReviewTriggers(triggers, input) {
  const reasons = [];
  let forcePending = false;
  /** @type {string|undefined} */
  let review_queue;
  /** @type {'standard'|'elevated'|undefined} */
  let review_severity;

  const pathNorm = String(input.path || '').replace(/\\/g, '/');
  const body = String(input.body || '');
  const intent = String(input.intent || '');
  const labelSet = new Set((input.labels || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean));
  const haystack = `${pathNorm}\n${body}\n${intent}`.toLowerCase();

  for (const rule of triggers.literal_phrases) {
    const needle = rule.match.toLowerCase();
    if (needle && haystack.includes(needle)) {
      forcePending = true;
      reasons.push(`phrase:${rule.match.slice(0, 48)}`);
      if (rule.review_queue) review_queue = rule.review_queue;
      if (rule.review_severity === 'elevated') review_severity = 'elevated';
      else if (rule.review_severity === 'standard' && review_severity !== 'elevated') review_severity = 'standard';
    }
  }

  for (const rule of triggers.path_prefixes) {
    if (notePathMatchesPrefix(pathNorm, rule.prefix)) {
      forcePending = true;
      reasons.push(`path_prefix:${rule.prefix}`);
      if (rule.review_queue) review_queue = rule.review_queue;
      if (rule.review_severity === 'elevated') review_severity = 'elevated';
      else if (rule.review_severity === 'standard' && review_severity !== 'elevated') review_severity = 'standard';
    }
  }

  for (const rule of triggers.label_any) {
    const hit = rule.labels.some((l) => labelSet.has(l));
    if (hit) {
      forcePending = true;
      reasons.push(`label_any:${rule.labels.join(',')}`);
      if (rule.review_queue) review_queue = rule.review_queue;
      if (rule.review_severity === 'elevated') review_severity = 'elevated';
      else if (rule.review_severity === 'standard' && review_severity !== 'elevated') review_severity = 'standard';
    }
  }

  return { forcePending, review_queue, review_severity, auto_flag_reasons: reasons };
}
