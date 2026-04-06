/**
 * Hosted consolidation "advanced" knobs — same ranges as self-hosted Hub POST
 * (hub/server.mjs /api/v1/settings/consolidation). Used by gateway, bridge, and scheduler.
 */

export const HOSTED_CONSOL_LOOKBACK_MIN = 1;
export const HOSTED_CONSOL_LOOKBACK_MAX = 8760;
export const HOSTED_CONSOL_MAX_EVENTS_MIN = 1;
export const HOSTED_CONSOL_MAX_EVENTS_MAX = 10000;
export const HOSTED_CONSOL_MAX_TOPICS_MIN = 1;
export const HOSTED_CONSOL_MAX_TOPICS_MAX = 500;
export const HOSTED_CONSOL_LLM_TOKENS_MIN = 64;
export const HOSTED_CONSOL_LLM_TOKENS_MAX = 8192;

export const HOSTED_CONSOL_DEFAULT_LOOKBACK_HOURS = 24;
export const HOSTED_CONSOL_DEFAULT_MAX_EVENTS = 200;
export const HOSTED_CONSOL_DEFAULT_MAX_TOPICS = 10;
export const HOSTED_CONSOL_DEFAULT_LLM_MAX_TOKENS = 1024;

/**
 * Clamp integer n to [lo, hi]; invalid → fallback.
 * @param {unknown} n
 * @param {number} lo
 * @param {number} hi
 * @param {number} fallback
 */
export function clampConsolidationInt(n, lo, hi, fallback) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x)) return fallback;
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Read advanced defaults from a normalized billing user record.
 * @param {object|null|undefined} u
 * @returns {{ lookback_hours: number, max_events_per_pass: number, max_topics_per_pass: number, llm_max_tokens: number }}
 */
export function hostedAdvancedFromBillingUser(u) {
  if (!u || typeof u !== 'object') {
    return {
      lookback_hours: HOSTED_CONSOL_DEFAULT_LOOKBACK_HOURS,
      max_events_per_pass: HOSTED_CONSOL_DEFAULT_MAX_EVENTS,
      max_topics_per_pass: HOSTED_CONSOL_DEFAULT_MAX_TOPICS,
      llm_max_tokens: HOSTED_CONSOL_DEFAULT_LLM_MAX_TOKENS,
    };
  }
  return {
    lookback_hours: clampConsolidationInt(
      u.consolidation_lookback_hours,
      HOSTED_CONSOL_LOOKBACK_MIN,
      HOSTED_CONSOL_LOOKBACK_MAX,
      HOSTED_CONSOL_DEFAULT_LOOKBACK_HOURS,
    ),
    max_events_per_pass: clampConsolidationInt(
      u.consolidation_max_events_per_pass,
      HOSTED_CONSOL_MAX_EVENTS_MIN,
      HOSTED_CONSOL_MAX_EVENTS_MAX,
      HOSTED_CONSOL_DEFAULT_MAX_EVENTS,
    ),
    max_topics_per_pass: clampConsolidationInt(
      u.consolidation_max_topics_per_pass,
      HOSTED_CONSOL_MAX_TOPICS_MIN,
      HOSTED_CONSOL_MAX_TOPICS_MAX,
      HOSTED_CONSOL_DEFAULT_MAX_TOPICS,
    ),
    llm_max_tokens: clampConsolidationInt(
      u.consolidation_llm_max_tokens,
      HOSTED_CONSOL_LLM_TOKENS_MIN,
      HOSTED_CONSOL_LLM_TOKENS_MAX,
      HOSTED_CONSOL_DEFAULT_LLM_MAX_TOKENS,
    ),
  };
}

/**
 * Merge JSON body for POST /memory/consolidate: explicit body fields win; missing keys use billing user.
 * @param {object} body - request body (may be partial)
 * @param {object} billingUser - normalizeBillingUser() output
 * @returns {object} shallow copy with lookback_hours, max_events_per_pass, max_topics_per_pass, llm.max_tokens filled
 */
export function mergeConsolidateRequestBodyWithBillingDefaults(body, billingUser) {
  const src = body && typeof body === 'object' ? body : {};
  const out = { ...src };
  const d = hostedAdvancedFromBillingUser(billingUser);

  if (out.lookback_hours == null) out.lookback_hours = d.lookback_hours;
  if (out.max_events_per_pass == null) out.max_events_per_pass = d.max_events_per_pass;
  if (out.max_topics_per_pass == null) out.max_topics_per_pass = d.max_topics_per_pass;

  const prevLlm = out.llm && typeof out.llm === 'object' ? out.llm : {};
  if (prevLlm.max_tokens == null) {
    out.llm = { ...prevLlm, max_tokens: d.llm_max_tokens };
  } else {
    out.llm = { ...prevLlm };
  }

  return out;
}

/**
 * Validate optional advanced fields on POST /api/v1/settings/consolidation (hosted gateway).
 * Only checks keys that are present on body.
 * @param {object} body
 * @returns {{ ok: true } | { ok: false, error: string, code: string }}
 */
export function validateHostedSettingsConsolidationAdvanced(body) {
  if (!body || typeof body !== 'object') return { ok: true };
  if (body.lookback_hours !== undefined) {
    const lb = Math.floor(Number(body.lookback_hours));
    if (!Number.isFinite(lb) || lb < HOSTED_CONSOL_LOOKBACK_MIN || lb > HOSTED_CONSOL_LOOKBACK_MAX) {
      return { ok: false, error: 'lookback_hours must be 1–8760', code: 'VALIDATION_ERROR' };
    }
  }
  if (body.max_events_per_pass !== undefined) {
    const me = Math.floor(Number(body.max_events_per_pass));
    if (!Number.isFinite(me) || me < HOSTED_CONSOL_MAX_EVENTS_MIN || me > HOSTED_CONSOL_MAX_EVENTS_MAX) {
      return { ok: false, error: 'max_events_per_pass must be 1–10000', code: 'VALIDATION_ERROR' };
    }
  }
  if (body.max_topics_per_pass !== undefined) {
    const mt = Math.floor(Number(body.max_topics_per_pass));
    if (!Number.isFinite(mt) || mt < HOSTED_CONSOL_MAX_TOPICS_MIN || mt > HOSTED_CONSOL_MAX_TOPICS_MAX) {
      return { ok: false, error: 'max_topics_per_pass must be 1–500', code: 'VALIDATION_ERROR' };
    }
  }
  if (body.llm !== undefined && typeof body.llm === 'object' && body.llm.max_tokens !== undefined) {
    const mxt = Math.floor(Number(body.llm.max_tokens));
    if (!Number.isFinite(mxt) || mxt < HOSTED_CONSOL_LLM_TOKENS_MIN || mxt > HOSTED_CONSOL_LLM_TOKENS_MAX) {
      return { ok: false, error: 'llm.max_tokens must be 64–8192', code: 'VALIDATION_ERROR' };
    }
  }
  return { ok: true };
}
