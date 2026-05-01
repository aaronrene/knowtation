/**
 * Skill: read-playbook
 *
 * Returns a specific playbook (e.g. `influencer-outreach`, `agentic-marketing-framework`)
 * for one of the three projects. Used by outreach + clip-factory + research agents
 * that need step-by-step playbooks, not just voice/positioning.
 *
 * Vault path convention:
 *   vault/projects/<project>/playbooks/<slug>.md
 *
 * @param {ReturnType<import('./hub-client.mjs').createHubClient>} hub
 * @param {{ project: 'born-free' | 'store-free' | 'knowtation', slug: string }} args
 * @returns {Promise<{ path: string, frontmatter: object, body: string }>}
 */
import { assertProject } from './hub-client.mjs';

export async function readPlaybook(hub, args) {
  const project = assertProject(args.project);
  const slug = sanitizeSlug(args.slug);
  const path = `projects/${project}/playbooks/${slug}.md`;

  let note;
  try {
    note = await hub.getNote(path);
  } catch (e) {
    if (e.status === 404) {
      throw Object.assign(
        new Error(
          `playbook_missing: vault/${path} does not exist on the Hub. ` +
            `Create it before running agents that need this playbook.`
        ),
        { code: 'PLAYBOOK_MISSING', project, path, slug, cause: e }
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
