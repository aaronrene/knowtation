---
title: "Literature review: Chen et al. 2025 — multiplex CRISPR screening in primary T cells"
project: research-lab-template
tags:
  - literature
  - crispr
  - immunology
date: 2026-04-07
---

# Chen et al. 2025 — multiplex CRISPR screening in primary T cells

**Citation (hypothetical for template):** Chen, L. et al. *Nat. Methods* (2025). DOI: `10.xxxx/nmeth.2025.xxx`

## One-line summary

The authors combine pooled CRISPR perturbations with single-cell RNA-seq in **ex vivo human T cells**, reporting improved guide detection sensitivity versus prior plate-based assays.

## Key findings

- Multiplexing **~120 guides** per donor while retaining >70% cell viability at 72h under their electroporation conditions.
- A computational demultiplexing step reduces doublet-induced false positives; code is available (check license before reuse).
- Validation with **orthogonal flow cytometry** on top hits matches directionality in four of five targets tested.

## Methods worth noting

- Electroporation parameters and media supplements are specified in supplementary tables—useful if we replicate stress controls.
- They normalize by non-targeting guides using a trimmed mean; may bias rare phenotypes.

## Relevance to our lab

Directly applicable if we pivot the **cytokine secretion screen** to primary cells. Our current immortalized line protocol will not transfer without revisiting viability curves and electroporation load.

## Open questions

- Donor batch effects: only six donors in main figures.
- Long-term culture effects on editing outcomes not addressed beyond 96h.

**Next step:** Pilot three guides from their positive control set in our hands before scaling the library.
