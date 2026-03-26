# Product decisions — hosted MVP, transcription, and billing focus

**Status:** Working agreement for positioning and COGS control. Aligns Hub copy and docs with [HOSTED-CREDITS-DESIGN.md](./HOSTED-CREDITS-DESIGN.md).

---

## 1. Transcription and import (hosted vs self-hosted)

| Surface | Transcription | Import story |
|---------|---------------|--------------|
| **Hosted (knowtation.store)** | **We do not operate** Whisper/transcription as a billed core feature for MVP. Users **transcribe elsewhere** (free or paid tools, meeting bots, ChatGPT/Claude, phone apps, agents) and **bring Markdown or exports** into Knowtation (`markdown`, ChatGPT/Claude/Mem0 paths, etc.). | **Markdown-first** for “I already have text.” **In-app import** for other formats ships when [HOSTED-IMPORT-DESIGN.md](./HOSTED-IMPORT-DESIGN.md) is implemented on the bridge. |
| **Self-hosted** | **Audio:** User sets **`OPENAI_API_KEY`** on the machine running Hub; **`knowtation import audio`** and Hub **Audio (transcribe)** (same ~**25 MB** OpenAI limit per file). **Video:** Hub UI **coming soon**; **CLI** `knowtation import video` remains for power users, or strip audio / transcribe externally. | Full **`IMPORT_SOURCE_TYPES`** via CLI/MCP; Hub matches self-hosted when import is wired. |

**User-facing guidance:** “Transcribe anywhere, save as Markdown (or use our export importers); Knowtation is where it becomes **searchable, structured, agent-ready**.”

**Why:** Transcription is **commodity** and **high-variance cost**; **embeddings + index + search** are **differentiated** and **already metered** in our design.

---

## 2. Primary hosted COGS to monitor (cannot avoid)

For hosted semantic product quality, **re-index (embeddings)** and **search** are **essential**. They are also the **main variable API cost** (embedding provider + bridge CPU/storage).

- **`index`** — One job re-embeds the vault (or scoped notes); **largest per-action cost** in v0 pricing ([`COST_CENTS.index`](./HOSTED-CREDITS-DESIGN.md) placeholder **50¢** internal — **tune from shadow logs**).
- **`search`** — One query embedding + vector retrieval; **small per request** (placeholder **1¢**).
- **`note_write` / `proposal_write`** — Canister + storage; smaller than full re-index for typical use.

**Bundling vs strict per-use:** The existing model (**monthly included credits + rollover add-ons**, [HOSTED-CREDITS-DESIGN §1–2](./HOSTED-CREDITS-DESIGN.md)) is a good fit: users get a **pool**; heavy indexers spend more of the pool; light users subsidize variance less than pure à-la-carte confusion. You can still show **per-action prices** in Settings for transparency.

---

## 3. v0 subscription tiers (review — unchanged numbers)

From [HOSTED-CREDITS-DESIGN.md §2](./HOSTED-CREDITS-DESIGN.md):

| Tier | Price (USD/mo) | Included credits/mo |
|------|----------------|---------------------|
| **Free** | $0 | **3** |
| **Starter** | $19 | **12** |
| **Pro** | $39 | **30** |
| **Team** | $99 | **80** |

**1 credit = $1** against the internal price table (ledger in cents). **Add-on packs** ($10 / $25 / $50) roll over after monthly is used.

**Without hosted transcription:** Simpler operations table (no `import_transcribe` row); **lower tail risk** on surprise Whisper bills; tiers can stay **competitive** or **same price with more headroom** on included credits — product choice after shadow metering.

---

## 4. Monitoring without anxiety

1. **`BILLING_SHADOW_LOG=true`** on gateway — JSON lines per billable op; build histograms: searches/user/day, indexes/user/week.
2. **`GET /api/v1/billing/summary`** — Users see **what costs what**; reduces support (“why 402?”).
3. **Enforce** (`BILLING_ENFORCE`) only when **price table + caps** are validated against real embedding invoices.

---

## 5. Revision log

| Date | Decision |
|------|----------|
| 2026-03-26 | Hosted MVP: **no platform-run transcription**; external transcribe → Markdown/exports; self-hosted **audio** with user’s **OpenAI** key; **video** Hub **coming soon**, CLI optional; **primary meter: index + search** via existing credit tiers. |
