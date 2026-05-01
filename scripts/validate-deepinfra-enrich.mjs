#!/usr/bin/env node
/**
 * DeepInfra Enrich validation harness.
 *
 * Purpose: before flipping the hosted Hub gateway from OpenAI to DeepInfra,
 * verify that the chosen DeepInfra chat model returns JSON that
 * `validateAndNormalizeEnrichResult` can parse for a representative spread
 * of proposal-shaped inputs. Fail fast (exit 1) if any sample fails to parse,
 * since downstream the canister will store empty `suggested_frontmatter` JSON
 * and reviewers lose the metadata-suggestion benefit.
 *
 * Usage (Track A — flip explicit provider):
 *
 *   DEEPINFRA_API_KEY=di-...\
 *   KNOWTATION_CHAT_PROVIDER=deepinfra \
 *   DEEPINFRA_CHAT_MODEL=Qwen/Qwen2.5-72B-Instruct \
 *   node scripts/validate-deepinfra-enrich.mjs
 *
 * Usage (Track B — control: re-run against current OpenAI to compare):
 *
 *   OPENAI_API_KEY=sk-...\
 *   KNOWTATION_CHAT_PROVIDER=openai \
 *   node scripts/validate-deepinfra-enrich.mjs
 *
 * Exit code 0 = all samples passed; 1 = at least one failed to parse or
 * produced fields outside the SPEC §2 allow-list.
 *
 * Privacy: each sample body below is synthetic. No vault data is sent.
 * If you want to stress-test against real proposal bodies, pass
 *   --vault-sample <path-to-md> [--vault-sample <path>...]
 * (paths are read with fs.readFileSync — they never leave your machine until
 * the LLM call goes out, which you have already approved by setting the API key).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeChat } from '../lib/llm-complete.mjs';
import {
  buildEnrichMessages,
  validateAndNormalizeEnrichResult,
  SUGGESTED_FRONTMATTER_KEYS,
} from '../lib/proposal-enrich-llm.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {Array<{ label: string, input: { path: string, intent: string, body: string } }>} */
const SAMPLES = [
  {
    label: 'short-paragraph',
    input: {
      path: 'projects/example/inbox/quick-thought.md',
      intent: 'capture a quick observation about onboarding friction',
      body:
        'Users on the trial plan are dropping off after the first invite step. ' +
        'It seems related to the email confirmation delay. We should add a resend button.',
    },
  },
  {
    label: 'long-technical',
    input: {
      path: 'projects/example/research/auth-rotation-2026-04.md',
      intent: 'research note on JWT rotation strategy',
      body: [
        '# JWT rotation review',
        '',
        '## Background',
        'Hosted Hub currently issues 24h JWTs (HUB_JWT_EXPIRY default). Rotation is manual.',
        '',
        '## Options considered',
        '1. Sliding 7d refresh token + 1h access token (industry standard).',
        '2. Stateless 24h JWT with mandatory client re-login (current).',
        '3. Server-side revocation list (cost: cache miss + DB hit).',
        '',
        '## Decision',
        'Move to option 1 in Q3 2026. Track in causal-chain `auth-rotation-2026`.',
        '',
        '## Risks',
        '- Refresh-token theft via XSS (mitigate with httpOnly cookies).',
        '- Logout requires server-side denylist (1h TTL bounded).',
      ].join('\n'),
    },
  },
  {
    label: 'with-project-frontmatter-wording',
    input: {
      path: 'projects/born-free/outlines/landing-hero-2026-05.md',
      intent: 'outline for the May 2026 landing hero refresh',
      body:
        'Project: Born Free. Audience: families and adventurers who want community-owned property access. ' +
        'Hero CTA: claim Experience Key with code BORNFREE100. Tone: warm, partner-focused, never paid-influencer.',
    },
  },
  {
    label: 'bulleted-only',
    input: {
      path: 'projects/example/playbooks/launch-checklist.md',
      intent: 'pre-launch operational checklist',
      body: [
        '- Confirm DEEPINFRA_API_KEY rotated in Netlify',
        '- Run Enrich validation harness (this script)',
        '- Smoke test create proposal in staging',
        '- Watch error rate dashboard for 1h',
        '- If ok, flip production env vars',
      ].join('\n'),
    },
  },
  {
    label: 'code-blocks',
    input: {
      path: 'projects/knowtation/research/embedding-dim-table.md',
      intent: 'reference for embedding dimensions per provider',
      body: [
        'Common embedding dimensions:',
        '',
        '```',
        'openai/text-embedding-3-small  1536',
        'openai/text-embedding-3-large  3072',
        'voyage/voyage-4-lite           1024',
        'deepinfra/bge-large-en-v1.5    1024',
        'deepinfra/Qwen3-Embedding-8B   4096',
        '```',
      ].join('\n'),
    },
  },
  {
    label: 'date-references',
    input: {
      path: 'projects/example/decisions/2026-04-15-llm-provider.md',
      intent: 'decision record for switching chat provider',
      body:
        'On 2026-04-15 we decided to flip hosted Hub chat from OpenAI to DeepInfra. ' +
        'Effective date: 2026-05-01 after staging validation. Updated: 2026-04-30. ' +
        'Source: docs/NEXT-SESSION-HUB-LLM-COST-ROUTING.md.',
    },
  },
  {
    label: 'named-entities',
    input: {
      path: 'projects/born-free/research/competitive-snapshot-2026-04.md',
      intent: 'competitive snapshot of community-owned travel platforms',
      body:
        'Competitors: Kibbo (community RV access), Inspirato (luxury subscription), DAOhaus governance template. ' +
        'Differentiators for Born Free: credits renew for life, DAO governance, member NFT, partner not promoter.',
    },
  },
  {
    label: 'causal-chain',
    input: {
      path: 'projects/example/incidents/2026-04-22-hint-timeout.md',
      intent: 'post-mortem for review-hints timeout incident',
      body:
        'Incident chain `hosted-hint-timeout-2026-q2` follows from earlier note ' +
        'projects/example/incidents/2026-04-10-canister-cold-start.md. ' +
        'Root cause: extra canister GET inside the 18s race. Fixed by merging client body into the hints job.',
    },
  },
  {
    label: 'edge-empty-intent',
    input: {
      path: 'projects/example/inbox/random.md',
      intent: '',
      body: 'one line note',
    },
  },
  {
    label: 'structured-table',
    input: {
      path: 'projects/example/research/provider-cost-2026-04.md',
      intent: 'cost comparison table',
      body: [
        '| Provider  | Chat (per 1M tok) | Embed (per 1M tok) |',
        '|-----------|-------------------|---------------------|',
        '| OpenAI    | 0.15              | 0.02                |',
        '| DeepInfra | 0.05              | 0.005               |',
        '| Voyage    | n/a               | 0.05                |',
      ].join('\n'),
    },
  },
];

