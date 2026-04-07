---
title: "ADR 001: Primary readout for cytokine pilot — ELISA vs bead multiplex"
project: research-lab-template
tags:
  - adr
  - decision
  - assay
date: 2026-04-07
---

# ADR 001: Primary readout for cytokine pilot — ELISA vs bead multiplex

## Status

Accepted (template example)

## Context

The cytokine secretion pilot needs a **quantitative primary endpoint** for six analytes across 48 conditions. Turnaround, cost, and dynamic range differ between plate ELISA and bead-based multiplex assays.

## Decision drivers

- Sample volume limited to **50 µL** per technical replicate.
- Need semi-high throughput within two weeks of cell treatment.
- Lab has existing plate reader but **no dedicated Luminex** on site.

## Options considered

1. **ELISA panels (six separate kits)** — gold-standard familiarity; high sample consumption; slower batching.
2. **Bead multiplex (outsourced or core facility)** — lower volume per analyte; dependency on core queue; higher per-sample fee.
3. **Mesoscale discovery (MSD)** — excellent sensitivity; overkill for pilot budget in this template scenario.

## Decision

Proceed with **bead multiplex via university core** for the pilot primary endpoint; retain **ELISA for confirmatory spot checks** on two highest-variance analytes.

## Consequences

Fits **volume and throughput**; downside is core **shipping/batching** delays—lock the sample manifest early. Revisit after the pilot if CV% or LOD miss the experiment plan.
