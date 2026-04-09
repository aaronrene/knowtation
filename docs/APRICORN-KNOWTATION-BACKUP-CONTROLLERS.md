# Knowtation + Apricorn: backup controllers (IC mainnet)

**Layman summary:** On the Internet Computer, a **controller** is an account (a **principal**) allowed to **upgrade or recover** a canister. Your **normal deploy key** already controls Knowtation’s canisters. This guide adds the **same three backup identities** you use for Born Free (`backup-controller-1` … `3`) so break-glass recovery does **not** depend on one laptop.

**This file is safe to commit** — it contains only **public canister IDs** and **command templates**. Do **not** commit **PEM files**, **seed phrases**, or paste **private** notes into the repo.

---

## Knowtation canisters (mainnet)

| Role | Canister ID |
|------|-------------|
| **Hub** (vault + proposals API) | `rsovz-byaaa-aaaaa-qgira-cai` |
| **Attestation** | `dejku-syaaa-aaaaa-qgy3q-cai` |

Source: `hub/icp/canister_ids.json`.

---

## Before you run commands

1. **Use the Knowtation deploy identity** — the `dfx` identity that **already** deployed these canisters (same one you use for `dfx deploy hub --network ic`). Replace `YOUR_KNOWTATION_DEPLOY_IDENTITY` below with that name (e.g. `default` or whatever you use).
2. **Backup identities must exist** on this Mac: `backup-controller-1`, `backup-controller-2`, `backup-controller-3` (you set these up for Born Free). **No new PEM exports** are required for Knowtation unless you **rotate** those identities.
3. **Network** is **`ic`** (mainnet), same as Born Free.

---

## Add backup controllers to both Knowtation canisters

Run from the repo (any directory is fine; `dfx` uses global identity + network):

```bash
dfx identity use YOUR_KNOWTATION_DEPLOY_IDENTITY

dfx canister --network ic update-settings rsovz-byaaa-aaaaa-qgira-cai \
  --add-controller backup-controller-1 \
  --add-controller backup-controller-2 \
  --add-controller backup-controller-3

dfx canister --network ic update-settings dejku-syaaa-aaaaa-qgy3q-cai \
  --add-controller backup-controller-1 \
  --add-controller backup-controller-2 \
  --add-controller backup-controller-3
```

If `dfx` prefers **principal strings** in your version, get them once per identity:

```bash
dfx identity use backup-controller-1 && dfx identity get-principal
# repeat for backup-controller-2 and backup-controller-3
```

Then pass those principals to `--add-controller` instead of the names (tool-dependent).

---

## Verify (controllers list)

```bash
dfx canister --network ic info rsovz-byaaa-aaaaa-qgira-cai
dfx canister --network ic info dejku-syaaa-aaaaa-qgy3q-cai
```

Confirm **Controllers** includes:

- Your **deploy** principal (Knowtation admin).
- The **same three** backup principals as on Born Free canisters (compare with `dfx canister info` on a Born Free canister you already updated).

**Jargon:** *Principal* = long text ID; *controller* = principal with admin rights on that canister.

---

## Apricorn (physical inventory)

**Simplest rule:** The Apricorn holds **encrypted copies of the backup PEMs** + a **plain README** listing **what** you protect (no secrets in the README).

1. **Unlock** Apricorn #1 and #2 (the two you have locally).
2. **Update** your existing Born Free–style README (plain `.txt`) to add two lines:

   - Knowtation **hub**: `rsovz-byaaa-aaaaa-qgira-cai`
   - Knowtation **attestation**: `dejku-syaaa-aaaaa-qgy3q-cai`

   Note that **backup-controller-1..3** are now controllers on these as well (same keys as Born Free).

3. **No new PEM files** for Knowtation if you did **not** rotate `backup-controller-*` — the same three PEMs already on the drive now govern **both** projects on-chain.

4. **Old unused canister** on the sheet: mark **RETIRED / do not use** or remove from the README so directors are not confused; optional on-chain cleanup is a separate decision.

---

## Remote Apricorn (#3 / colleague)

1. **On-chain first:** Ensure `backup-controller-3` is a controller on **Knowtation hub + attestation** (commands above) **before** relying on remote custody.
2. **PEM package for colleague** (only if you are **re-sending** or **rotating** `backup-controller-3`): use your existing process — export that identity only, `README-BACKUP-3.txt` listing **all** canister IDs that principal controls (Born Free + Knowtation), **7z** with **strong unique password**, share password **out of band** (Signal/phone), file via Drive if email blocks.

---

## What is *not* different for Knowtation vs Born Free

- Same **network** (`ic`).
- Same **backup identities** (reuse).
- No special **wallet** step for adding controllers — this is **`dfx canister update-settings`**, not token transfers.

## Optional follow-up in git

- Canister **Wasm** upgrades after Motoko changes: normal `dfx deploy` from `hub/icp` with your **deploy** identity; backup controllers do not replace day-to-day deploy.

---

## Related repo docs

- `docs/HOSTED-PLATFORM-BACKUP-ROADMAP.md` — custody philosophy (Apricorn pattern).
- `hub/icp/canister_ids.json` — authoritative IDs for this repo.