/**
 * Optional: append samples loaded from real .md files (paths via --vault-sample).
 * Body becomes the file content; path/intent come from filename and `intent:` line if present.
 */
function loadVaultSamples(filePaths) {
  const out = [];
  for (const p of filePaths) {
    let body = '';
    try {
      body = fs.readFileSync(p, 'utf8');
    } catch (e) {
      console.error(`[skip] cannot read ${p}: ${e.message}`);
      continue;
    }
    const intentMatch = body.match(/^intent:\s*(.+)$/m);
    out.push({
      label: `vault:${path.basename(p)}`,
      input: {
        path: p.replace(/^.*?\/vault\//, 'vault/'),
        intent: intentMatch ? intentMatch[1].trim() : 'imported vault sample',
        body,
      },
    });
  }
  return out;
}

function parseArgs(argv) {
  const out = { vaultSamples: [], passThreshold: 10 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--vault-sample' && argv[i + 1]) {
      out.vaultSamples.push(argv[++i]);
    } else if (argv[i] === '--pass-threshold' && argv[i + 1]) {
      out.passThreshold = parseInt(argv[++i], 10) || 10;
    }
  }
  return out;
}

function summarizeFrontmatterKeys(fm) {
  if (!fm || typeof fm !== 'object') return [];
  return Object.keys(fm).sort();
}

function isSubsetOfAllowList(fm) {
  if (!fm || typeof fm !== 'object') return true;
  for (const k of Object.keys(fm)) {
    if (!SUGGESTED_FRONTMATTER_KEYS.has(k)) return false;
  }
  return true;
}

