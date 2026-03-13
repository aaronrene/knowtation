#!/usr/bin/env node
/**
 * Knowledger CLI — single entry point for search, get-note, list-notes, index, etc.
 * Agents discover usage via SKILL.md and `knowledger --help` / `knowledger <cmd> --help`.
 * Output: JSON or structured text for piping.
 */

const args = process.argv.slice(2);
const subcommand = args[0];

const help = `
knowtation — personal knowledge and content system (know + notation)

Usage:
  knowtation <command> [options]

Commands:
  search <query>     Semantic search over vault (returns ranked notes/chunks). Use --json for machine output.
  get-note <path>   Return full content of one note by path.
  list-notes        List notes with optional --folder, --tag, --limit, --offset. Use --json for machine output.
  index             Re-run indexer: vault → chunk → embed → vector store (Qdrant or sqlite-vec).

Options (global):
  --help, -h        Show this help or command-specific help.
  --json            Output JSON for piping to other tools.

Examples:
  knowtation search "community building"
  knowtation search "transcript about launch" --json
  knowtation get-note vault/projects/default/notes.md
  knowtation list-notes --folder vault/inbox --limit 10 --json
  knowtation index

Config: vault path and vector store URL from config/local.yaml or env (KNOWTATION_VAULT_PATH, QDRANT_URL).
`;

const searchHelp = `
knowtation search <query>

  Semantic search over the indexed vault. Returns ranked notes (path, snippet, score).
  Add --json for machine-readable output.

  Options:
    --folder <path>   Limit to vault subfolder.
    --limit <n>       Max results (default 10).
    --json            JSON output.
`;

function main() {
  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(help.trim());
    process.exit(0);
  }

  if (subcommand === 'search') {
    if (args.includes('--help') || args.includes('-h')) {
      console.log(searchHelp.trim());
      process.exit(0);
    }
    const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    if (!query) {
      console.error('knowtation search: provide a query string.');
      process.exit(1);
    }
    // Stub: implement by calling vector store (Qdrant) and optionally vault keyword search
    console.log(JSON.stringify({ stub: true, command: 'search', query, message: 'Implement: connect to Qdrant and return ranked chunks.' }));
    process.exit(0);
  }

  if (subcommand === 'get-note') {
    const path = args[1];
    if (!path) {
      console.error('knowtation get-note: provide a note path.');
      process.exit(1);
    }
    // Stub: implement by reading file from vault
    console.log(JSON.stringify({ stub: true, command: 'get-note', path, message: 'Implement: read vault file and return content.' }));
    process.exit(0);
  }

  if (subcommand === 'list-notes') {
    const folder = args.includes('--folder') ? args[args.indexOf('--folder') + 1] : null;
    const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1], 10) : 20;
    console.log(JSON.stringify({ stub: true, command: 'list-notes', folder, limit, message: 'Implement: list vault notes with filters.' }));
    process.exit(0);
  }

  if (subcommand === 'index') {
    // Delegate to scripts/index-vault.mjs
    console.log('Run: node scripts/index-vault.mjs');
    process.exit(0);
  }

  console.error(`Unknown command: ${subcommand}`);
  console.log(help.trim());
  process.exit(1);
}

main();
