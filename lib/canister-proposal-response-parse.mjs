const PROPOSAL_PREVIEW_MAX = 4000;

/**
 * Parse GET /api/v1/proposals/:id body. The canister embeds `suggested_labels` and
 * `assistant_suggested_frontmatter` as raw JSON fragments; corrupted stable data can yield invalid overall JSON.
 * On parse failure, return a safe object so backups still complete.
 *
 * @param {string} proposalId
 * @param {string} responseText
 * @param {Record<string, unknown>} [listStub] — row from GET /proposals list
 * @returns {Record<string, unknown>}
 */
export function parseCanisterProposalGetBody(proposalId, responseText, listStub = {}) {
  try {
    return JSON.parse(responseText);
  } catch {
    return {
      proposal_id: proposalId,
      path: typeof listStub.path === 'string' ? listStub.path : '',
      status: typeof listStub.status === 'string' ? listStub.status : '',
      vault_id: typeof listStub.vault_id === 'string' ? listStub.vault_id : '',
      _knowtation_backup_json_unparseable: true,
      _knowtation_backup_upstream_preview: responseText.slice(0, PROPOSAL_PREVIEW_MAX),
    };
  }
}
