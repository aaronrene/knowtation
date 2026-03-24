#!/usr/bin/env node
/**
 * Optional multi-vault smoke against a deployed canister and/or gateway.
 *
 * Usage:
 *   CANISTER_URL=https://<id>.icp0.io X_TEST_USER=smoke:user npm run smoke:hosted-multi-vault
 *
 * Or JWT via gateway (no X-Test-User on production):
 *   HUB_GATEWAY_URL=https://your-gateway.example HUB_SMOKE_TOKEN='<jwt>' npm run smoke:hosted-multi-vault
 *
 * Exits 0 on success, 1 on failure or missing env.
 */
const CANISTER_URL = (process.env.CANISTER_URL || '').replace(/\/$/, '');
const X_TEST_USER = process.env.X_TEST_USER || '';
const GATEWAY_URL = (process.env.HUB_GATEWAY_URL || '').replace(/\/$/, '');
const TOKEN = process.env.HUB_SMOKE_TOKEN || '';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

async function main() {
  if (!CANISTER_URL && !GATEWAY_URL) {
    fail('Set CANISTER_URL and X_TEST_USER, or HUB_GATEWAY_URL and HUB_SMOKE_TOKEN.');
  }

  const headersBase = { Accept: 'application/json' };
  let base;
  let headers = { ...headersBase };

  if (GATEWAY_URL && TOKEN) {
    base = GATEWAY_URL;
    headers.Authorization = `Bearer ${TOKEN}`;
  } else if (CANISTER_URL && X_TEST_USER) {
    base = CANISTER_URL;
    headers['X-Test-User'] = X_TEST_USER;
  } else {
    fail('Need (CANISTER_URL + X_TEST_USER) or (HUB_GATEWAY_URL + HUB_SMOKE_TOKEN).');
  }

  const healthUrl = `${base}/health`;
  const h = await fetch(healthUrl, { headers: { Accept: 'application/json' } });
  if (!h.ok) fail(`GET /health failed: ${h.status} ${healthUrl}`);

  const vUrl = `${base}/api/v1/vaults`;
  const v = await fetch(vUrl, { headers });
  if (!v.ok) fail(`GET /api/v1/vaults failed: ${v.status}`);
  const vJson = await v.json();
  const vaults = Array.isArray(vJson.vaults) ? vJson.vaults : [];
  if (vaults.length < 1) fail('Expected at least one vault in JSON { vaults: [...] }');
  console.log('OK vaults:', vaults.map((x) => x.id).join(', '));

  const vid = process.env.SMOKE_SECOND_VAULT_ID || 'smoke_second';
  const postUrl = `${base}/api/v1/notes`;
  const postHeaders = {
    ...headers,
    'Content-Type': 'application/json',
    'X-Vault-Id': vid,
  };
  const path = `inbox/.smoke-multi-vault-${Date.now()}.md`;
  const body = JSON.stringify({
    path,
    body: `smoke ${vid} ${new Date().toISOString()}`,
    frontmatter: '---\ntitle: smoke\n---\n',
  });
  const p = await fetch(postUrl, { method: 'POST', headers: postHeaders, body });
  if (!p.ok) {
    const t = await p.text();
    fail(`POST note failed: ${p.status} ${t.slice(0, 200)}`);
  }

  const v2 = await fetch(vUrl, { headers });
  const v2Json = await v2.json();
  const ids = (Array.isArray(v2Json.vaults) ? v2Json.vaults : []).map((x) => x.id);
  if (!ids.includes(vid)) {
    fail(`Second vault ${vid} not listed after POST; got: ${ids.join(', ')}`);
  }

  const exUrl = `${base}/api/v1/export`;
  const exDef = await fetch(exUrl, { headers: { ...headers, 'X-Vault-Id': 'default' } });
  const exVid = await fetch(exUrl, { headers: { ...headers, 'X-Vault-Id': vid } });
  if (!exDef.ok || !exVid.ok) {
    fail(`export failed default=${exDef.status} ${vid}=${exVid.status}`);
  }
  const jDef = await exDef.json();
  const jVid = await exVid.json();
  const notesDef = Array.isArray(jDef.notes) ? jDef.notes : [];
  const notesVid = Array.isArray(jVid.notes) ? jVid.notes : [];
  const inDefault = notesDef.some((n) => n.path === path);
  const inSecond = notesVid.some((n) => n.path === path);
  if (inDefault) fail('Export leak: new note path appears in default vault export');
  if (!inSecond) fail('Export miss: new note path missing from second vault export');

  console.log('OK multi-vault smoke: list, post, export isolation');
}

main().catch((e) => fail(e?.message || String(e)));
