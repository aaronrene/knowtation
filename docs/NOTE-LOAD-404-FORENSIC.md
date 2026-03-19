# Note load 404 — forensic audit and what to check

When the Hub list shows a note but clicking it shows "Error: Not found", the 404 comes from the API chain. This doc summarizes the architecture, what we've tried, and what you must verify (no assumptions).

---

## 1. Architecture (facts)

| Component | Host | Role |
|-----------|------|------|
| **Hub UI** | 4Everland at knowtation.store | Serves `web/` (landing + `/hub/`). `config.js` sets `HUB_API_BASE_URL = 'https://knowtation-gateway.netlify.app'`. |
| **Gateway** | Netlify (knowtation-gateway.netlify.app) | OAuth + proxy. Receives e.g. `GET /api/v1/notes/inbox%2Fnote-hello-world.md`, forwards to canister with same path. |
| **Canister** | ICP | Stores notes per user. GET single note: receives path, decodes %2F → `/`, trims trailing slash, looks up in vault. |

Request flow: **Browser** → `GET knowtation-gateway.netlify.app/api/v1/notes/inbox%2Fnote-hello-world.md` (with `Authorization`) → **Gateway** → `fetch(CANISTER_URL + path)` → **Canister** → `pathOnly(url)` → `parsePath` → `pathArg` (e.g. `inbox%2F...` or `inbox/...`) → `decodePercentEncoded` → `pathNormalized` (trim trailing `/`) → `vault.get(pathNormalized)` or fallback `vault.get(pathArg)` → 200 + body or 404.

---

## 2. What we’ve tried (in repo)

1. **Canister:** Percent-decode path before lookup (`decodePercentEncoded`) so `inbox%2Fnote.md` matches stored key `inbox/note.md`.
2. **Canister:** Trim trailing slash so `inbox/note.md/` matches `inbox/note.md`.
3. **Canister:** If `vault.get(pathNormalized)` is null, try `vault.get(pathArg)` (gateway sometimes sends already-decoded path).
4. **Gateway:** Forward **raw** path to canister (no `new URL().pathname`), so %2F is preserved and canister is the single place that decodes.
5. **Gateway:** Log when canister returns 4xx on GET note (Netlify function logs show `[gateway] canister GET note: 404 url: ...`).

---

## 3. What must be deployed for the fix to work

- **Netlify (gateway):** Must run the code that (a) forwards raw path and (b) logs 4xx. Merge + Netlify build from main.
- **Canister (ICP):** Must run the code that decodes path, trims trailing slash, and has fallback lookup. **If the canister was not redeployed after the merge, it still does `vault.get("inbox%2Fnote-hello-world.md")` and returns 404** because the key is stored as `inbox/note-hello-world.md`.
- **4Everland (Hub UI):** Not required for the 404 fix. Only needed for UI changes (e.g. modal close, config). The request URL is built in `hub.js` and is already correct (`encodeURIComponent(path)`).

So: **Redeploy the canister** (e.g. `dfx deploy --network ic` or your CI that deploys the hub canister). Netlify “succeeded” only means the gateway has the new code; the canister is a separate deployment.

---

## 4. Logs to check

1. **Browser (DevTools → Network):**  
   Request: `GET https://knowtation-gateway.netlify.app/api/v1/notes/inbox%2Fnote-hello-world.md`  
   Response: 404, body `{"error":"Not found","code":"NOT_FOUND"}`.  
   Confirms the request reaches the gateway and the gateway returns 404 (from canister).

2. **Netlify (Function logs):**  
   After the next deploy, when you reproduce the 404, open Netlify → knowtation-gateway → Functions → gateway → Logs. Look for:  
   `[gateway] canister GET note: 404 url: https://...ic0.app/api/v1/notes/inbox%2F...`  
   That confirms (a) the path we send to the canister (encoded vs decoded) and (b) that the canister returned 404.

3. **Canister (optional):**  
   If you can redeploy the canister with a temporary change: in the 404 branch, include in the JSON body a debug field with the path we tried (e.g. `pathDecoded`). Then you see exactly what key was used for lookup. Remove after verification.

---

## 5. Other angles (if 404 persists after canister redeploy)

- **User vault:** List and get both use the same JWT and gateway → same `x-user-id` → same canister vault. If you had two tabs (different accounts), list could be from user A and get from user B.
- **Key at create:** Note is stored under the path from the POST body when you clicked Create. If the path field had a typo or different casing at create time, the key would differ.
- **Double encoding:** If the path ever reached the canister as `inbox%252F...`, one decode would yield `inbox%2F...` and we’d look up that; no match. Your console showed single encoding (`inbox%2F`), so this is unlikely.

---

## 6. Summary

| Check | Action |
|-------|--------|
| Canister redeployed? | Deploy hub canister to ICP with latest code (decode + trim + fallback). |
| Gateway redeployed? | Netlify build from main (raw path + logging). |
| 4Everland | Optional for this fix; redeploy if you want latest UI. |
| Netlify function logs | Reproduce 404, then check logs for `[gateway] canister GET note: 404 url: ...`. |
| Browser Network | Confirm request URL and 404 response. |

The most likely cause of a persistent 404 after “deployments succeeded” is that **only the gateway (Netlify) was redeployed and the canister on ICP was not**.
