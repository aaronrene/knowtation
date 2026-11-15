# Decision — Knowtation domain on Muse/MuseHub is a core platform goal

**Date:** 2026-11-13  
**Status:** accepted for planning and documentation in this repository  
**Owner:** Knowtation product owner  
**Scope:** product direction and roadmap language. This record does not authorize implementation, a runtime change, a network-gate flip, publication, or a review stamp.

## Decision

The Knowtation domain on Muse and MuseHub is a core platform goal. Semantic retrieval, persistent and semantic memory, identity through msign, and algorithm-free open-range threads are foundational parts of that goal. Standalone vault files and the shipped thin bridge remain the current usable product. They are interim boundaries while MuseHub matured. They are not a decision to drop the integrated design.

Local and offline use stays a required capability. A local read of an authorized vault does not require a remote MuseHub call. Hosted, companion, and encrypted modes keep their existing permission and custody rules.

## What stays true today

These statements describe shipped behavior documented before this decision. This decision does not rewrite them into claims that the domain already runs in production.

- The vault of Markdown files is the current canonical note store. Login, search, and ordinary writes work without Muse. Source: [MUSE-THIN-BRIDGE.md](../MUSE-THIN-BRIDGE.md), [AGENT-INTEGRATION.md](../AGENT-INTEGRATION.md) §4.
- The thin bridge is optional operator linkage: `external_ref` on approve and an admin read-only proxy. Source: [MUSE-THIN-BRIDGE.md](../MUSE-THIN-BRIDGE.md).
- The accepted synthetic semantic core (Phase B, recorded 2026-11-03) is a conformance baseline for note identity, raw bytes, title/tags/body, validate/snapshot/diff, and replay. It is not native Muse execution, real private merge, or production catalog recognition. Source: [KNOWTATION-DOMAIN-AND-IDENTITY-ROADMAP.md](../KNOWTATION-DOMAIN-AND-IDENTITY-ROADMAP.md).
- Knowtation remains the permission authority for vault reads and writes unless a later accepted amendment changes that. This decision is not that amendment.
- Scooling's frozen name for the social surface remains **algorithm-free open-range threads** (`SOCIAL-OPEN-RANGE`). This decision does not create a second thread system.

## What changes in the plans

Older wording that treats a full Knowtation Muse domain as optional, deferred until a partner asks, or outside the product path is historical description of the thin-bridge slice. From this date, those sentences must point here and at [KNOWTATION-MUSE-DOMAIN-CORE-PLAN.md](../KNOWTATION-MUSE-DOMAIN-CORE-PLAN.md). Completed thin-bridge work stays recorded as completed. Unavailable domain, semantic-memory, msign, and live open-range behavior stays planned or parked as the core plan's matrix says.

## Roles

| Party | Role |
| --- | --- |
| Knowtation | Canonical notes, permissions, memory events, retrieval indexes for authorized content, review, and the domain package Knowtation owns. |
| Muse | Domain objects, snapshots, branches, commits, and semantic diff/merge once the accepted native contract is implemented. A Muse package does not by itself provide an embedding service. |
| MuseHub | Collaboration, history hosting, distribution, and identity/attestation services under their own contracts. Hub v1 does not execute the external domain guest. |
| Scooling | Product order across the stack, the open-range thread experience, and identity-linking adapters. Scooling's board wins when the question is cross-repo product order. |
| Embedding or model provider | A separately configured local or consented remote service. Optional backends stay distinct from the required user outcome of authorized retrieval. |

## Unresolved choice, with one recommendation

Where a semantic index runs, and whether a server may embed end-to-end encrypted bytes, was not closed by the November 12 domain research.

**Recommendation:** run retrieval in the authorized Knowtation host that is already allowed to read the content (local process, or the hosted bridge for content that host is allowed to read). Store embeddings and derived indexes beside that host's index data, bound to source revision, model id, and audience. Store domain identity, semantic diff, and history in Muse. Do not treat MuseHub as an embedding service. Do not claim server-side semantic search over end-to-end encrypted content. Encrypted content stays searchable only where a key holder has decrypted it for that operation.

This recommendation lets the KD-P1 specification proceed. It is not an implementation authorization.
