---
title: "Automation — thermostat weekday comfort + savings"
project: "home-automation"
tags:
  - automations
  - hvac
  - schedule
date: 2026-04-07
---

# Thermostat schedule (weekdays)

**Platform** — ExampleCo Climate (local execution when hub online).

## Triggers

- **Time** — Daily at `06:00`, `08:30`, `17:00`, `22:30` (home timezone).
- **Optional** — Geofence “anyone home” **within 2 km** → pre-cool/heat 20 min before `17:00` if away all day.

## Conditions

- **Mode** = Heat or Cool (not Off).
- **Windows** — Skip aggressive cool if `bedroom_window` sensor = open.
- **Guest mode** flag off (manual override honored when on).

## Actions

| Time | Heat setpoint | Cool setpoint | Fan |
| ---- | ------------- | ------------- | --- |
| 06:00 | 66°F | 74°F | Auto |
| 08:30 | 62°F | 78°F | Auto (eco) |
| 17:00 | 68°F | 73°F | Auto |
| 22:30 | 64°F | 75°F | Auto |

## Overrides

- **Vacation** scene lowers duty cycle; document dates in `maintenance/` or a dedicated travel note.

Last verified against live automations: **2026-04-07**.
