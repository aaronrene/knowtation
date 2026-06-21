/**
 * Pure Flow projection generator (Phase 7A-11b).
 *
 * Renders canonical knowtation.flow/v0 + steps into knowtation.flow_projection/v0 artifacts.
 * Deterministic over (flow, steps, harness, PROJECTION_GENERATOR_VERSION); no I/O, no network.
 *
 * @see docs/FLOW-PROJECTION-GENERATOR-CONTRACT-7A-11.md §1
 */

import { createHash } from 'crypto';
import { parseSemver, compareSemver } from './flow-store.mjs';

export const PROJECTION_GENERATOR_VERSION = '1';
export const ACTIVE_HARNESSES = new Set(['cursor_rule', 'cli_runbook']);
export const RESERVED_HARNESSES = new Set(['cursor_skill', 'mcp_prompt']);
export const INERT_HARNESSES = new Set(['agent_bundle']);
export const MAX_RENDERED_BYTES = 65536;
export const GENERATED_MARKER_PREFIX = 'GENERATED FROM CANONICAL FLOW';

/** @typedef {'cursor_rule'|'cursor_skill'|'mcp_prompt'|'cli_runbook'|'agent_bundle'} Harness */

export const HARNESS_VALUES = /** @type {const} */ ([
  'cursor_rule',
  'cursor_skill',
  'mcp_prompt',
  'cli_runbook',
  'agent_bundle',
]);

/** @type {readonly string[]} */
const FLOW_PROJECTION_CLIENT_KEYS = [
  'schema',
  'flow_id',
  'flow_version',
  'harness',
  'rendered',
  'generated_from_canonical',
  'editable',
  'fidelity',
];

/**
 * @param {string} harness
 * @param {{ agentBundleEnabled?: boolean }} [options]
 * @returns {boolean}
 */
export function isHarnessActive(harness, options = {}) {
  if (ACTIVE_HARNESSES.has(harness)) return true;
  if (harness === 'agent_bundle' && options.agentBundleEnabled === true) return true;
  return false;
}

/**
 * @param {boolean} gateOn
 * @returns {boolean}
 */
export function isAgentBundleInert(gateOn) {
  return !gateOn;
}

/**
 * @param {string} flowId
 * @param {string} flowVersion
 * @returns {string}
 */
export function buildGeneratedMarker(flowId, flowVersion) {
  return `<!-- ${GENERATED_MARKER_PREFIX} ${flowId}@${flowVersion} (generator v${PROJECTION_GENERATOR_VERSION}) — DO NOT EDIT; regenerate via knowtation flow project -->`;
}

/**
 * @param {string} text
 * @returns {string}
 */
function escapeMarkdownData(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\r\n/g, '\n').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * @param {string} line
 * @returns {string}
 */
