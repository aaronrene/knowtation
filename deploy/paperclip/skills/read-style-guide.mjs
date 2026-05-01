/**
 * Skill: read-style-guide
 *
 * Returns the canonical voice + boundaries note for one of the three projects.
 * Every conveyor-belt agent calls this FIRST, before generating any content,
 * so the output stays grounded in the project's documented voice.
 *
 * Vault path convention:
 *   vault/projects/<project>/style-guide/voice-and-boundaries.md
 *
 * @param {ReturnType<import('./hub-client.mjs').createHubClient>} hub
 * @param {{ project: 'born-free' | 'store-free' | 'knowtation' }} args
 * @returns {Promise<{ path: string, frontmatter: object, body: string }>}
 */
import { assertProject } from './hub-client.mjs';

export async function readStyleGuide(hub, args) {
  const project = assertProject(args.project);
  const path = `projects/${project}/style-guide/voice-and-boundaries.md`;

  let note;
  try {
    note = await hub.getNote(path);
  } catch (e) {
    if (e.status === 404) {
      throw Object.assign(
        new Error(
          `style_guide_missing: vault/${path} does not exist on the Hub. ` +
            `Create it with the project's voice rules before running agents for ${project}.`
        ),
        { code: 'STYLE_GUIDE_MISSING', project, path, cause: e }
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
