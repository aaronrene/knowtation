---
title: "Device — living room smart hub"
project: "home-automation"
tags:
  - devices
  - hub
  - zigbee
date: 2026-04-07
---

# Living room hub

| Field | Value |
| ----- | ----- |
| **Room** | Living room (TV console, ventilated) |
| **Brand / model** | ExampleCo Hub Pro **HUB-200** |
| **Role** | Zigbee coordinator + local automation runtime |
| **Protocol** | Zigbee 3.0; Matter bridge **enabled** (beta channel) |
| **IP (DHCP reservation)** | `192.168.1.50` |
| **MAC** | `AA:BB:CC:DD:EE:FF` |
| **Firmware** | `2.14.8` (channel: stable) |
| **Power** | USB-C PD 30W adapter (labeled “LR Hub”) |

## Radios and topology

- **Zigbee channel** 20; Wi-Fi AP on 5 GHz preferred for backhaul.
- ~**32** routed children; worst RSSI today: **-78 dBm** (hall motion).

## Change log

- **2026-04-07** — Documented baseline after Matter beta toggle.

**Backup** — Export hub config monthly; store encrypted copy outside this vault.