function yamlQuote(line) {
  const s = String(line).replace(/\r\n/g, '\n');
  if (/^[\w .,:/-]+$/.test(s) && !s.includes(':')) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * @param {{ kind: string, id: string }[]} refs
 * @returns {string}
 */
function formatHandleRefs(refs) {
  if (!Array.isArray(refs) || refs.length === 0) return '';
  return refs.map((r) => `${r.kind}:${r.id}`).join(', ');
}

/**
 * @param {object} step
 * @returns {string}
 */
function formatVerification(step) {
  const v = step.verification;
  if (!v || typeof v !== 'object') return '';
  const evidence = v.evidence_required === true ? 'yes' : 'no';
  return `${v.kind} — ${v.description} (evidence required: ${evidence})`;
}

/**
 * @param {object} step
 * @returns {string[]}
 */
function formatBoundaries(step) {
  if (!Array.isArray(step.boundaries)) return [];
  return step.boundaries.map((b) => `- ${escapeMarkdownData(b)}`);
}

/**
 * @param {object} step
 * @returns {string}
 */
function renderCursorRuleStep(step) {
  const lines = [
    `## Step ${step.ordinal}: ${escapeMarkdownData(step.owned_job)}`,
    '',
    `**Instruction:** ${escapeMarkdownData(step.instruction)}`,
    '',
    `**Trigger:** ${escapeMarkdownData(step.trigger)}`,
    '',
    '**Boundaries:**',
    ...formatBoundaries(step),
    '',
    `**Output shape:** ${escapeMarkdownData(step.output_shape)}`,
    '',
    `**Verification:** ${escapeMarkdownData(formatVerification(step))}`,
  ];
  const skillRefs = formatHandleRefs(step.skill_refs);
  if (skillRefs) {
    lines.push('', `**Skill refs:** ${escapeMarkdownData(skillRefs)}`);
  }
  return lines.join('\n');
}

/**
 * @param {object} step
 * @returns {string}
 */
/**
 * @param {object} step
 * @returns {object}
 */
function renderAgentBundleStep(step) {
  const skillRefs = Array.isArray(step.skill_refs)
    ? step.skill_refs
        .filter((r) => r && typeof r === 'object')
        .map((r) => ({
          kind: r.kind,
          id: typeof r.id === 'string' ? r.id : '',
        }))
        .filter((r) => r.id.length > 0)
    : [];
  return {
    step_id: step.step_id,
    ordinal: step.ordinal,
    owned_job: typeof step.owned_job === 'string' ? step.owned_job : '',
    instruction: typeof step.instruction === 'string' ? step.instruction : '',
    trigger: typeof step.trigger === 'string' ? step.trigger : '',
    when_not_to_run: typeof step.when_not_to_run === 'string' ? step.when_not_to_run : '',
    boundaries: Array.isArray(step.boundaries) ? step.boundaries.map(String) : [],
    output_shape: typeof step.output_shape === 'string' ? step.output_shape : '',
    verification:
      step.verification && typeof step.verification === 'object'
        ? {
            kind: step.verification.kind,
            evidence_required: step.verification.evidence_required === true,
            description:
              typeof step.verification.description === 'string' ? step.verification.description : '',
          }
        : { kind: 'human_review', evidence_required: true, description: '' },
    skill_refs: skillRefs,
  };
}

/**
 * @param {object} flow
 * @param {object[]} steps
 * @param {string[]} allowedTools
 * @returns {string}
 */
export function renderAgentBundle(flow, steps, allowedTools = []) {
  const ordered = [...steps].sort((a, b) => a.ordinal - b.ordinal);
  const marker = `GENERATED FROM CANONICAL FLOW ${flow.flow_id}@${flow.version} — DO NOT EDIT`;
  const bundle = {
    schema: 'knowtation.agent_bundle/v0',
    flow_id: flow.flow_id,
    flow_version: flow.version,
    title: flow.title ?? '',
    summary: flow.summary ?? '',
    scope: flow.scope,
    generated_marker: marker,
    grant_required: true,
    allowed_tools: [...allowedTools].sort(),
    steps: ordered.map(renderAgentBundleStep),
    fidelity: { dropped_fields: [], notes: null },
  };
  return JSON.stringify(bundle);
}

function renderCliRunbookStep(step) {
  const lines = [
    `## Step ${step.ordinal}`,
    '',
    `- **Owned job:** ${escapeMarkdownData(step.owned_job)}`,
    `- **Instruction:** ${escapeMarkdownData(step.instruction)}`,
    `- **Trigger:** ${escapeMarkdownData(step.trigger)}`,
  ];
  if (typeof step.when_not_to_run === 'string' && step.when_not_to_run.trim()) {
    lines.push(`- **When not to run:** ${escapeMarkdownData(step.when_not_to_run)}`);
  }
  const requires = formatHandleRefs(step.requires);
  if (requires) {
    lines.push(`- **Requires:** ${escapeMarkdownData(requires)}`);
  }
  if (Array.isArray(step.boundaries) && step.boundaries.length > 0) {
    lines.push('- **Boundaries:**');
    for (const b of step.boundaries) {
      lines.push(`  - ${escapeMarkdownData(b)}`);
    }
  }
  const skillRefs = formatHandleRefs(step.skill_refs);
  if (skillRefs) {
    lines.push(`- **Skill refs:** ${escapeMarkdownData(skillRefs)}`);
  }
  if (Array.isArray(step.inputs) && step.inputs.length > 0) {
    const inputs = step.inputs.map((i) => `${i.name} (from ${i.from})`).join(', ');
    lines.push(`- **Inputs:** ${escapeMarkdownData(inputs)}`);
  }
  if (Array.isArray(step.outputs) && step.outputs.length > 0) {
    const outputs = step.outputs.map((o) => `${o.name}:${o.type}`).join(', ');
    lines.push(`- **Outputs:** ${escapeMarkdownData(outputs)}`);
  }
  lines.push(
    `- **Output shape:** ${escapeMarkdownData(step.output_shape)}`,
    `- **Verification:** ${escapeMarkdownData(formatVerification(step))}`,
  );
  return lines.join('\n');
}

/**
 * @param {object} flow
 * @param {object[]} steps
 * @param {Harness} harness
 * @param {string} marker
 * @returns {{ rendered: string, truncated: boolean }}
 */
function buildRendered(flow, steps, harness, marker) {
  const ordered = [...steps].sort((a, b) => a.ordinal - b.ordinal);
  const parts = [];

  if (harness === 'cursor_rule') {
    const tags = Array.isArray(flow.tags) ? flow.tags : [];
    const globs = tags.length > 0 ? tags.map((t) => `**/*${t}*`).join(', ') : '**/*';
    parts.push(
      '---',
      `description: ${yamlQuote(flow.summary ?? flow.title ?? '')}`,
      `globs: ${yamlQuote(globs)}`,
      'alwaysApply: false',
      '---',
      '',
      marker,
      '',
    );
    for (const step of ordered) {
      parts.push(renderCursorRuleStep(step), '');
    }
  } else if (harness === 'cli_runbook') {
    parts.push(
      `# ${escapeMarkdownData(flow.title ?? flow.flow_id)}`,
      '',
      marker,
      '',
      escapeMarkdownData(flow.summary ?? ''),
      '',
    );
    for (const step of ordered) {
      parts.push(renderCliRunbookStep(step), '');
    }
  } else if (harness === 'agent_bundle') {
    return { rendered: renderAgentBundle(flow, ordered, []), truncated: false };
  }

  let rendered = parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
  if (!rendered.endsWith('\n')) rendered += '\n';

  let truncated = false;
  if (Buffer.byteLength(rendered, 'utf8') > MAX_RENDERED_BYTES) {
    truncated = true;
    const header =
      harness === 'cursor_rule'
        ? [
            '---',
            `description: ${yamlQuote(flow.summary ?? flow.title ?? '')}`,
            `globs: ${yamlQuote('**/*')}`,
            'alwaysApply: false',
            '---',
            '',
            marker,
            '',
          ].join('\n')
        : [
            `# ${escapeMarkdownData(flow.title ?? flow.flow_id)}`,
            '',
            marker,
            '',
            escapeMarkdownData(flow.summary ?? ''),
            '',
          ].join('\n');
    const chunks = [];
    let byteLen = Buffer.byteLength(`${header}\n`, 'utf8');
    for (const step of ordered) {
      const stepText =
        harness === 'cursor_rule'
          ? `${renderCursorRuleStep(step)}\n\n`
          : `${renderCliRunbookStep(step)}\n\n`;
      const stepBytes = Buffer.byteLength(stepText, 'utf8');
      if (byteLen + stepBytes > MAX_RENDERED_BYTES) {
        break;
      }
      chunks.push(stepText);
      byteLen += stepBytes;
    }
    rendered = `${header}${chunks.join('')}`.trimEnd();
    if (!rendered.endsWith('\n')) rendered += '\n';
  }

  return { rendered, truncated };
}

/**
 * @param {Harness} harness
 * @param {object} flow
 * @param {object[]} steps
 * @returns {{ dropped_fields: string[], notes?: string }}
 */
export function computeFidelity(harness, flow, steps) {
  if (harness === 'agent_bundle') {
    return { dropped_fields: [], notes: null };
  }

  void flow;
  const dropped = new Set();

  for (const step of steps) {
    if (harness === 'cursor_rule') {
      if (typeof step.when_not_to_run === 'string' && step.when_not_to_run.trim()) {
        dropped.add('when_not_to_run');
      }
      if (Array.isArray(step.requires) && step.requires.length > 0) {
        dropped.add('requires');
      }
      if (Array.isArray(step.inputs) && step.inputs.length > 0) {
        dropped.add('inputs');
      }
      if (Array.isArray(step.outputs) && step.outputs.length > 0) {
        dropped.add('outputs');
      }
    }
    if (step.verification?.evidence_required === true) {
      void 0;
    }
  }

  /** @type {{ dropped_fields: string[], notes?: string }} */
  const result = {
    dropped_fields: [...dropped].sort(),
  };

  if (harness === 'cursor_rule' && result.dropped_fields.includes('when_not_to_run')) {
    result.notes = 'cursor_rule has no anti-trigger slot';
  }

  return result;
}

/**
 * @param {object} flow
 * @param {object[]} steps
 * @param {{ harness: Harness, generatedAt?: string, truncatedNote?: boolean, allowedTools?: string[] }} options
 * @returns {object}
 */
export function projectFlow(flow, steps, options) {
  const harness = options.harness;
  const marker = buildGeneratedMarker(flow.flow_id, flow.version);
  let rendered;
  let truncated;
  if (harness === 'agent_bundle') {
    const allowed = Array.isArray(options.allowedTools) ? options.allowedTools : [];
    rendered = renderAgentBundle(flow, steps, allowed);
    truncated = Buffer.byteLength(rendered, 'utf8') > MAX_RENDERED_BYTES;
    if (truncated) {
      rendered = rendered.slice(0, MAX_RENDERED_BYTES);
    }
  } else {
    const built = buildRendered(flow, steps, harness, marker);
    rendered = built.rendered;
    truncated = built.truncated;
  }
  const fidelity = computeFidelity(harness, flow, steps);
  if (truncated) {
    fidelity.notes = fidelity.notes
      ? `${fidelity.notes}; rendered truncated at ${MAX_RENDERED_BYTES} bytes`
      : `rendered truncated at ${MAX_RENDERED_BYTES} bytes`;
  }

  return {
    schema: 'knowtation.flow_projection/v0',
    flow_id: flow.flow_id,
    flow_version: flow.version,
    harness,
    rendered,
    generated_from_canonical: true,
    editable: false,
    fidelity,
  };
}

/**
 * @param {string} rendered
 * @returns {string}
 */
export function renderedContentHash(rendered) {
  const digest = createHash('sha256').update(rendered, 'utf8').digest('hex');
  return `sha256:${digest}`;
}

/**
 * @param {string} projectionFlowVersion
 * @param {string} latestFlowVersion
 * @returns {boolean}
 */
export function isProjectionStale(projectionFlowVersion, latestFlowVersion) {
  const a = parseSemver(projectionFlowVersion);
  const b = parseSemver(latestFlowVersion);
  if (!a || !b) return true;
  return compareSemver(a, b) < 0;
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeMarkerForCompare(text) {
  return text.replace(
    /<!--\s*GENERATED FROM CANONICAL FLOW[\s\S]*?-->/g,
    '<!-- GENERATED_MARKER -->',
  );
}

/**
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
function hasGeneratedMarker(text) {
  return typeof text === 'string' && text.includes(GENERATED_MARKER_PREFIX);
}

/**
 * @param {string|null|undefined} onDiskRendered
 * @param {string} freshRendered
 * @returns {{ drift: boolean, reason: 'clean'|'edited'|'missing_marker'|'absent' }}
 */
export function detectDrift(onDiskRendered, freshRendered) {
  if (onDiskRendered === null || onDiskRendered === undefined || onDiskRendered === '') {
    return { drift: true, reason: 'absent' };
  }
  if (!hasGeneratedMarker(onDiskRendered)) {
    return { drift: true, reason: 'missing_marker' };
  }
  const diskNorm = normalizeMarkerForCompare(onDiskRendered);
  const freshNorm = normalizeMarkerForCompare(freshRendered);
  if (diskNorm === freshNorm) {
    return { drift: false, reason: 'clean' };
  }
  return { drift: true, reason: 'edited' };
}

/**
 * @param {object} projection
 * @returns {object}
 */
export function flowProjectionForClient(projection) {
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const key of FLOW_PROJECTION_CLIENT_KEYS) {
    if (key in projection) {
      out[key] = projection[key];
    }
  }
  return out;
}

/**
 * Default local derived-artifact path for CLI --out/--check.
 *
 * @param {string} flowId
 * @param {Harness} harness
 * @returns {string|null}
 */
export function defaultProjectionOutPath(flowId, harness) {
  const slug = flowId.replace(/^flow_/, '').replace(/_/g, '-');
  if (harness === 'cursor_rule') return `.cursor/rules/${slug}.mdc`;
  if (harness === 'cli_runbook') return 'AGENTS.md';
  return null;
}
