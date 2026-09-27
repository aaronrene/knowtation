#!/usr/bin/env node
import { createCustodyKeychainAdapter } from './custody-client.mjs';
import { fileURLToPath } from 'node:url';
import {
  COMPANION_HUB_ORIGIN,
  ensureHostedSession,
  inspectCompanionSession,
  signInCompanion,
  signOutCompanion,
  verifyHostedSession,
} from './oauth-session.mjs';

function parseInvocation(argv) {
  const modeIndex = argv.indexOf('--mode');
  if (modeIndex < 0 || !['app', 'cli', 'mcp'].includes(argv[modeIndex + 1])) {
    throw new Error('invalid_runtime_mode');
  }
  const separator = argv.indexOf('--', modeIndex + 2);
  return {
    mode: argv[modeIndex + 1],
    args: separator < 0 ? [] : argv.slice(separator + 1),
  };
}

async function runCompanionCommand(custody, args) {
  const action = args[1] ?? 'status';
  if (action === 'status') {
    await custody.status();
    const status = await inspectCompanionSession({ keychain: custody });
    console.log(JSON.stringify({ custody: 'available', ...status }));
    return;
  }
  if (action === 'sign-in') {
    await signInCompanion({ keychain: custody });
    console.log(JSON.stringify({ signedIn: true }));
    return;
  }
  if (action === 'verify-session') {
    const result = await verifyHostedSession({ keychain: custody });
    console.log(JSON.stringify(result));
    return;
  }
  if (action === 'sign-out') {
    console.log(JSON.stringify(await signOutCompanion({ keychain: custody })));
    return;
  }
  throw new Error('unknown_companion_command');
}

async function applyHostedSession(custody) {
  try {
    const session = await ensureHostedSession({ keychain: custody });
    process.env.KNOWTATION_HUB_URL = COMPANION_HUB_ORIGIN;
    process.env.KNOWTATION_HUB_TOKEN = session.accessToken;
    return true;
  } catch {
    delete process.env.KNOWTATION_HUB_URL;
    delete process.env.KNOWTATION_HUB_TOKEN;
    return false;
  }
}

async function main() {
  const invocation = parseInvocation(process.argv.slice(2));
  const custody = createCustodyKeychainAdapter();
  globalThis.__knowtationCustody = custody;
  process.once('exit', () => custody.close());

  if (invocation.mode === 'app') {
    if (invocation.args[0] === 'companion') {
      try {
        await runCompanionCommand(custody, invocation.args);
      } finally {
        custody.close();
      }
      return;
    }
    const launcherPID = process.ppid;
    await custody.status();
    const { startAppRuntime } = await import('./app-runtime.mjs');
    const runtimeRoot = fileURLToPath(new URL('../../', import.meta.url));
    const runtime = await startAppRuntime({ custody, runtimeRoot });
    const stop = async () => {
      await runtime.close().catch(() => {});
      custody.close();
      process.exit(0);
    };
    process.once('SIGINT', () => void stop());
    process.once('SIGTERM', () => void stop());
    const parentWatch = setInterval(() => {
      if (process.ppid !== launcherPID) void stop();
    }, 1_000);
    parentWatch.unref();
    await new Promise(() => {});
    return;
  }

  if (invocation.mode === 'cli') {
    if (invocation.args[0] === 'companion') {
      try {
        await runCompanionCommand(custody, invocation.args);
      } finally {
        custody.close();
      }
      return;
    }
    await applyHostedSession(custody);
    process.argv = [process.execPath, fileURLToPath(new URL('../../cli/index.mjs', import.meta.url)), ...invocation.args];
    await import('../../cli/index.mjs');
    return;
  }

  if (invocation.args[0] === 'companion') {
    try {
      await runCompanionCommand(custody, invocation.args);
    } finally {
      custody.close();
    }
    return;
  }
  process.env.MCP_TRANSPORT = 'stdio';
  process.env.KNOWTATION_MCP_TRANSPORT = 'stdio';
  await applyHostedSession(custody);
  process.argv = [process.execPath, fileURLToPath(new URL('../../mcp/server.mjs', import.meta.url)), ...invocation.args];
  await import('../../mcp/server.mjs');
}

main().catch((error) => {
  console.error(error?.code || error?.message || 'companion_runtime_failed');
  process.exit(1);
});
