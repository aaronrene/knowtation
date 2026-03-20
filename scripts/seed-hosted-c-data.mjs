#!/usr/bin/env node
/**
 * Seed recognizable C-related demo notes into a Hub backend (hosted gateway + canister).
 *
 * Usage:
 *   KNOWTATION_HUB_URL="https://knowtation-gateway.netlify.app" \
 *   KNOWTATION_HUB_TOKEN="<JWT from Hub after login>" \
 *   node scripts/seed-hosted-c-data.mjs
 *
 * Notes:
 * - Idempotent: writes fixed paths under seed/c-data/ (re-running overwrites).
 * - Safe: everything is namespaced under seed/c-data/ so you can delete later.
 */

const hubUrl = (process.env.KNOWTATION_HUB_URL || process.env.HUB_URL || '').replace(/\/$/, '');
const token = process.env.KNOWTATION_HUB_TOKEN || process.env.HUB_TOKEN || '';

if (!hubUrl) {
  console.error('Missing KNOWTATION_HUB_URL (e.g. https://knowtation-gateway.netlify.app)');
  process.exit(2);
}
if (!token) {
  console.error('Missing KNOWTATION_HUB_TOKEN (JWT from Hub after login)');
  process.exit(2);
}

function fm(obj) {
  return `---\n${Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.map((x) => JSON.stringify(String(x))).join(', ')}]`;
      if (typeof v === 'number') return `${k}: ${v}`;
      return `${k}: ${JSON.stringify(String(v))}`;
    })
    .join('\n')}\n---\n`;
}

const nowIso = new Date().toISOString();
const notes = [
  {
    path: 'seed/c-data/README.md',
    title: 'C seed data (demo)',
    tags: ['seed', 'c', 'demo'],
    project: 'seed',
    body: `# C seed data (demo)\n\nC_DATA_SEED\n\nThese notes are intentionally obvious and repeatable.\n\n- Purpose: quick visual check that the hosted canister-backed vault is reading/writing correctly.\n- Namespace: \`seed/c-data/\`\n- Regenerate: run \`node scripts/seed-hosted-c-data.mjs\`\n\nCreated at: ${nowIso}\n`,
  },
  {
    path: 'seed/c-data/pointers-and-arrays.md',
    title: 'Pointers and arrays',
    tags: ['seed', 'c', 'pointers'],
    project: 'seed',
    body: `# Pointers and arrays\n\nC_DATA_SEED\n\n## Pointer basics\n\n\`\`\`c\nint x = 42;\nint *p = &x;\nprintf(\"%d\\n\", *p);\n\`\`\`\n\n## Arrays decay to pointers\n\n\`\`\`c\nint a[3] = {1,2,3};\nint *p = a; // same as &a[0]\nprintf(\"%d\\n\", p[1]);\n\`\`\`\n`,
  },
  {
    path: 'seed/c-data/structs-and-offsetof.md',
    title: 'Structs, padding, offsetof',
    tags: ['seed', 'c', 'struct'],
    project: 'seed',
    body: `# Structs, padding, offsetof\n\nC_DATA_SEED\n\n\`\`\`c\n#include <stddef.h>\n\ntypedef struct {\n  char tag;\n  int value;\n} Item;\n\nsize_t off = offsetof(Item, value);\n\`\`\`\n\n- Padding depends on ABI; \`offsetof\` is the reliable way to compute member offsets.\n`,
  },
  {
    path: 'seed/c-data/malloc-free.md',
    title: 'malloc/free checklist',
    tags: ['seed', 'c', 'memory'],
    project: 'seed',
    body: `# malloc/free checklist\n\nC_DATA_SEED\n\n- Always check allocation result.\n- Initialize memory if needed (\`calloc\` or \`memset\`).\n- Pair every successful allocation with exactly one \`free\`.\n- Avoid use-after-free: set pointer to NULL after freeing.\n\n\`\`\`c\nchar *buf = malloc(1024);\nif (!buf) return -1;\nmemset(buf, 0, 1024);\n/* ... */\nfree(buf);\nbuf = NULL;\n\`\`\`\n`,
  },
  {
    path: 'seed/c-data/strings-and-buffers.md',
    title: 'Strings and buffers',
    tags: ['seed', 'c', 'strings'],
    project: 'seed',
    body: `# Strings and buffers\n\nC_DATA_SEED\n\nPrefer bounded operations:\n\n\`\`\`c\nsnprintf(out, out_cap, \"%s:%d\", name, port);\n\`\`\`\n\nKnow what null-termination guarantees apply for each function you use.\n`,
  },
  {
    path: 'seed/c-data/error-handling-patterns.md',
    title: 'Error handling patterns (C)',
    tags: ['seed', 'c', 'errors'],
    project: 'seed',
    body: `# Error handling patterns (C)\n\nC_DATA_SEED\n\nA common pattern is \`goto cleanup\` to keep resource release correct.\n\n\`\`\`c\nint rc = 0;\nFILE *f = fopen(path, \"rb\");\nif (!f) { rc = -1; goto cleanup; }\n\n/* ... */\n\ncleanup:\nif (f) fclose(f);\nreturn rc;\n\`\`\`\n`,
  },
];

async function writeNote(n) {
  const frontmatter = fm({
    title: n.title,
    project: n.project,
    tags: n.tags,
    seed: true,
    seed_kind: 'c-data',
    created_at: nowIso,
  });
  const body = frontmatter + '\n' + n.body;

  const r = await fetch(`${hubUrl}/api/v1/notes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: n.path, body }),
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`POST /api/v1/notes failed (${r.status}): ${text}`);
  }
  return text;
}

const results = [];
for (const n of notes) {
  process.stdout.write(`Seeding ${n.path} ... `);
  // eslint-disable-next-line no-await-in-loop
  await writeNote(n);
  process.stdout.write('ok\n');
  results.push(n.path);
}

console.log(`\nSeed complete (${results.length} notes). Open Hub → Notes and look under seed/c-data/.`);
