/**
 * Muse commit pilot evidence validators (Phase 7A, Step 7A-14).
 *
 * Pure functions for seven-tier tests to assert the pilot artifacts meet the
 * acceptance bar without re-running Muse or the full shell driver.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/** Required paths under docs/evidence/7A-14 relative to the Knowtation repo root. */
export const MUSE_COMMIT_PILOT_EVIDENCE_REL = 'docs/evidence/7A-14';

/** Pilot workspace filenames (projections committed via Muse). */
export const PILOT_WORKSPACE_FILES = [
  'overseer.AGENTS.md',
  'overseer.cursor.mdc',
] ;

/** Artifact filenames captured by run-pilot.sh. */
export const PILOT_ARTIFACT_FILES = [
  'transcript.txt',
  'muse-sha-before.txt',
  'muse-sha-after.txt',
  'overseer.AGENTS.v0.1.0.md',
  'overseer.AGENTS.v0.2.0.md',
  'overseer.v0.1.0.mdc',
  'overseer.v0.2.0.mdc',
  'overseer.runbook.v1-to-v2.diff',
  'overseer.cursor.v1-to-v2.diff',
  'overseer.AGENTS.handedited.md',
];

const GENERATED_MARKER_RE =
  /^<!-- GENERATED FROM CANONICAL FLOW flow_overseer_handover@(\d+\.\d+\.\d+) \(generator v1\)/;

const SECRET_SCAN_RE = /\b(token|oauth|refresh_token|api_key|secret|password|bearer)\b/i;

/**
 * @param {string} repoRoot — absolute Knowtation repo root
 * @returns {{ ok: true } | { ok: false; missing: string[] }}
 */
export function assertPilotEvidencePathsExist(repoRoot) {
  const missing = [];
  const base = join(repoRoot, MUSE_COMMIT_PILOT_EVIDENCE_REL);
  for (const name of ['README.md', 'run-pilot.sh', ...PILOT_WORKSPACE_FILES.map((f) => `pilot-workspace/${f}`)]) {
    if (!existsSync(join(base, name))) {
      missing.push(join(MUSE_COMMIT_PILOT_EVIDENCE_REL, name));
    }
  }
  for (const name of PILOT_ARTIFACT_FILES) {
    if (!existsSync(join(base, 'artifacts', name))) {
      missing.push(join(MUSE_COMMIT_PILOT_EVIDENCE_REL, 'artifacts', name));
    }
  }
  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

/**
 * Parse the generated marker version from a projection file.
 *
 * @param {string} content
 * @returns {string | null}
 */
export function parseGeneratedMarkerVersion(content) {
  const firstLine = content.split('\n').find((line) => line.includes('GENERATED FROM CANONICAL FLOW'));
  if (!firstLine) return null;
  const match = firstLine.match(GENERATED_MARKER_RE);
  return match?.[1] ?? null;
}

/**
 * Assert anti-drift diff carries only marker version + one canonical content line change.
 *
 * @param {string} diffText — unified diff content
 * @returns {{ ok: true } | { ok: false; reason: string }}
 */
export function assertCleanAntiDriftDiff(diffText) {
  const changedLines = diffText
    .split('\n')
    .filter((line) => (line.startsWith('-') && !line.startsWith('---')) || (line.startsWith('+') && !line.startsWith('+++')));
  if (changedLines.length !== 4) {
    return { ok: false, reason: `expected 4 changed lines (2 pairs), got ${changedLines.length}` };
  }
  const minus = changedLines.filter((l) => l.startsWith('-'));
  const plus = changedLines.filter((l) => l.startsWith('+'));
  if (minus.length !== 2 || plus.length !== 2) {
    return { ok: false, reason: 'expected exactly 2 removals and 2 additions' };
  }
  const markerMinus = minus.find((l) => l.includes('GENERATED FROM CANONICAL FLOW'));
  const markerPlus = plus.find((l) => l.includes('GENERATED FROM CANONICAL FLOW'));
  if (!markerMinus || !markerPlus) {
    return { ok: false, reason: 'marker line must change (version bump only)' };
  }
  if (!markerMinus.includes('@0.1.0') || !markerPlus.includes('@0.2.0')) {
    return { ok: false, reason: 'marker must bump 0.1.0 → 0.2.0' };
  }
  return { ok: true };
}

/**
 * Scan rendered bytes for accidental secret leakage (contract §10 security bar).
 *
 * @param {string} content
 * @returns {{ ok: true } | { ok: false; matches: string[] }}
 */
export function assertNoSecretLeakageInProjection(content) {
  const lines = content.split('\n');
  const bad = [];
  for (const line of lines) {
    if (/no secrets/i.test(line)) continue;
    if (SECRET_SCAN_RE.test(line)) {
      bad.push(line.trim().slice(0, 120));
    }
  }
  return bad.length === 0 ? { ok: true } : { ok: false, matches: bad };
}

/**
 * Load pilot workspace projection and validate marker + version.
 *
 * @param {string} repoRoot
 * @param {string} filename
 * @param {string} expectedVersion
 */
export function loadAndValidatePilotProjection(repoRoot, filename, expectedVersion) {
  const path = join(repoRoot, MUSE_COMMIT_PILOT_EVIDENCE_REL, 'pilot-workspace', filename);
  const content = readFileSync(path, 'utf8');
  const version = parseGeneratedMarkerVersion(content);
  if (version !== expectedVersion) {
    throw new Error(`${filename}: expected marker @${expectedVersion}, got @${version}`);
  }
  const secretCheck = assertNoSecretLeakageInProjection(content);
  if (!secretCheck.ok) {
    throw new Error(`${filename}: secret scan failed: ${secretCheck.matches.join('; ')}`);
  }
  if (!content.includes('GENERATED FROM CANONICAL FLOW flow_overseer_handover@')) {
    throw new Error(`${filename}: missing generated marker`);
  }
  return content;
}