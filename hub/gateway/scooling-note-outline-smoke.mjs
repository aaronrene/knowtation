import express from 'express';

const ALLOWED_ENVIRONMENTS = new Set(['local', 'staging']);
const FORBIDDEN_REQUEST_HEADERS = ['authorization', 'cookie', 'x-api-key'];

function normalizeBooleanFlag(value) {
  return value === true || value === '1' || value === 'true';
}

function configuredEnvironment() {
  return String(
    process.env.SCOOLING_NOTE_OUTLINE_SMOKE_ENV ||
      process.env.KNOWTATION_ENV ||
      process.env.HUB_ENV ||
      '',
  )
    .trim()
    .toLowerCase();
}

function smokeEnabled() {
  return normalizeBooleanFlag(process.env.SCOOLING_NOTE_OUTLINE_SMOKE_ENABLED);
}

function defaultAuthorizationHeader() {
  const token = String(process.env.SCOOLING_NOTE_OUTLINE_SMOKE_BEARER_TOKEN || '').trim();
  return token ? `Bearer ${token}` : '';
}

function normalizeVaultRelativePath(rawPath) {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new Error('Invalid path');
  }
  const forward = rawPath.trim().replace(/\\/g, '/');
  if (forward.startsWith('/') || /^[A-Za-z]:\//.test(forward)) {
    throw new Error('Invalid path');
  }
  const parts = forward.split('/').filter(Boolean);
  if (parts.includes('..')) {
    throw new Error('Invalid path');
  }
  return parts.join('/');
}

function normalizeEndpoint(rawEndpoint) {
  const endpoint = String(rawEndpoint || '').trim();
  if (!endpoint) {
    throw new Error('Missing endpoint');
  }
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Invalid endpoint');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Invalid endpoint');
  }
  return url.toString();
}

function hasForbiddenRequestCredentials(req) {
  return FORBIDDEN_REQUEST_HEADERS.some((name) => {
    const value = req.headers[name];
    return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.length > 0;
  });
}

function sanitizeError(status, error, code) {
  return {
    status,
    body: {
      error,
      code,
      containsRawCredentials: false,
      returnedBodyText: false,
      performedWrite: false,
    },
  };
}

function safeString(value) {
  return typeof value === 'string' ? value : '';
}

function isSafeHeading(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === 3 &&
    Number.isInteger(value.level) &&
    value.level >= 1 &&
    value.level <= 6 &&
    typeof value.text === 'string' &&
    typeof value.id === 'string'
  );
}

function sanitizeNoteOutline(payload, requestedPath) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid NoteOutline');
  }
  if (payload.schema !== 'knowtation.note_outline/v1') {
    throw new Error('Invalid NoteOutline');
  }
  if (payload.path !== requestedPath) {
    throw new Error('Invalid NoteOutline');
  }
  if (!Array.isArray(payload.headings) || !payload.headings.every(isSafeHeading)) {
    throw new Error('Invalid NoteOutline');
  }
  if (typeof payload.truncated !== 'boolean') {
    throw new Error('Invalid NoteOutline');
  }

  return {
    schema: 'knowtation.note_outline/v1',
    path: requestedPath,
    title: payload.title === null ? null : safeString(payload.title),
    headings: payload.headings.map((heading) => ({
      level: heading.level,
      text: heading.text,
      id: heading.id,
    })),
    truncated: payload.truncated,
  };
}

function mapUpstreamStatus(status) {
  if (status === 401 || status === 403) {
    return sanitizeError(403, 'Forbidden', 'FORBIDDEN');
  }
  if (status === 404) {
    return sanitizeError(404, 'Not found', 'NOT_FOUND');
  }
  return sanitizeError(502, 'Bad Gateway', 'BAD_GATEWAY');
}

async function readBridgeNoteOutline({ endpoint, authorizationHeader, fetchImpl, requestedPath }) {
  const upstreamUrl = new URL(endpoint);
  upstreamUrl.searchParams.set('path', requestedPath);

  const response = await fetchImpl(upstreamUrl.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: authorizationHeader,
    },
  });

  if (!response.ok) {
    throw mapUpstreamStatus(response.status);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (_) {
    throw sanitizeError(502, 'Bad Gateway', 'BAD_GATEWAY');
  }

  try {
    return sanitizeNoteOutline(payload, requestedPath);
  } catch (_) {
    throw sanitizeError(502, 'Bad Gateway', 'BAD_GATEWAY');
  }
}

function createScoolingNoteOutlineSmokeRouter({
  upstreamEndpoint = process.env.SCOOLING_NOTE_OUTLINE_SMOKE_UPSTREAM || '',
  authorizationHeader = defaultAuthorizationHeader,
  fetchImpl = globalThis.fetch,
  isEnabled = smokeEnabled,
  environment = configuredEnvironment,
} = {}) {
  const router = express.Router();

  router.get('/scooling/note-outline/smoke', async (req, res) => {
    if (!isEnabled() || !ALLOWED_ENVIRONMENTS.has(environment())) {
      return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
    }
    if (hasForbiddenRequestCredentials(req)) {
      return res
        .status(400)
        .json(sanitizeError(400, 'Raw credentials are not accepted.', 'BAD_REQUEST').body);
    }

    let requestedPath;
    let endpoint;
    let authHeader;
    try {
      requestedPath = normalizeVaultRelativePath(req.query.path);
    } catch (_) {
      const err = sanitizeError(400, 'Invalid NoteOutline smoke request.', 'BAD_REQUEST');
      return res.status(err.status).json(err.body);
    }

    try {
      endpoint = normalizeEndpoint(upstreamEndpoint);
      authHeader = authorizationHeader();
      if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ') || authHeader.length <= 7) {
        throw new Error('Missing authorization');
      }
    } catch (_) {
      const err = sanitizeError(503, 'NoteOutline smoke bridge is unavailable.', 'SERVICE_UNAVAILABLE');
      return res.status(err.status).json(err.body);
    }

    try {
      const outline = await readBridgeNoteOutline({
        endpoint,
        authorizationHeader: authHeader,
        fetchImpl,
        requestedPath,
      });
      return res.json(outline);
    } catch (error) {
      const sanitized = error && typeof error === 'object' && error.body ? error : sanitizeError(502, 'Bad Gateway', 'BAD_GATEWAY');
      return res.status(sanitized.status).json(sanitized.body);
    }
  });

  return router;
}

export {
  createScoolingNoteOutlineSmokeRouter,
  normalizeVaultRelativePath,
  sanitizeNoteOutline,
};
