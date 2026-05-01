/**
 * Skill: write-draft
 *
 * Writes an agent-generated draft back to the vault for human review.
 *
 * Vault path convention (auto-dated, agent-stamped):
 *   vault/projects/<project>/drafts/<YYYY-MM-DD>-<kind>-<short-title-slug>.md
 *
 * Frontmatter we always inject (used by Hub UI to render a review queue):
 *   - status: 'pending'           (pending | approved | rejected | published)
 *   - project: '<project>'
 *   - kind: '<kind>'              (script | social | thumbnail | clip | blog | newsletter)
 *   - agent: '<agent-name>'       (e.g. 'bornfree-script-writer')
 *   - generated_at: ISO8601 string
 *   - source_grounding: array of vault paths the agent read (style guide, positioning, etc.)
 *
 * Hard rules:
 *  - Refuses to overwrite an existing approved/published draft (only pending may be replaced).
 *  - Refuses path traversal attempts.
 *  - Always writes via Hub PUT (never the bridge directly).
 *
 * @param {ReturnType<import('./hub-client.mjs').createHubClient>} hub
 * @param {{
 *   project: 'born-free' | 'store-free' | 'knowtation',
 *   kind: 'script' | 'social' | 'thumbnail' | 'clip' | 'blog' | 'newsletter',
 *   title: string,
 *   body: string,
 *   agent: string,
 *   sourceGrounding?: string[],
 *   extraFrontmatter?: Record<string, unknown>,
 *   now?: () => Date,
 * }} args
 * @returns {Promise<{ path: string, frontmatter: object, written: true }>}
 */
import { assertProject } from './hub-client.mjs';

const ALLOWED_KINDS = /** @type {const} */ (['script', 'social', 'thumbnail', 'clip', 'blog', 'newsletter']);

export async function writeDraft(hub, args) {
  const project = assertProject(args.project);
  const kind = assertKind(args.kind);
  const agent = sanitizeAgent(args.agent);
  const title = sanitizeTitle(args.title);
  const body = sanitizeBody(args.body);
  const sourceGrounding = sanitizeSourceGrounding(args.sourceGrounding);
  const extra = args.extraFrontmatter && typeof args.extraFrontmatter === 'object'
    ? args.extraFrontmatter
    : {};
  const now = (args.now ? args.now() : new Date());

  const datePrefix = isoDate(now);
  const titleSlug = slugify(title);
  const filename = `${datePrefix}-${kind}-${titleSlug}.md`;
  const path = `projects/${project}/drafts/${filename}`;

  // Refuse to overwrite an approved/published draft.
  let existing = null;
  try {
    existing = await hub.getNote(path);
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  if (existing && existing.frontmatter && typeof existing.frontmatter === 'object') {
    const status = String(existing.frontmatter.status ?? '').toLowerCase();
    if (status === 'approved' || status === 'published') {
      throw Object.assign(
        new Error(
          `refuse_overwrite: vault/${path} already exists with status='${status}'. ` +
            `Choose a different title or wait for the existing draft to be rejected.`
        ),
        { code: 'REFUSE_OVERWRITE', path, status }
      );
    }
  }

  const frontmatter = {
    ...extra,
    status: 'pending',
    project,
    kind,
    agent,
    title,
    generated_at: now.toISOString(),
    source_grounding: sourceGrounding,
  };

  await hub.putNote(path, {
    frontmatter,
    body,
  });

  return { path, frontmatter, written: true };
}

function assertKind(kind) {
  if (!ALLOWED_KINDS.includes(kind)) {
    throw Object.assign(
      new Error(`unknown_kind: '${kind}' is not in [${ALLOWED_KINDS.join(', ')}]`),
      { code: 'UNKNOWN_KIND' }
    );
  }
  return kind;
}

function sanitizeAgent(agent) {
  if (typeof agent !== 'string' || !agent.trim()) {
    throw Object.assign(new Error('invalid_agent: agent must be a non-empty string'), {
      code: 'INVALID_AGENT',
    });
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(agent)) {
    throw Object.assign(
      new Error(`invalid_agent: '${agent}' contains illegal chars; allowed: a-z, 0-9, -, _`),
      { code: 'INVALID_AGENT' }
    );
  }
  return agent;
}

function sanitizeTitle(title) {
  if (typeof title !== 'string' || !title.trim()) {
    throw Object.assign(new Error('invalid_title: title must be a non-empty string'), {
      code: 'INVALID_TITLE',
    });
  }
  if (title.length > 200) {
    throw Object.assign(new Error('invalid_title: title exceeds 200 chars'), {
      code: 'INVALID_TITLE',
    });
  }
  return title.trim();
}

function sanitizeBody(body) {
  if (typeof body !== 'string') {
    throw Object.assign(new Error('invalid_body: body must be a string'), {
      code: 'INVALID_BODY',
    });
  }
  if (body.length > 200_000) {
    throw Object.assign(new Error('invalid_body: body exceeds 200_000 chars'), {
      code: 'INVALID_BODY',
    });
  }
  return body;
}

function sanitizeSourceGrounding(arr) {
  if (arr == null) return [];
  if (!Array.isArray(arr)) {
    throw Object.assign(new Error('invalid_source_grounding: must be array of vault paths'), {
      code: 'INVALID_SOURCE_GROUNDING',
    });
  }
  return arr
    .map((p) => String(p))
    .filter((p) => p.length > 0 && !p.includes('..') && !p.startsWith('/'));
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}
