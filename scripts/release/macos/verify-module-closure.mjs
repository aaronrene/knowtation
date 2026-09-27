#!/usr/bin/env node
import fs from 'node:fs';
import module from 'node:module';
import path from 'node:path';
import vm from 'node:vm';

const runtimeIndex = process.argv.indexOf('--runtime');
if (runtimeIndex < 0 || !process.argv[runtimeIndex + 1]) throw new Error('missing --runtime');
const runtime = path.resolve(process.argv[runtimeIndex + 1]);
const builtins = new Set([...module.builtinModules, ...module.builtinModules.map((name) => `node:${name}`)]);
if (typeof vm.SourceTextModule !== 'function') {
  throw new Error('verify-module-closure requires Node --experimental-vm-modules');
}
const queue = [
  path.join(runtime, 'companion/runtime/main.mjs'),
  path.join(runtime, 'companion/runtime/app-runtime.mjs'),
  path.join(runtime, 'cli/index.mjs'),
  path.join(runtime, 'mcp/server.mjs'),
];
const visited = new Set();
const barePackages = new Set();

function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function resolveRelative(from, specifier) {
  const candidate = path.resolve(path.dirname(from), specifier);
  const choices = [
    candidate,
    `${candidate}.mjs`,
    `${candidate}.js`,
    path.join(candidate, 'index.mjs'),
    path.join(candidate, 'index.js'),
  ];
  const found = choices.find((choice) => fs.existsSync(choice) && fs.statSync(choice).isFile());
  if (!found || !found.startsWith(`${runtime}${path.sep}`)) {
    throw new Error(`bundled source import is missing or escapes runtime: ${specifier}`);
  }
  return found;
}

while (queue.length > 0) {
  const file = queue.pop();
  if (visited.has(file)) continue;
  visited.add(file);
  const source = fs.readFileSync(file, 'utf8');
  const parsed = new vm.SourceTextModule(source, { identifier: file });
  const specifiers = [...parsed.dependencySpecifiers];
  const dynamicImports = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (const match of source.matchAll(dynamicImports)) specifiers.push(match[2]);
  for (const specifier of specifiers) {
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      queue.push(resolveRelative(file, specifier));
    } else if (!builtins.has(specifier)) {
      barePackages.add(packageName(specifier));
    }
  }
}

for (const dependency of [...barePackages].sort()) {
  const packageFile = path.join(runtime, 'node_modules', dependency, 'package.json');
  if (!fs.existsSync(packageFile)) throw new Error(`bundled dependency is missing: ${dependency}`);
}

process.stdout.write(
  `module closure verified (${visited.size} source modules, ${barePackages.size} dependency roots)\n`
);
