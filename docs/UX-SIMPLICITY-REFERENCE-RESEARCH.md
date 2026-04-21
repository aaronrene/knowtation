# UX simplicity — reference patterns (generic names)

**Purpose:** Name **ecosystem patterns** without tying docs to specific third-party products. **Primary positioning** for Knowtation lives in [WHY-KNOWTATION.md](./WHY-KNOWTATION.md). **Implementation backlog:** [HUB-WIZARD-HOSTED-STORY.md](./HUB-WIZARD-HOSTED-STORY.md).

---

## Vocabulary

| Generic label | Plain English | Technical meaning |
|---------------|---------------|-------------------|
| **Tool-output compaction** | Shortens **terminal / command** output before the model reads it. | Post-execution **stdout/stderr** reduction, often **host hooks**, rule stacks. **Not** Knowtation’s core vault surface. |
| **Session-continuity memory** | Durable “where we left off” across chats, often via MCP bootstrap and checkpoints. | **MCP resources**, bootstrap flows, checkpoint writes. Knowtation’s answer: **vault + index + MCP** (+ optional **bootstrap resource** / **prime** line). |

---

## Non-goals

- **Do not** imply the **hosted canister** executes **local shell hooks** for compaction.
- **Do not** claim **exclusive** market uniqueness without proof; point to **repo-backed** features in [WHY-KNOWTATION.md](./WHY-KNOWTATION.md).

---

## Related

- [WHY-KNOWTATION.md](./WHY-KNOWTATION.md)  
- [AGENT-INTEGRATION.md](./AGENT-INTEGRATION.md)  
- [PARITY-MATRIX-HOSTED.md](./PARITY-MATRIX-HOSTED.md)
