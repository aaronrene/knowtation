/**
 * Core consolidation engine: reads recent memory events, groups by topic,
 * sends each group to an LLM for deduplication/merging, and stores the result
 * as consolidation events. Phase A of the Daemon Consolidation Spec.
 *
 * Phase C adds runVerifyPass (Pass 2: Stale Reference Detection).
 *
 * This module is a pure function library with no daemon lifecycle logic.
 * It can be invoked manually via CLI or MCP.
 */

import { extractTopicFromEvent } from './memory-event.mjs';
import { createMemoryManager, verifyMemoryEvent } from './memory.mjs';
import { completeChat } from './llm-complete.mjs';

const CONSOLIDATION_SYSTEM_PROMPT = `You are a memory consolidation engine for a personal knowledge vault.
You receive a batch of timestamped activity events on a single topic.
Your job:
1. Merge redundant observations into single factual statements.
2. When events contradict each other, keep the most recent fact and discard the older one.
3. Distill the batch into 3-7 concise, factual statements.
4. Each statement must be a complete, standalone fact (no "as mentioned earlier").
5. Preserve note paths and dates when they add context.

Output format: JSON array of strings, one per fact. No commentary.`;

/**
 * Build a user prompt for the consolidation LLM call from a topic group.
 * Exported for testing.
 *
 * @param {string} topic
 * @param {object[]} events
 * @returns {string}
 */
export function buildConsolidationPrompt(topic, events) {
  const lines = events.map((e) => {
    const summary = JSON.stringify(e.data).slice(0, 300);
    return `[${e.ts}] ${e.type}: ${summary}`;
  });
  return `Topic: "${topic}"\nEvents (${events.length}):\n${lines.join('\n')}`;
}

/**
 * Parse the LLM response into an array of fact strings.
 * Handles common quirks: markdown code fences, trailing text, invalid JSON.
 * Exported for testing.
 *
 * @param {string} raw — raw LLM output
 * @returns {string[]}
 */
export function parseConsolidationResponse(raw) {
  if (!raw || typeof raw !== 'string') return [];

  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === 'string' && item.trim()).map((s) => s.trim());
    }
    return [];
  } catch (_) {
    const lines = cleaned.split('\n')
      .map((l) => l.replace(/^[\s\-*\d.]+/, '').trim())
      .filter((l) => l.length > 0 && !l.startsWith('{') && !l.startsWith('['));
    return lines.length > 0 ? lines : [];
  }
}

/**
 * Group events by their extracted topic slug.
 * Exported for testing.
 *
 * @param {object[]} events
 * @returns {Map<string, object[]>}
 */
export function groupEventsByTopic(events) {
  const groups = new Map();
  for (const event of events) {
    const topic = extractTopicFromEvent(event);
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic).push(event);
  }
  return groups;
}

/**
 * Extract all unique path references from a memory event's data payload.
 *
 * Always extracts data.path (single path string).
 * When encrypt is false, also expands data.paths arrays for full coverage.
 * Exported for testing.
 *
 * @param {object} data — event.data
 * @param {boolean} [encrypt] — if true, skip data.paths (content is opaque)
 * @returns {string[]} unique, non-empty path strings
 */
export function extractPathsFromEventData(data, encrypt = false) {
  if (!data || typeof data !== 'object') return [];
  const seen = new Set();
  const paths = [];

  const add = (p) => {
    if (typeof p === 'string' && p.trim() && !seen.has(p)) {
      seen.add(p);
      paths.push(p);
    }
  };

  add(data.path);

  if (!encrypt && Array.isArray(data.paths)) {
    for (const p of data.paths) add(p);
  }

  return paths;
}

/**
 * Resolve the list of pass names to run from the caller's opts.passes value
 * and the daemon config.
 *
 * opts.passes may be:
 *   - string[]  — explicit pass names, e.g. ['consolidate', 'verify']
 *   - string    — comma-separated, e.g. 'consolidate,verify'
 *   - undefined/null — fall back to daemon config defaults
 *
 * @param {string[]|string|null|undefined} passesOpt
 * @param {object} [daemonPassesCfg] — daemon.passes section from config
 * @returns {string[]}
 */
