/**
 * Stable-memory upgrade: V0 = one note map per user (vaultEntries 2-tuple).
 * V1 = notes keyed by (userId, vaultId, path); proposals carry vault_id; billing fields reserved per HOSTED-STORAGE-BILLING-ROADMAP.
 * V2 = ProposalRecord gains human evaluation fields (Text; checklist JSON in evaluation_checklist).
 * V3 = ProposalRecord gains review_queue, review_severity, auto_flag_reasons_json, review_hints* (Text).
 * V4 = ProposalRecord gains assistant_notes, assistant_model, assistant_at, suggested_labels_json (LLM Enrich).
 * V5 = ProposalRecord gains assistant_suggested_frontmatter_json (structured Enrich metadata).
 * Actor upgrade hook: after mainnet has run **one** V4→V5 deploy, stable storage is `StableStorage` (V5). The hook is **identity** on `StableStorage` so repeat deploys succeed. Canisters still on `StableStorageV4` must install **once** a WASM whose `migration` input is `StableStorageV4` (see git history before identity migration), then upgrade to this tree. Canisters still on `StableStorageBeforeEnrich` need the V4 migration path first (intermediate release).
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

  /// Proposals as persisted before evaluation fields (mainnet V1).
  public type ProposalRecordV1 = {
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

  public type StableStorageV1 = {
    vaultEntries : [(Text, Text, [(Text, (Text, Text))])];
    proposalEntries : [(Text, [ProposalRecordV1])];
    billingByUser : [(Text, BillingRecord)];
  };

  /// Proposals as persisted before review-queue / auto-flag / LLM hints (pre-V3 upgrade).
  public type ProposalRecordV2 = {
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
    evaluation_status : Text;
    evaluation_grade : Text;
    evaluation_checklist : Text;
    evaluation_comment : Text;
    evaluated_by : Text;
    evaluated_at : Text;
    evaluation_waiver_json : Text;
  };

  public type StableStorageV2 = {
    vaultEntries : [(Text, Text, [(Text, (Text, Text))])];
    proposalEntries : [(Text, [ProposalRecordV2])];
    billingByUser : [(Text, BillingRecord)];
  };

  /// Proposals as persisted before LLM Enrich fields (pre-V4 upgrade).
  public type ProposalRecordBeforeEnrich = {
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
    evaluation_status : Text;
    evaluation_grade : Text;
    evaluation_checklist : Text;
    evaluation_comment : Text;
    evaluated_by : Text;
    evaluated_at : Text;
    evaluation_waiver_json : Text;
    review_queue : Text;
    review_severity : Text;
    auto_flag_reasons_json : Text;
    review_hints : Text;
    review_hints_at : Text;
    review_hints_model : Text;
  };

  /// Proposals as persisted after V4 enrich, before V5 suggested frontmatter JSON.
  public type ProposalRecordV4 = {
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
    evaluation_status : Text;
    evaluation_grade : Text;
    evaluation_checklist : Text;
    evaluation_comment : Text;
    evaluated_by : Text;
    evaluated_at : Text;
    evaluation_waiver_json : Text;
    review_queue : Text;
    review_severity : Text;
    auto_flag_reasons_json : Text;
    review_hints : Text;
    review_hints_at : Text;
    review_hints_model : Text;
    assistant_notes : Text;
    assistant_model : Text;
    assistant_at : Text;
    suggested_labels_json : Text;
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
    evaluation_status : Text;
    evaluation_grade : Text;
    evaluation_checklist : Text;
    evaluation_comment : Text;
    evaluated_by : Text;
    evaluated_at : Text;
    evaluation_waiver_json : Text;
    review_queue : Text;
    review_severity : Text;
    auto_flag_reasons_json : Text;
    review_hints : Text;
    review_hints_at : Text;
    review_hints_model : Text;
    assistant_notes : Text;
    assistant_model : Text;
    assistant_at : Text;
    suggested_labels_json : Text;
    assistant_suggested_frontmatter_json : Text;
  };

  public type StableStorageBeforeEnrich = {
    vaultEntries : [(Text, Text, [(Text, (Text, Text))])];
    proposalEntries : [(Text, [ProposalRecordBeforeEnrich])];
    billingByUser : [(Text, BillingRecord)];
  };

  public type StableStorageV4 = {
    vaultEntries : [(Text, Text, [(Text, (Text, Text))])];
    proposalEntries : [(Text, [ProposalRecordV4])];
    billingByUser : [(Text, BillingRecord)];
  };

  public type StableStorage = {
    vaultEntries : [(Text, Text, [(Text, (Text, Text))])];
    proposalEntries : [(Text, [ProposalRecord])];
    billingByUser : [(Text, BillingRecord)];
  };

  func _proposalBeforeEnrichToCurrent(p : ProposalRecordBeforeEnrich) : ProposalRecord {
    {
      proposal_id = p.proposal_id;
      path = p.path;
      status = p.status;
      body = p.body;
      frontmatter = p.frontmatter;
      intent = p.intent;
      base_state_id = p.base_state_id;
      external_ref = p.external_ref;
      vault_id = p.vault_id;
      created_at = p.created_at;
      updated_at = p.updated_at;
      evaluation_status = p.evaluation_status;
      evaluation_grade = p.evaluation_grade;
      evaluation_checklist = p.evaluation_checklist;
      evaluation_comment = p.evaluation_comment;
      evaluated_by = p.evaluated_by;
      evaluated_at = p.evaluated_at;
      evaluation_waiver_json = p.evaluation_waiver_json;
      review_queue = p.review_queue;
      review_severity = p.review_severity;
      auto_flag_reasons_json = p.auto_flag_reasons_json;
      review_hints = p.review_hints;
      review_hints_at = p.review_hints_at;
      review_hints_model = p.review_hints_model;
      assistant_notes = "";
      assistant_model = "";
      assistant_at = "";
      suggested_labels_json = "[]";
      assistant_suggested_frontmatter_json = "{}";
    };
  };

  /// Historical V4→V5 row map; kept for docs and one-off tooling. Actor hook uses identity on `StableStorage` once V5 is live.
  func _proposalV4ToV5(p : ProposalRecordV4) : ProposalRecord {
    {
      proposal_id = p.proposal_id;
      path = p.path;
      status = p.status;
      body = p.body;
      frontmatter = p.frontmatter;
      intent = p.intent;
      base_state_id = p.base_state_id;
      external_ref = p.external_ref;
      vault_id = p.vault_id;
      created_at = p.created_at;
      updated_at = p.updated_at;
      evaluation_status = p.evaluation_status;
      evaluation_grade = p.evaluation_grade;
      evaluation_checklist = p.evaluation_checklist;
      evaluation_comment = p.evaluation_comment;
      evaluated_by = p.evaluated_by;
      evaluated_at = p.evaluated_at;
      evaluation_waiver_json = p.evaluation_waiver_json;
      review_queue = p.review_queue;
      review_severity = p.review_severity;
      auto_flag_reasons_json = p.auto_flag_reasons_json;
      review_hints = p.review_hints;
      review_hints_at = p.review_hints_at;
      review_hints_model = p.review_hints_model;
      assistant_notes = p.assistant_notes;
      assistant_model = p.assistant_model;
      assistant_at = p.assistant_at;
      suggested_labels_json = p.suggested_labels_json;
      assistant_suggested_frontmatter_json = "{}";
    };
  };

  func v0ToProposalV1(p : ProposalRecordV0) : ProposalRecordV1 {
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

  func v1ToV2Eval(p : ProposalRecordV1) : ProposalRecordV2 {
    {
      proposal_id = p.proposal_id;
      path = p.path;
      status = p.status;
      body = p.body;
      frontmatter = p.frontmatter;
      intent = p.intent;
      base_state_id = p.base_state_id;
      external_ref = p.external_ref;
      vault_id = p.vault_id;
      created_at = p.created_at;
      updated_at = p.updated_at;
      evaluation_status = "";
      evaluation_grade = "";
      evaluation_checklist = "";
      evaluation_comment = "";
      evaluated_by = "";
      evaluated_at = "";
      evaluation_waiver_json = "";
    };
  };

  /// One-time V0→V1 transform (Phase 15.1). **Not** the actor upgrade hook: mainnet stable is already V1.
  /// If you still have a V0 canister, deploy an older release that used `migration` from V0 first, or reinstall.
  public func migrateFromV0ToV1(old : { var storage : StableStorageV0 }) : { var storage : StableStorageV1 } {
    {
      var storage = {
        vaultEntries = Array.map<(Text, [(Text, (Text, Text))]), (Text, Text, [(Text, (Text, Text))])>(
          old.storage.vaultEntries,
          func(entry : (Text, [(Text, (Text, Text))])) : (Text, Text, [(Text, (Text, Text))]) {
            (entry.0, "default", entry.1);
          },
        );
        proposalEntries = Array.map<(Text, [ProposalRecordV0]), (Text, [ProposalRecordV1])>(
          old.storage.proposalEntries,
          func(e : (Text, [ProposalRecordV0])) : (Text, [ProposalRecordV1]) {
            (e.0, Array.map<ProposalRecordV0, ProposalRecordV1>(e.1, v0ToProposalV1));
          },
        );
        billingByUser = [];
      };
    };
  };

  /// V1 → V2eval (offline / historical): add evaluation Text fields. Not used as the actor hook once mainnet is V2.
  public func migrateFromV1ToV2Eval(old : { var storage : StableStorageV1 }) : { var storage : StableStorageV2 } {
    {
      var storage = {
        vaultEntries = old.storage.vaultEntries;
        billingByUser = old.storage.billingByUser;
        proposalEntries = Array.map<(Text, [ProposalRecordV1]), (Text, [ProposalRecordV2])>(
          old.storage.proposalEntries,
          func(e : (Text, [ProposalRecordV1])) : (Text, [ProposalRecordV2]) {
            (e.0, Array.map<ProposalRecordV1, ProposalRecordV2>(e.1, v1ToV2Eval));
          },
        );
      };
    };
  };

  /// Actor upgrade hook: input type must match **current** on-chain `storage` before this WASM installs.
  /// Identity on `StableStorage` (V5 layout) after the one-time V4→V5 upgrade has run on a canister.
  public func migration(old : { var storage : StableStorage }) : { var storage : StableStorage } {
    old
  }
}
