# Simple clarifications

Short, plain-language explanations of terms used in the spec and plan.

---

## “Capture/import as contracts” and “optional memory/AIR”

**Capture contract**  
A **contract** is a fixed set of rules that any “capture” plugin must follow. The rules are: write Markdown notes into a specific folder (e.g. `vault/inbox/` or `vault/projects/<project>/inbox/`), and put required fields in the note’s frontmatter (`source`, `date`, and optionally `source_id`, `project`, `tags`). We don’t care *how* the plugin gets the data (Slack, Telegram, JIRA, email, etc.) — we only care that the **output** matches this format. So “capture as contract” means: **any tool that writes notes in that way is a valid capture plugin**, without being built into the core.

**Import contract**  
Same idea for **import**: we define **what** the input can be (e.g. a ChatGPT export ZIP, a folder of Markdown files) and **what** the importer must produce (vault notes with our frontmatter, including `source`, `source_id`, `date`). Each import type (chatgpt-export, claude-export, markdown, audio, etc.) follows that contract. So “import as contract” means: **we specify the input and output rules; anyone can add a new import type** that obeys those rules.

**Optional memory/AIR**  
**Memory** (e.g. Mem0, SAME) and **AIR** (intent attestation) are **optional** features. The core tool works without them. If you enable them, the implementation calls a configurable “backend” (a service or library). So “optional memory/AIR” means: **the product doesn’t depend on them; they are add-ons** that can be turned on and wired to the backend you choose.

---

## “Implementation should keep backends behind a small abstraction”

**Backends** = the concrete services or libraries we use for: embedding (e.g. Ollama, OpenAI), vector store (e.g. Qdrant, sqlite-vec), and optionally memory and AIR.

**Small abstraction** = the core code does **not** call “Ollama” or “Qdrant” directly everywhere. Instead, it talks to a thin layer (e.g. “embedding provider”, “vector store”) that has a small, stable interface. The actual Ollama/Qdrant/etc. lives behind that interface.

**Why it matters**  
So we can **swap** backends without rewriting the whole app: add a new embedding provider or vector store by implementing that same small interface and wiring it in config. So “keep backends behind a small abstraction” means: **one narrow API in front of embedding/store/memory; plug in different implementations via config.**

---

## “Capture/import contracts already give ‘plug into any LLM or service’”

**Plug into any LLM**  
Knowtation doesn’t run the LLM. Agents (running on Cursor, Claude Code, or any environment that can run a CLI or MCP) **use** Knowtation to read and write the vault. So “any LLM” means: **whatever LLM powers the agent, the agent can still use the same Knowtation CLI or MCP** — we don’t tie the tool to one model or vendor.

**Plug into any service**  
**Capture** and **import** are defined by contracts (output format and, for import, input format). So: a “service” (Slack, JIRA, ChatGPT export, your own API) can feed data into Knowtation **by implementing the contract** (e.g. a script that turns Slack messages into vault inbox notes, or an importer that turns a ChatGPT export into vault notes). We don’t hard-code each service; we define the contract and **any service that can produce that format** plugs in. So “capture/import contracts give plug into any LLM or service” means: **the rules are fixed and open; any LLM-driven agent can use the CLI/MCP, and any external service can be a capture or import source by following the contract.**
