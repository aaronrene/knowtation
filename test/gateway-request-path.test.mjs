import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveRequestPath, upstreamPathAndQuery } from '../hub/gateway/request-path.mjs';

test('effectiveRequestPath prefers baseUrl + path under /api/v1 mount', () => {
  const req = {
    baseUrl: '/api/v1',
    path: '/notes',
    originalUrl: '/notes',
    url: '/notes',
  };
  assert.equal(effectiveRequestPath(req), '/api/v1/notes');
});

test('effectiveRequestPath falls back to originalUrl when mount not used', () => {
  const req = {
    baseUrl: '',
    path: '/health',
    originalUrl: '/health',
    url: '/health',
  };
  assert.equal(effectiveRequestPath(req), '/health');
});

test('upstreamPathAndQuery appends query from originalUrl', () => {
  const req = {
    baseUrl: '/api/v1',
    path: '/notes',
    originalUrl: '/notes?limit=5',
    url: '/notes?limit=5',
  };
  assert.equal(upstreamPathAndQuery(req), '/api/v1/notes?limit=5');
});
