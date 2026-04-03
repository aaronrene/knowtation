/**
 * Session summary generation: LLM-powered summarization of recent memory events
 * into a single session_summary event.
 *
 * Uses completeChat (OpenAI → Anthropic → Ollama fallback chain).
 */

import { createMemoryManager } from './memory.mjs';
import { completeChat } from './llm-complete.mjs';

const SYSTEM_PROMPT = `You are a session summarizer for a personal knowledge vault system called Knowtation. Given a log of recent agent/user activity events, produce a concise summary covering:
1. What was accomplished (searches, writes, exports, imports, index operations)
2. Key topics and queries explored
3. Decisions made or pending
4. Suggested next steps

Be concise and factual. Focus on actionable takeaways. Output plain text, no markdown headings.`;

/**
 * Generate a session summary from recent memory events and store it.
 * @param {object} config — loadConfig() result
 * @param {{ since?: string, limit?: number, maxTokens?: number, dryRun?: boolean }} [opts]
 * @returns {Promise<{ summary: string, event_count: number, id?: string, ts?: string }>}
 */
export async function generateSessionSummary(config, opts = {}) {
  const mm = createMemoryManager(config);
  const since = opts.since || new Date(Date.now() - 86_400_000).toISOString();
  const limit = opts.limit ?? 50;

  const events = mm.list({ since, limit });
  if (events.length === 0) {
    return { summary: 'No events to summarize.', event_count: 0 };
  }

  const eventLines = events.map((e) => {
    const summary = JSON.stringify(e.data).slice(0, 300);
    return `[${e.ts}] ${e.type}: ${summary}`;
  });

  const userPrompt = `Here are ${events.length} recent activity events from the knowledge vault:\n\n${eventLines.join('\n')}\n\nSummarize this session.`;

  const summary = await completeChat(config, {
    system: SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: opts.maxTokens ?? 512,
  });

  if (opts.dryRun) {
    return { summary, event_count: events.length };
  }

  const result = mm.store('session_summary', {
    summary_text: summary,
    event_count: events.length,
    since,
  });

  return { summary, event_count: events.length, id: result.id, ts: result.ts };
}
