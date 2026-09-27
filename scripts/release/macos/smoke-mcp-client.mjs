#!/usr/bin/env node
import { spawn } from 'node:child_process';

const helperIndex = process.argv.indexOf('--helper');
if (helperIndex < 0 || !process.argv[helperIndex + 1]) throw new Error('missing --helper');
const child = spawn(process.argv[helperIndex + 1], [], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME, LANG: 'en_US.UTF-8' },
});
let output = '';
const timeout = setTimeout(() => {
  child.kill('SIGTERM');
  throw new Error('MCP provisioning smoke test timed out');
}, 20_000);

try {
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stdin.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'knowtation-release-smoke', version: '1.0.0' },
    },
  })}\n`);
  await new Promise((resolve, reject) => {
    const poll = setInterval(() => {
      if (!output.includes('"id":1')) return;
      clearInterval(poll);
      resolve();
    }, 25);
    child.once('error', (error) => { clearInterval(poll); reject(error); });
    child.once('exit', (code) => {
      clearInterval(poll);
      reject(new Error(`MCP helper exited before initialize response: ${code}`));
    });
  });
  const response = output.split('\n').filter(Boolean).map((line) => JSON.parse(line))
    .find((message) => message.id === 1);
  if (!response?.result?.protocolVersion) throw new Error('MCP initialize response missing');
  console.log(JSON.stringify({ ok: true, protocolVersion: response.result.protocolVersion }));
} finally {
  clearTimeout(timeout);
  child.kill('SIGTERM');
}
