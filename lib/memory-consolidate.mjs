/**
 * Core consolidation engine: reads recent memory events, groups by topic,
 * sends each group to an LLM for deduplication/merging, and stores the result
 * as consolidation events. Phase A of the Daemon Consolidation Spec.
 *
 * This module is a pure function library with no daemon lifecycle logic.
 * It can be invoked manually via CLI or MCP.
 */

import { extractTopicFromEvent } from './memory-event.mjs';
import { createMemoryManager } from './memory.mjs';
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
 * Run the consolidation engine: read recent events, group by topic, call LLM,
 * store consolidation events, rebuild pointer index.
 *
 * @param {object} config — loadConfig() result
 * @param {{ dryRun?: boolean, passes?: number, lookbackHours?: number, maxEventsPerPass?: number, maxTopicsPerPass?: number, llmFn?: Function }} [opts]
 * @returns {Promise<{ topics: Array<{ topic: string, event_count: number, facts: string[], id?: string }>, total_events: number, dry_run: boolean }>}
 */
export async function consolidateMemory(config, opts = {}) {
  const daemonCfg = config.daemon || {};
  const dryRun = opts.dryRun ?? daemonCfg.dry_run ?? false;
  const lookbackHours = opts.lookbackHours ?? daemonCfg.lookback_hours ?? 24;
  const maxEventsPerPass = opts.maxEventsPerPass ?? daemonCfg.max_events_per_pass ?? 200;
  const maxTopicsPerPass = opts.maxTopicsPerPass ?? daemonCfg.max_topics_per_pass ?? 10;
  const maxTokens = daemonCfg.llm?.max_tokens ?? 1024;

  const llmFn = opts.llmFn || completeChat;

  const mm = createMemoryManager(config);
  const since = new Date(Date.now() - lookbackHours * 3_600_000).toISOString();
  const allEvents = mm.list({ since, limit: maxEventsPerPass });

  const nonConsolidationEvents = allEvents.filter(
    (e) => e.type !== 'consolidation' && e.type !== 'maintenance' && e.type !== 'insight',
  );

  if (nonConsolidationEvents.length === 0) {
    return { topics: [], total_events: 0, dry_run: dryRun };
  }

  const topicGroups = groupEventsByTopic(nonConsolidationEvents);

  const sortedTopics = [...topicGroups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, maxTopicsPerPass);

  const results = [];
  const passCount = opts.passes ?? 1;

  for (let pass = 0; pass < passCount; pass++) {
    for (const [topic, events] of sortedTopics) {
      if (events.length < 2 && passCount === 1) {
        continue;
      }

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

  if (!dryRun) {
    mm.generateIndex({ force: true });
  }

  return {
    topics: results,
    total_events: nonConsolidationEvents.length,
    dry_run: dryRun,
  };
}