async function runOne(sample) {
  const { system, user } = buildEnrichMessages(sample.input);
  const t0 = Date.now();
  let raw;
  try {
    raw = await completeChat(
      { llm: {} },
      { system, user, maxTokens: 800 },
    );
  } catch (e) {
    return {
      label: sample.label,
      ok: false,
      reason: `LLM call failed: ${e.message || String(e)}`,
      ms: Date.now() - t0,
    };
  }
  const ms = Date.now() - t0;
  const result = validateAndNormalizeEnrichResult(raw);
  const allowListOk = isSubsetOfAllowList(result.suggested_frontmatter);
  const summaryOk = typeof result.summary === 'string' && result.summary.trim().length > 0;
  const ok = result.parseOk && allowListOk && summaryOk;
  return {
    label: sample.label,
    ok,
    parseOk: result.parseOk,
    allowListOk,
    summaryOk,
    summaryLen: result.summary.length,
    labels: result.suggested_labels,
    fmKeys: summarizeFrontmatterKeys(result.suggested_frontmatter),
    ms,
    rawSnippet: raw.slice(0, 200),
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const samples = [...SAMPLES, ...loadVaultSamples(args.vaultSamples)];

  const provider = String(process.env.KNOWTATION_CHAT_PROVIDER || '').toLowerCase();
  const hasDeepinfra = Boolean(process.env.DEEPINFRA_API_KEY);
  const hasOpenai = Boolean(process.env.OPENAI_API_KEY);
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);

  console.log('--- DeepInfra Enrich validation harness ---');
  console.log(`KNOWTATION_CHAT_PROVIDER=${provider || '(unset)'}`);
  console.log(
    `Keys: deepinfra=${hasDeepinfra ? 'set' : '(unset)'} ` +
      `openai=${hasOpenai ? 'set' : '(unset)'} ` +
      `anthropic=${hasAnthropic ? 'set' : '(unset)'}`,
  );
  console.log(`DEEPINFRA_CHAT_MODEL=${process.env.DEEPINFRA_CHAT_MODEL || '(default Qwen/Qwen2.5-72B-Instruct)'}`);
  console.log(`Samples: ${samples.length} (built-in: ${SAMPLES.length}, vault: ${args.vaultSamples.length})`);
  console.log(`Pass threshold: ${args.passThreshold}/${samples.length}`);
  console.log('');

  if (!hasDeepinfra && !hasOpenai && !hasAnthropic) {
    console.error(
      'No LLM key set. Configure DEEPINFRA_API_KEY (recommended) or OPENAI_API_KEY/ANTHROPIC_API_KEY for a control run.',
    );
    process.exit(2);
  }

  const results = [];
  for (const s of samples) {
    process.stdout.write(`[${s.label}] ... `);
    const r = await runOne(s);
    results.push(r);
    if (r.ok) {
      console.log(
        `ok  parseOk=${r.parseOk} summaryLen=${r.summaryLen} labels=${r.labels.length} ` +
          `fmKeys=[${r.fmKeys.join(',')}] ${r.ms}ms`,
      );
    } else {
      console.log(`FAIL ${r.reason || ''}`);
      console.log(
        `      parseOk=${r.parseOk} allowListOk=${r.allowListOk} summaryOk=${r.summaryOk} ` +
          `fmKeys=[${(r.fmKeys || []).join(',')}] raw="${r.rawSnippet || ''}"`,
      );
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const total = results.length;
  console.log('');
  console.log(`--- ${passed}/${total} samples passed ---`);

  if (passed < args.passThreshold) {
    console.error(
      `FAIL: only ${passed}/${total} samples passed (threshold ${args.passThreshold}). ` +
        'Do NOT flip production yet. Try a stronger model (Qwen/Qwen2.5-72B-Instruct) ' +
        'or tighten the system prompt before promoting.',
    );
    process.exit(1);
  }
  console.log('PASS: production flip is safe for the tested model + prompt.');
  process.exit(0);
}

main().catch((e) => {
  console.error(`harness crashed: ${e.message || String(e)}`);
  process.exit(2);
});
