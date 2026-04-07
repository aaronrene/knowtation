---
title: "SOP — guest Wi-Fi setup"
project: "home-network"
tags:
  - household
  - wifi
  - sop
date: 2026-04-07
---

# Guest Wi-Fi setup (household SOP)

**Purpose** — Give visitors internet without sharing the main LAN or smart-device credentials.

## Prerequisites

- Router admin access (or mesh app) with **Guest network** enabled.
- QR code generator bookmarked (optional but saves time).

## Steps

1. Open router app → **Wi-Fi** → **Guest network**.
2. Set SSID to `GuestHouse` (or seasonal variant); **isolation from LAN** = **On**.
3. Password: rotate monthly; store current password in **password manager** shared vault “Household.”
4. **Bandwidth cap** (optional): 50 Mbps down / 10 Mbps up so streaming stays smooth for primary network.
5. Print or display QR: SSID + WPA3 if all guest devices support it; else WPA2 transition mode.

## After guests leave

- Toggle **guest Wi-Fi off** if no upcoming visitors.
- Revoke password if someone shared it publicly.

## Troubleshooting

- **“Connected, no internet”** — Renew DHCP lease; confirm upstream modem online.
- **IoT devices asking for guest** — Never; keep cameras and locks on **IoT VLAN** only.

Owner: **home-network** — review quarterly.
