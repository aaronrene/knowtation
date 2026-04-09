# Canister auth contract

This document defines how the **gateway** (OAuth + proxy) and the **ICP canister** (vault + API) work together for hosted, decentralized Knowtation. The canister never talks to OAuth; the gateway does OAuth and sends a proof the canister trusts.

---

## 1. Roles

- **Gateway:** Runs OAuth (Google/GitHub). On successful login, creates a session and a stable **user id** (e.g. `google:123` or `github:456`). For every request to the canister, the gateway adds a **proof** that the canister can verify (see below). The gateway may also proxy API requests so the browser only talks to one origin.
- **Canister:** Stores vault and proposals. Validates the proof on every request; rejects if missing or invalid. Uses the proven **user id** to scope data (one user id = one vault in v1). The canister does **not** store OAuth tokens, passwords, or GitHub tokens.

---

## 2. Proof from gateway to canister

The gateway must send, with every canister request, something that uniquely identifies the authenticated user and cannot be forged. Two options:

### Option A — Header (trusted proxy)

- Gateway adds header: **`X-User-Id: <user_id>`**
- Canister trusts this header **only** when the request comes from a known gateway (e.g. same subnet or a shared secret in a second header). In production, the canister is only reachable via the gateway (no direct public access), so the gateway is the only one that can set `X-User-Id`.
- **Pros:** Simple. **Cons:** Canister must trust the network path or a shared secret.

### Option B — Signed token (recommended for public canister)

- Gateway holds a **private key**; canister holds the **public key** (or key id).
- After OAuth success, gateway creates a short-lived **signed token** (e.g. JWT or custom format) containing `user_id` and expiry, signed with the private key.
- Gateway sends this token in a header (e.g. **`Authorization: Bearer <signed_token>`** or **`X-Gateway-Token: <signed_token>`**).
- Canister verifies the signature with the public key and reads `user_id`; rejects if invalid or expired.
- **Pros:** Canister can be public; no trust in network. **Cons:** Key management and token format must be defined.

---

## 3. Contract (what the canister must do)

- On every authenticated request (list notes, get note, write note, delete note, proposals, etc.):
  1. Read the proof (header or token) from the request.
  2. Verify it (if Option B: verify signature and expiry).
  3. Extract **user_id**.
  4. Reject with **401** if proof is missing or invalid.
  5. Scope all vault and proposal operations to that **user_id** (e.g. storage keyed by user_id).

- The canister does **not**:
  - Call out to OAuth providers.
  - Store or validate Google/GitHub tokens.
  - Issue JWTs itself (unless we add a separate “auth canister” that the gateway calls; for the minimal design, the gateway issues the proof and the canister only verifies it).

---

## 4. Vault context (vault_id)

- For v1, one user id = one vault. Optional **vault_id** (header **`X-Vault-Id`** or query **`vault_id`**) can be passed through so that future multi-vault canisters can scope by (user_id, vault_id). The canister may ignore vault_id in v1 and treat it as a single vault per user.

---

## 5. Gateway implementation

- **hub/gateway/** — Node (Express) service: OAuth at `/auth/login`, `/auth/callback/google`, `/auth/callback/github`; issues JWT; proxies `/api/v1/*` to canister with **X-User-Id** from JWT. See [hub/gateway/README.md](../hub/gateway/README.md) for env and deploy.

## 6. Operator export key (ICP hub only)

- **Purpose:** Allow an **automated job** (CI or cron) to discover **all** `user_id` values and then call existing per-user HTTP routes (`/api/v1/export`, `/api/v1/proposals`, …) for a **full logical backup** without OAuth per user.
- **Mechanism:** Stable field `operator_export_secret` on the hub canister. **`GET /api/v1/operator/export`** requires header **`X-Operator-Export-Key`** equal to that value (length check then `==`). If unset, the endpoint returns **503**.
- **Bootstrap:** Controllers call **`admin_set_operator_export_secret`** via `dfx canister call` after deploy. Rotate by calling again with a new secret; update the same value in GitHub Actions / `.env` for the export job.
- **Security:** Treat the secret like a **database backup credential**. HTTPS only; encrypt artifacts (see [OPERATOR-BACKUP.md](./OPERATOR-BACKUP.md)). This is **not** an end-user feature and must not ship to browsers.

## 7. Reference

- [HUB-API.md](./HUB-API.md) — API contract the canister implements.
- [OPERATOR-BACKUP.md](./OPERATOR-BACKUP.md) — Snapshots + daily logical export.
- [hub/icp/README.md](../hub/icp/README.md) — ICP canister implementation and deploy.
- [hub/gateway/README.md](../hub/gateway/README.md) — Gateway env and routes.
- Plan: Canister-based hosted product (gateway OAuth + proof, canister validates).
