/**
 * Skill: read-positioning
 *
 * Returns the current positioning + messaging outline for one of the three projects.
 * Used by script-writer, blog-seo, social-poster, and newsletter agents to ensure
 * every asset reflects the latest positioning, not a stale prior version.
 *
 * Vault path convention (defaults to the 2026-04 outline; pass `slug` to read another):
 *   vault/projects/<project>/outlines/positioning-and-messaging-2026-04.md
 *
 * @param {ReturnType<import('./hub-client.mjs').createHubClient>} hub
 * @param {{ project: 'born-free' | 'store-free' | 'knowtation', slug?: string }} args
 * @returns {Promise<{ path: string, frontmatter: object, body: string }>}
 */
import { assertProject } from './hub-client.mjs';

const DEFAULT_SLUG = 'positioning-and-messaging-2026-04';

export async function readPositioning(hub, args) {
  const project = assertProject(args.project);
  const slug = sanitizeSlug(args.slug ?? DEFAULT_SLUG);
  const path = `projects/${project}/outlines/${slug}.md`;

  let note;
  try {
    note = await hub.getNote(path);
  } catch (e) {
    if (e.status === 404) {
      throw Object.assign(
        new Error(
          `positioning_missing: vault/${path} does not exist on the Hub. ` +
            `Either pass a different slug, or create the outline before running agents for ${project}.`
        ),
        { code: 'POSITIONING_MISSING', project, path, slug, cause: e }
      );
    }
    throw e;
  }

  return {
    path: note.path ?? path,
    frontmatter: note.frontmatter ?? {},
    body: typeof note.body === 'string' ? note.body : '',
  };
}

/**
 * Reject path traversal attempts. Slugs may contain a–z, 0–9, hyphens, underscores.
 * Allowing `/` or `..` here would let a misbehaving agent read arbitrary vault paths
 * and bypass project isolation.
 * @param {string} slug
 * @returns {string}
 */
function sanitizeSlug(slug) {
  if (typeof slug !== 'string' || !slug.trim()) {
    throw Object.assign(new Error('invalid_slug: slug must be a non-empty string'), {
      code: 'INVALID_SLUG',
    });
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug)) {
    throw Object.assign(
      new Error(`invalid_slug: '${slug}' contains illegal chars; allowed: a-z, 0-9, -, _`),
      { code: 'INVALID_SLUG', slug }
    );
  }
  return slug;
}
