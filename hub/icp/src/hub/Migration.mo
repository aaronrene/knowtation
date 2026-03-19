/**
 * Stable-memory upgrade: mainnet hub was deployed with ProposalRecord without
 * `base_state_id` and `external_ref` (Option B). This migration maps V0 → current shape.
 * See https://internetcomputer.org/docs/motoko/fundamentals/actors/compatibility
 */
import Array "mo:base/Array";
import Text "mo:base/Text";

module Migration {
  public type ProposalRecordV0 = {
    proposal_id : Text;
    path : Text;
    status : Text;
    body : Text;
    frontmatter : Text;
    intent : Text;
    created_at : Text;
    updated_at : Text;
  };

  public type StableStorageV0 = {
    vaultEntries : [(Text, [(Text, (Text, Text))])];
    proposalEntries : [(Text, [ProposalRecordV0])];
  };

  public type ProposalRecord = {
    proposal_id : Text;
    path : Text;
    status : Text;
    body : Text;
    frontmatter : Text;
    intent : Text;
    base_state_id : Text;
    external_ref : Text;
    created_at : Text;
    updated_at : Text;
  };

  public type StableStorage = {
    vaultEntries : [(Text, [(Text, (Text, Text))])];
    proposalEntries : [(Text, [ProposalRecord])];
  };

  public func migration(old : { var storage : StableStorageV0 }) : { var storage : StableStorage } {
    {
      var storage = {
        vaultEntries = old.storage.vaultEntries;
        proposalEntries = Array.map<(Text, [ProposalRecordV0]), (Text, [ProposalRecord])>(
          old.storage.proposalEntries,
          func (entry : (Text, [ProposalRecordV0])) : (Text, [ProposalRecord]) {
            (
              entry.0,
              Array.map<ProposalRecordV0, ProposalRecord>(
                entry.1,
                func (p : ProposalRecordV0) : ProposalRecord {
                  {
                    proposal_id = p.proposal_id;
                    path = p.path;
                    status = p.status;
                    body = p.body;
                    frontmatter = p.frontmatter;
                    intent = p.intent;
                    base_state_id = "";
                    external_ref = "";
                    created_at = p.created_at;
                    updated_at = p.updated_at;
                  };
                },
              ),
            )
          },
        );
      };
    };
  };
}
