/**
 * GitHub Contents API: commit an image file to a user's backup repo (Phase 18D).
 * Returns the raw.githubusercontent.com URL for embedding in notes.
 */

const GITHUB_API = 'https://api.github.com';

const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

const MAGIC_BYTES = {
  jpeg: [0xFF, 0xD8, 0xFF],
  png: [0x89, 0x50, 0x4E, 0x47],
  gif_87a: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
  gif_89a: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  webp_riff: [0x52, 0x49, 0x46, 0x46],
};

/**
 * Parse owner/repo from a GitHub remote URL or short slug.
 * Supports:
 *   https://github.com/user/repo
 *   https://github.com/user/repo.git
 *   git@github.com:user/repo.git
 *   user/repo  (short "owner/repo" format stored by the bridge)
 * @param {string} repoUrl
 * @returns {{ owner: string, repo: string }}
 */
export function parseGitHubRepoUrl(repoUrl) {
  if (!repoUrl || typeof repoUrl !== 'string') {
    throw new Error('repoUrl is required');
  }
  const cleaned = repoUrl.trim().replace(/\/+$/, '');

  // Full URL: https://github.com/user/repo[.git]
  // SSH:     git@github.com:user/repo[.git]
  const fullMatch = cleaned.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (fullMatch) {
    return { owner: fullMatch[1], repo: fullMatch[2] };
  }

  // Short slug: owner/repo[.git]
  const shortMatch = cleaned.match(/^([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (shortMatch) {
    return { owner: shortMatch[1], repo: shortMatch[2] };
  }

  throw new Error(`Cannot parse GitHub owner/repo from URL: ${repoUrl}`);
}

/**
 * Validate image file extension.
 * @param {string} filename
 * @returns {string} normalized extension (lowercase, without dot)
 */
export function validateImageExtension(filename) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('Filename is required');
  }
  const ext = filename.split('.').pop().toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(`File extension .${ext} is not allowed. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`);
  }
  return ext;
}

/**
 * Validate file content matches its declared extension by checking magic bytes.
 * @param {Buffer} buffer
 * @param {string} ext - expected extension (jpg, png, gif, webp)
 * @returns {boolean}
 */
export function validateMagicBytes(buffer, ext) {
  if (!buffer || buffer.length < 4) return false;

  const matches = (signature) =>
    signature.every((byte, i) => buffer[i] === byte);

  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return matches(MAGIC_BYTES.jpeg);
    case 'png':
      return matches(MAGIC_BYTES.png);
    case 'gif':
      return matches(MAGIC_BYTES.gif_87a) || matches(MAGIC_BYTES.gif_89a);
    case 'webp':
      if (!matches(MAGIC_BYTES.webp_riff)) return false;
      return buffer.length >= 12 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 &&
        buffer[10] === 0x42 && buffer[11] === 0x50;
    default:
      return false;
  }
}

/**
 * Fetch the default branch and privacy status of the repo.
 * @param {string} accessToken
 * @param {string} owner
 * @param {string} repo
 * @returns {Promise<{ branch: string, isPrivate: boolean }>}
 */
async function getDefaultBranch(accessToken, owner, repo) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `token ${accessToken}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Knowtation-Hub/1.0',
    },
  });
  if (res.status === 404) {
    throw new Error(`Repository ${owner}/${repo} not found. Check the Git remote URL in Settings → Backup.`);
  }
  if (res.status === 403 || res.status === 401) {
    throw new Error('GitHub token lacks repository access. Reconnect GitHub in Settings → Backup.');
  }
  if (!res.ok) {
    throw new Error(`GitHub API error: HTTP ${res.status}`);
  }
  const data = await res.json();
  return { branch: data.default_branch || 'main', isPrivate: data.private === true };
}

/**
 * Get the SHA of an existing file (needed for updates).
 * @returns {Promise<string|null>} SHA or null if file doesn't exist
 */
async function getExistingFileSha(accessToken, owner, repo, filePath, branch) {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`,
    {
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Knowtation-Hub/1.0',
      },
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const data = await res.json();
  return data.sha || null;
}

/**
 * Commit an image file to a GitHub repository via the Contents API.
 * @param {{ accessToken: string, repoUrl: string, filePath: string, fileBuffer: Buffer, commitMessage?: string }} opts
 * @returns {Promise<{ url: string, sha: string, htmlUrl: string, isPrivate: boolean }>}
 */
export async function commitImageToRepo({ accessToken, repoUrl, filePath, fileBuffer, commitMessage }) {
  if (!accessToken) throw new Error('GitHub access token is required');
  if (!repoUrl) throw new Error('GitHub repo URL is required');
  if (!filePath) throw new Error('filePath is required');
  if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) throw new Error('fileBuffer (Buffer) is required');

  const { owner, repo } = parseGitHubRepoUrl(repoUrl);
  const { branch, isPrivate } = await getDefaultBranch(accessToken, owner, repo);

  const content = fileBuffer.toString('base64');
  const message = commitMessage || `Add image: ${filePath.split('/').pop()}`;

  const body = { message, content, branch };

  const existingSha = await getExistingFileSha(accessToken, owner, repo, filePath, branch);
  if (existingSha) {
    body.sha = existingSha;
  }

  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'Knowtation-Hub/1.0',
      },
      body: JSON.stringify(body),
    },
  );

  if (res.status === 422 && !existingSha) {
    const sha = await getExistingFileSha(accessToken, owner, repo, filePath, branch);
    if (sha) {
      body.sha = sha;
      const retry = await fetch(
        `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURIComponent(filePath)}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `token ${accessToken}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'Knowtation-Hub/1.0',
          },
          body: JSON.stringify(body),
        },
      );
      if (!retry.ok) {
        const errBody = await retry.text().catch(() => '');
        throw new Error(`GitHub API error on retry: HTTP ${retry.status} ${errBody}`);
      }
      const retryData = await retry.json();
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
      return { url: rawUrl, sha: retryData.content?.sha || '', htmlUrl: retryData.content?.html_url || '', isPrivate };
    }
  }

  if (res.status === 403 || res.status === 401) {
    throw new Error('GitHub token lacks permission to write to this repository. Reconnect GitHub with repo scope.');
  }
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`GitHub API error: HTTP ${res.status} ${errBody}`);
  }

  const data = await res.json();
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  return { url: rawUrl, sha: data.content?.sha || '', htmlUrl: data.content?.html_url || '', isPrivate };
}

export { ALLOWED_EXTENSIONS };
