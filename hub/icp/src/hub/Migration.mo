/**
 * Stable-memory upgrade: V0 = one note map per user (vaultEntries 2-tuple).
 * V1 = notes keyed by (userId, vaultId, path); proposals carry vault_id; billing fields reserved per HOSTED-STORAGE-BILLING-ROADMAP.
 * See https://internetcomputer.org/docs/motoko/fundamentals/actors/compatibility
 */
import Array "mo:base/Array";

module Migration {
  /// Shape persisted before Phase 15.1 (hosted multi-vault + billing reservation).
  public type ProposalRecordV0 = {
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

  public type StableStorageV0 = {
    vaultEntries : [(Text, [(Text, (Text, Text))])];
    proposalEntries : [(Text, [ProposalRecordV0])];
  };

  /// Reserved for Phase 16; mirrored from gateway when needed. Defaults on migration: beta tier, zero balances.
  public type BillingRecord = {
    tier : Text;
    stripe_customer_id : Text;
    stripe_subscription_id : Text;
    period_start : Text;
    period_end : Text;
    monthly_included_cents : Nat;
    monthly_used_cents : Nat;
    addon_cents : Nat;
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
    vault_id : Text;
    created_at : Text;
    updated_at : Text;
  };

  public type StableStorage = {
    vaultEntries : [(Text, Text, [(Text, (Text, Text))])];
    proposalEntries : [(Text, [ProposalRecord])];
    billingByUser : [(Text, BillingRecord)];
  };

  func v0ToProposal(p : ProposalRecordV0) : ProposalRecord {
    {
      proposal_id = p.proposal_id;
      path = p.path;
      status = p.status;
      body = p.body;
      frontmatter = p.frontmatter;
      intent = p.intent;
      base_state_id = p.base_state_id;
      external_ref = p.external_ref;
      vault_id = "default";
      created_at = p.created_at;
      updated_at = p.updated_at;
    };
  };

  public func migration(old : { var storage : StableStorageV0 }) : { var storage : StableStorage } {
    {
      var storage = {
        vaultEntries = Array.map<(Text, [(Text, (Text, Text))]), (Text, Text, [(Text, (Text, Text))])>(
          old.storage.vaultEntries,
          func(entry : (Text, [(Text, (Text, Text))])) : (Text, Text, [(Text, (Text, Text))]) {
            (entry.0, "default", entry.1);
          },
        );
        proposalEntries = Array.map<(Text, [ProposalRecordV0]), (Text, [ProposalRecord])>(
          old.storage.proposalEntries,
          func(e : (Text, [ProposalRecordV0])) : (Text, [ProposalRecord]) {
            (
              e.0,
              Array.map<ProposalRecordV0, ProposalRecord>(e.1, v0ToProposal),
            );
          },
        );
        billingByUser = [];
      };
    };
  };
}
