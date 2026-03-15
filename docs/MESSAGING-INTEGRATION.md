# Messaging integration: Slack, Discord, Telegram

This doc describes how to bring messages from Slack, Discord, Telegram (and similar) into your Knowtation vault so they appear in the Hub and can be searched.

---

## Contract

All integrations produce notes that follow the [CAPTURE-CONTRACT](CAPTURE-CONTRACT.md): vault-relative path, frontmatter with `source`, `date`, and optional `source_id`, `project`, `tags`. Notes go to `vault/inbox/` or `vault/projects/<project>/inbox/`.

---

## Option 1: Hub capture endpoint (recommended)

If the Knowtation Hub is running, use its capture endpoint so you don’t need a separate webhook server.

**Endpoint:** `POST /api/v1/capture`  
**Auth:** If `CAPTURE_WEBHOOK_SECRET` is set, send header `X-Webhook-Secret: <secret>`.

**Body (JSON):**

```json
{
  "body": "Message text or markdown",
  "source": "slack",
  "source_id": "msg-123",
  "project": "myproject",
  "tags": "meeting, decision"
}
```

| Field       | Required | Description |
|------------|----------|-------------|
| `body`     | Yes      | Message content (string). |
| `source`   | No       | Identifier (e.g. `slack`, `discord`, `telegram`). Default `webhook`. |
| `source_id`| No       | External id for deduplication. |
| `project`  | No       | Project slug; note goes to `projects/<project>/inbox/` when set. |
| `tags`     | No       | Comma-separated or array. |

**Example (curl):**

```bash
curl -X POST http://localhost:3333/api/v1/capture \
  -H "Content-Type: application/json" \
  -d '{"body": "Decided to ship on Friday", "source": "slack", "project": "product", "tags": "decision"}'
```

---

## Option 2: Standalone webhook server

Run the capture webhook script and point integrations at it:

```bash
node scripts/capture-webhook.mjs --port 3131
```

Then POST to `http://localhost:3131/capture` with the same JSON body as above. Use this when the Hub is not running or when you want capture on a different host/port.

---

## Slack

- **Slack Events API:** Subscribe to message events; Slack sends POSTs to your endpoint. Use `scripts/capture-slack-adapter.mjs` to receive those events, extract message text, and forward to the capture contract (Hub or standalone webhook).
- **Outgoing webhooks / Slash commands:** Configure Slack to POST to your adapter URL when a keyword is used or a command is run; the adapter normalizes the payload and calls capture.
- **Zapier / n8n:** Use a “Slack – New Message” trigger and an “HTTP – POST” action to send the message body to your Hub capture URL or webhook server. Map Slack channel/thread to `project` or `tags` if desired.

**Adapter:** `node scripts/capture-slack-adapter.mjs --port 3132`  
Listens for Slack event payloads; responds to `url_verification`; on `message` events, POSTs to `CAPTURE_URL` (default `http://localhost:3333/api/v1/capture`) or to the standalone webhook. Set `CAPTURE_URL` and optionally `CAPTURE_WEBHOOK_SECRET`, `SLACK_SIGNING_SECRET`.

---

## Discord

- **Discord webhooks / bot:** Have a bot or webhook receiver that gets message events. Use `scripts/capture-discord-adapter.mjs` to accept a simplified JSON payload (e.g. `content`, `id`, `channel_id`) and POST to the capture endpoint.
- **Zapier / n8n:** Trigger on “Discord – New Message” and POST to your capture URL with a body like `{"body": "<message content>", "source": "discord", "source_id": "<id>"}`.

**Adapter:** `node scripts/capture-discord-adapter.mjs --port 3133`  
Expects POST with JSON: `{ "content": "message text", "id?", "channel_id?", "project?", "tags?" }`. Forwards to `CAPTURE_URL`.

---

## Telegram

- **Telegram Bot API:** Use a bot that receives messages and forwards them to your capture endpoint. POST body: `{"body": "<message text>", "source": "telegram", "source_id": "<chat_id_message_id>", "project": "optional"}`.
- **Zapier / n8n:** “Telegram – New Message” → HTTP POST to Hub capture or webhook.

No dedicated adapter script is required; any small bot or workflow that can HTTP POST to `/api/v1/capture` or `/capture` with the contract above will work.

---

## Automation (Zapier, n8n, etc.)

1. **Trigger:** “New message” (or “New reaction”, “New file”) from Slack / Discord / Telegram / email.
2. **Action:** HTTP request – POST to `https://your-hub.example.com/api/v1/capture` (or your webhook URL).
3. **Body:** Map trigger output to `body`, and optionally `source`, `source_id`, `project`, `tags`.
4. **Auth:** If you use `CAPTURE_WEBHOOK_SECRET`, add header `X-Webhook-Secret`.

Your vault stays the source of truth; messages become searchable notes and appear in the Hub.
