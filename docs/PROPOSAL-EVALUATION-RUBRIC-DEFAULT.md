# Default proposal evaluation rubric

This is the **starter checklist** shipped with Knowtation Hub. Admins can override it by placing a JSON file at **`data/hub_proposal_rubric.json`** (same shape as below). The Hub merges these items with per-item pass/fail when an evaluator submits an evaluation.

## Shape

```json
{
  "items": [
    { "id": "accurate", "label": "Short human-readable criterion" }
  ]
}
```

- **`id`**: Stable key (snake_case). Submitted evaluations reference these ids.
- **`label`**: Shown in the Hub UI and stored on the proposal record.

## Default items (summary)

| Id | Intent |
|----|--------|
| `accurate` | Factual/context fit |
| `no_secrets` | No keys or credentials |
| `matches_intent` | Aligns with proposal intent |
| `pii` | Minimal unnecessary personal data |
| `tone` | Fits vault style |

Customize or add rows for your organization (compliance, legal review, product areas, etc.). See [PROPOSAL-LIFECYCLE.md](./PROPOSAL-LIFECYCLE.md) for evaluation states and gating.