export function resolvePassNames(passesOpt, daemonPassesCfg) {
  if (Array.isArray(passesOpt)) {
    return passesOpt.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof passesOpt === 'string') {
    return passesOpt.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const dp = daemonPassesCfg && typeof daemonPassesCfg === 'object' ? daemonPassesCfg : {};
  const names = [];
  if (dp.consolidate !== false) names.push('consolidate');
  if (dp.verify !== false) names.push('verify');
  return names;
}

/**
 * Run Pass 2: Stale Reference Detection.
 *
 * Scans the provided events for note path references, checks each path against
 * the vault filesystem, and writes a maintenance event summarising stale and
 * verified paths (unless dryRun: true). Reuses verifyMemoryEvent for all
 * per-path filesystem checks.
 *
 * Classification per path:
 *   'verified' — file exists and was not modified after the event timestamp
 *   'stale'    — file is missing or was modified after the event timestamp
 *   'no_ref'   — event has no path reference (not counted in checked_count)
 *
 * @param {object} config — loadConfig() result
 * @param {object[]} events — memory events to scan (already read by caller)
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {{ stale_paths: string[], verified_paths: string[], checked_count: number, dry_run: boolean }}
 */
export function runVerifyPass(config, events, opts = {}) {
  const dryRun = opts.dryRun ?? false;
  const encrypt = config.memory?.encrypt === true;

  const stalePaths = new Set();
  const verifiedPaths = new Set();
  let checked_count = 0;

  for (const event of events) {
    const paths = extractPathsFromEventData(event.data, encrypt);
    if (paths.length === 0) continue;

    checked_count++;

    for (const refPath of paths) {
      // Synthetic event: override data to isolate this path; force status 'success'
      // so verifyMemoryEvent performs the filesystem check rather than short-circuiting.
      const syntheticEvent = { ...event, status: 'success', data: { path: refPath } };
      const { confidence } = verifyMemoryEvent(config, syntheticEvent);

      if (confidence === 'stale') {
        stalePaths.add(refPath);
      } else if (confidence === 'verified') {
        verifiedPaths.add(refPath);
      }
      // 'hint' (no vault_path configured, or filesystem error) — skip; cannot classify
    }
  }

  const stale_paths = [...stalePaths];
  const verified_paths = [...verifiedPaths];

  if (!dryRun) {
    const mm = createMemoryManager(config);
    mm.store('maintenance', { stale_paths, verified_paths, checked_count });
  }

  return { stale_paths, verified_paths, checked_count, dry_run: dryRun };
}

/**
 * Run the consolidation engine: read recent events, optionally group by topic
 * and call LLM (consolidate pass), optionally detect stale path references
 * (verify pass), store results, and rebuild the pointer index.
 *
 * opts.passes controls which passes run:
 *   - undefined/null      → use daemon config (consolidate + verify by default)
 *   - string[]            → explicit list, e.g. ['consolidate', 'verify']
 *   - comma-string        → e.g. 'consolidate,verify'
 *
 * @param {object} config — loadConfig() result
 * @param {{ dryRun?: boolean, passes?: string[]|string, lookbackHours?: number, maxEventsPerPass?: number, maxTopicsPerPass?: number, llmFn?: Function }} [opts]
 * @returns {Promise<{ topics: Array<{ topic: string, event_count: number, facts: string[], id?: string }>, total_events: number, dry_run: boolean, verify: object|null }>}
 */
export async function consolidateMemory(config, opts = {}) {
  const daemonCfg = config.daemon || {};
  const dryRun = opts.dryRun ?? daemonCfg.dry_run ?? false;
  const lookbackHours = opts.lookbackHours ?? daemonCfg.lookback_hours ?? 24;
  const maxEventsPerPass = opts.maxEventsPerPass ?? daemonCfg.max_events_per_pass ?? 200;
  const maxTopicsPerPass = opts.maxTopicsPerPass ?? daemonCfg.max_topics_per_pass ?? 10;
  const maxTokens = daemonCfg.llm?.max_tokens ?? 1024;

  const llmFn = opts.llmFn || completeChat;

  const passNames = resolvePassNames(opts.passes, daemonCfg.passes);
  const runConsolidate = passNames.includes('consolidate');
  const runVerify = passNames.includes('verify');

  const mm = createMemoryManager(config);
  const since = new Date(Date.now() - lookbackHours * 3_600_000).toISOString();
  const allEvents = mm.list({ since, limit: maxEventsPerPass });

  const nonConsolidationEvents = allEvents.filter(
    (e) => e.type !== 'consolidation' && e.type !== 'maintenance' && e.type !== 'insight',
  );

  if (nonConsolidationEvents.length === 0) {
    return { topics: [], total_events: 0, dry_run: dryRun, verify: null };
  }

  const results = [];

  if (runConsolidate) {
    const topicGroups = groupEventsByTopic(nonConsolidationEvents);

    const sortedTopics = [...topicGroups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, maxTopicsPerPass);

    for (const [topic, events] of sortedTopics) {
      if (events.length < 2) continue;

      const userPrompt = buildConsolidationPrompt(topic, events);

      if (dryRun) {
        results.push({
          topic,
          event_count: events.length,
          facts: [],
          dry_run_estimate: `${Math.min(events.length, 7)} facts`,
        });
        continue;
      }

      let facts;
      try {
        const rawResponse = await llmFn(config, {
          system: CONSOLIDATION_SYSTEM_PROMPT,
          user: userPrompt,
          maxTokens,
        });
        facts = parseConsolidationResponse(rawResponse);
      } catch (err) {
        results.push({
          topic,
          event_count: events.length,
          facts: [],
          error: err.message || String(err),
        });
        continue;
      }

      if (facts.length === 0) {
        results.push({
          topic,
          event_count: events.length,
          facts: [],
          error: 'LLM returned no parseable facts',
        });
        continue;
      }

      const timestamps = events.map((e) => e.ts).sort();
      const consolidationData = {
        topic,
        facts,
        event_count: events.length,
        since: timestamps[0],
        until: timestamps[timestamps.length - 1],
      };

      const stored = mm.store('consolidation', consolidationData);
      results.push({
        topic,
        event_count: events.length,
        facts,
        id: stored.id,
      });
    }
  }

  let verifyResult = null;
  if (runVerify) {
    verifyResult = runVerifyPass(config, nonConsolidationEvents, { dryRun });
  }

  if (!dryRun) {
    mm.generateIndex({ force: true });
  }

  return {
    topics: results,
    total_events: nonConsolidationEvents.length,
    dry_run: dryRun,
    verify: verifyResult,
  };
}
