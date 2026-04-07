---
title: "Experiment log: qPCR standard curve — April sample run"
project: research-lab-template
tags:
  - experiment
  - qpcr
  - qc
date: 2026-04-07
---

# qPCR standard curve — April sample run

**Operator:** Template user | **Instrument:** qPCR-01 | **Kit lot:** DEMO-LOT-001

## Objective

Establish a **six-point standard curve** for housekeeping and target amplicons before running unknowns from the cytokine panel pilot.

## Setup

100 ng/µL RNA, **1:5** serial dilutions (six tubes); triplicate 10 µL reactions with ROX per manufacturer.

## Observations

Standards show **single melting peaks** (62°C anneal); NTCs undetermined at 40 cycles. Layout: standards cols 1–3; NTC col 4; unknowns from col 5 next run.

## Data (summary)

**Cq:** 1e0 mean **18.4** (SD 0.12); 1e-5 mean **35.1** (SD 0.21). Slope efficiency ≈ **98%** (target band 90–110%).

## Issues

- Well A7 showed high fluorescence before cycle 1—**excluded** as meniscus bubble; repeat if unknowns border that well.

## Next steps

Import Cq into the analysis notebook (link path in a child note); run unknowns on the **same master-mix lot**; append protocol with **30s** denature (beats 10s in our test).
