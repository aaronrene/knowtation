/**
 * Knowtation Hub canister — minimal Hub API (vault + proposals) for ICP.
 * Phase 15.1: notes partitioned by (userId, vault_id); X-Vault-Id on requests (default vault id: default).
 * Implements GET /health, GET/POST /api/v1/notes, GET /api/v1/notes/:path, GET /api/v1/vaults, GET /api/v1/export,
 * GET/POST /api/v1/proposals, approve, discard.
 * Auth: for dev use X-Test-User or X-User-Id header; canister validates proof from gateway in production.
 * See docs/HUB-API.md and docs/CANISTER-AUTH-CONTRACT.md.
 */

import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Char "mo:base/Char";
import HashMap "mo:base/HashMap";
import Iter "mo:base/Iter";
import Int "mo:base/Int";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Option "mo:base/Option";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Migration "Migration";

(with migration = Migration.migration)
persistent actor Hub {

// --- HTTP types (IC gateway) ---
type Header = (Text, Text);
type HttpRequest = {
  method : Text;
  url : Text;
  headers : [Header];
  body : Blob;
};
type HttpResponse = {
  status_code : Nat16;
  headers : [Header];
  body : Blob;
  streaming_strategy : ?{
    #Callback : {
      callback : shared query (StreamingCallbackToken) -> async StreamingCallbackResponse;
      token : StreamingCallbackToken;
    };
  };
  /// When set to ?true, the ICP HTTP gateway re-invokes this request on http_request_update (required for POST mutations).
  upgrade : ?Bool;
};
type StreamingCallbackToken = {
  key : Text;
  content_encoding : Text;
  index : Nat;
  sha256 : ?Blob;
};
type StreamingCallbackResponse = {
  body : Blob;
  token : ?StreamingCallbackToken;
};

// --- Storage ---
type NoteContent = { path : Text; frontmatter : Text; body : Text };
type ProposalRecord = Migration.ProposalRecord;
type BillingRecord = Migration.BillingRecord;
type StableStorage = Migration.StableStorage;

var storage : StableStorage = { vaultEntries = []; proposalEntries = []; billingByUser = [] };

/// userId -> vaultId -> path -> (frontmatter, body)
transient var byUser = HashMap.HashMap<Text, HashMap.HashMap<Text, HashMap.HashMap<Text, (Text, Text)>>>(10, Text.equal, Text.hash);
transient var proposals = HashMap.HashMap<Text, [ProposalRecord]>(10, Text.equal, Text.hash);
transient var billingMap = HashMap.HashMap<Text, BillingRecord>(10, Text.equal, Text.hash);

func loadStable() {
  for ((uid, vaultId, entries) in Array.vals(storage.vaultEntries)) {
    let um = switch (byUser.get(uid)) {
      case (?m) { m };
      case null {
        let m = HashMap.HashMap<Text, HashMap.HashMap<Text, (Text, Text)>>(10, Text.equal, Text.hash);
        byUser.put(uid, m);
        m;
      };
    };
    let inner = switch (um.get(vaultId)) {
      case (?m) { m };
      case null {
        let m = HashMap.HashMap<Text, (Text, Text)>(10, Text.equal, Text.hash);
        um.put(vaultId, m);
        m;
      };
    };
    for ((path, fmBody) in Array.vals(entries)) {
      inner.put(path, fmBody);
    };
  };
  for ((uid, list) in Array.vals(storage.proposalEntries)) {
    proposals.put(uid, list);
  };
  for ((uid, b) in Array.vals(storage.billingByUser)) {
    billingMap.put(uid, b);
  };
};

func saveStable() {
  var vaultRows : [(Text, Text, [(Text, (Text, Text))])] = [];
  for ((uid, um) in byUser.entries()) {
    for ((vaultId, m) in um.entries()) {
      vaultRows := Array.append(vaultRows, [(uid, vaultId, Iter.toArray(m.entries()))]);
    };
  };
  storage := {
    vaultEntries = vaultRows;
    proposalEntries = Iter.toArray(
      Iter.map<((Text, [ProposalRecord])), (Text, [ProposalRecord])>(proposals.entries(), func((uid, list) : (Text, [ProposalRecord])) : (Text, [ProposalRecord]) {
        (uid, list);
      }),
    );
    billingByUser = Iter.toArray(
      Iter.map<((Text, BillingRecord)), (Text, BillingRecord)>(billingMap.entries(), func((uid, b) : (Text, BillingRecord)) : (Text, BillingRecord) {
        (uid, b);
      }),
    );
  };
};

loadStable();

func charToLower(c : Char) : Char {
  if (c >= 'A' and c <= 'Z') { Char.fromNat32(Char.toNat32(c) + 32) } else { c };
};
func getHeader(req : HttpRequest, name : Text) : ?Text {
  let lower = Text.map(name, charToLower);
  Array.find<Header>(req.headers, func(h : Header) : Bool { Text.map(h.0, charToLower) == lower })
  |> Option.map<Header, Text>(_, func(h : Header) : Text { h.1 });
};

func userId(req : HttpRequest) : Text {
  switch (getHeader(req, "X-User-Id")) {
    case (?id) { id };
    case null {
      switch (getHeader(req, "X-Test-User")) {
        case (?id) { id };
        case null { "default" };
      };
    };
  };
};

func isAsciiSpace(c : Char) : Bool {
  c == ' ' or c == '\t' or c == '\n' or c == '\r';
};

func isVaultIdChar(c : Char) : Bool {
  let n = Char.toNat32(c);
  (n >= 48 and n <= 57) or (n >= 65 and n <= 90) or (n >= 97 and n <= 122) or c == '_' or c == '-';
};

/// Align with hub/bridge sanitizeVaultId: [a-zA-Z0-9_-], max 64; invalid chars -> '_'.
func sanitizeVaultId(raw : Text) : Text {
  let chars = Text.toArray(raw);
  var out = "";
  var count : Nat = 0;
  var i : Nat = 0;
  while (i < chars.size() and count < 64) {
    let c = chars[i];
    if (isVaultIdChar(c)) {
      out := out # Char.toText(c);
    } else {
      out := out # "_";
    };
    count += 1;
    i += 1;
  };
  let t = Text.trim(out, #predicate isAsciiSpace);
  if (t.size() == 0) { "default" } else { t };
};

func vaultIdFromRequest(req : HttpRequest) : Text {
  switch (getHeader(req, "X-Vault-Id")) {
    case (?v) { sanitizeVaultId(Text.trim(v, #predicate isAsciiSpace)) };
    case null { "default" };
  };
};

func effectiveVaultId(stored : Text) : Text {
  let t = Text.trim(stored, #predicate isAsciiSpace);
  if (t.size() == 0) { "default" } else { t };
};

func corsHeaders() : [Header] {
  [
    ("Access-Control-Allow-Origin", "*"),
    ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
    ("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Vault-Id, X-User-Id, X-Test-User"),
    ("Content-Type", "application/json"),
  ];
};

func jsonBody(s : Text) : Blob { Text.encodeUtf8(s) };

func userVaultMap(uid : Text) : HashMap.HashMap<Text, HashMap.HashMap<Text, (Text, Text)>> {
  switch (byUser.get(uid)) {
    case (?m) { m };
    case null {
      let m = HashMap.HashMap<Text, HashMap.HashMap<Text, (Text, Text)>>(10, Text.equal, Text.hash);
      byUser.put(uid, m);
      m;
    };
  };
};

func getVault(uid : Text, vaultId : Text) : HashMap.HashMap<Text, (Text, Text)> {
  let um = userVaultMap(uid);
  switch (um.get(vaultId)) {
    case (?m) { m };
    case null {
      let m = HashMap.HashMap<Text, (Text, Text)>(10, Text.equal, Text.hash);
      um.put(vaultId, m);
      m;
    };
  };
};

func getProposalsList(uid : Text) : [ProposalRecord] {
  Option.get(proposals.get(uid), []);
};

func setProposalsList(uid : Text, list : [ProposalRecord]) {
  proposals.put(uid, list);
};

func proposalsForVault(uid : Text, reqVault : Text) : [ProposalRecord] {
  let eff = effectiveVaultId(reqVault);
  let list = getProposalsList(uid);
  Array.filter<ProposalRecord>(list, func(p : ProposalRecord) : Bool { effectiveVaultId(p.vault_id) == eff });
};

// Helpers for text slice and find (base library has no Text.sub / Text.find returning position).
func textSlice(t : Text, start : Nat, len : Nat) : Text {
  let arr = Text.toArray(t);
  var out = "";
  var i = start;
  var n : Nat = 0;
  while (n < len and i < arr.size()) {
    out := out # Text.fromChar(arr[i]);
    i += 1;
    n += 1;
  };
  out;
};
func textFind(t : Text, needle : Text) : ?Nat {
  var i : Nat = 0;
  let nsize = Text.size(needle);
  let tsize = Text.size(t);
  while (i + nsize <= tsize) {
    if (textSlice(t, i, nsize) == needle) { return ?i };
    i += 1;
  };
  null;
};

/// HTTP gateway may pass a full URL (e.g. https://<canister>.icp0.io/api/v1/notes); routing must use the path only.
func pathOnly(rawUrl : Text) : Text {
  let pathParts = Iter.toArray(Text.split(rawUrl, #char '?'));
  var path = if (pathParts.size() > 0) { pathParts[0] } else { rawUrl };
  switch (textFind(path, "://")) {
    case (?k) {
      let startAuth = k + 3;
      if (startAuth < Text.size(path)) {
        let afterLen = Text.size(path) - startAuth;
        let after = textSlice(path, startAuth, afterLen);
        switch (textFind(after, "/")) {
          case (?m) { path := textSlice(after, m, Text.size(after) - m) };
          case null { path := "/" };
        };
      } else {
        path := "/";
      };
    };
    case null {};
  };
  path;
};

func parsePath(url : Text) : (Text, Text) {
  let path = pathOnly(url);
  if (path == "/health" or path == "/health/") {
    ("health", "");
  } else if (Text.startsWith(path, #text "/api/v1/notes/")) {
    let suffix = Text.trimStart(path, #text "/api/v1/notes/");
    ("note", suffix);
  } else if (path == "/api/v1/notes" or path == "/api/v1/notes/") {
    ("notes", "");
  } else if (path == "/api/v1/vaults" or path == "/api/v1/vaults/") {
    ("vaults", "");
  } else if (Text.startsWith(path, #text "/api/v1/proposals/")) {
    let rest = Text.trimStart(path, #text "/api/v1/proposals/");
    let parts = Iter.toArray(Text.split(rest, #char '/'));
    if (parts.size() == 1) { ("proposal", parts[0]) }
    else if (parts.size() >= 2 and parts[1] == "approve") { ("approve", parts[0]) }
    else if (parts.size() >= 2 and parts[1] == "discard") { ("discard", parts[0]) }
    else { ("unknown", "") };
  } else if (path == "/api/v1/proposals" or path == "/api/v1/proposals/") {
    ("proposals", "");
  } else if (path == "/api/v1/export" or path == "/api/v1/export/") {
    ("export", "");
  } else { ("unknown", "") };
};

// Minimal JSON: extract string value for key (finds "\"key\":\"...\"").
func extractJsonString(body : Text, key : Text) : ?Text {
  let needle = "\"" # key # "\":\"";
  switch (textFind(body, needle)) {
    case null { null };
    case (?start) {
      var i = start + Text.size(needle);
      var out = "";
      while (i < Text.size(body)) {
        let c = textSlice(body, i, 1);
        if (c == "\\" and i + 1 < Text.size(body)) {
          out := out # textSlice(body, i, 2);
          i += 2;
        } else if (c == "\"") {
          return ?out;
        } else {
          out := out # c;
          i += 1;
        };
      };
      null;
    };
  };
};

/// Decode percent-encoded path segment (e.g. inbox%2Fnote.md -> inbox/note.md) so GET lookup matches POST-stored keys.
func decodePercentEncoded(s : Text) : Text {
  var out = "";
  var i : Nat = 0;
  while (i < Text.size(s)) {
    let c = textSlice(s, i, 1);
    if (c == "%" and i + 2 < Text.size(s)) {
      let h1 = textSlice(s, i + 1, 1);
      let h2 = textSlice(s, i + 2, 1);
      let n1 = charToHex(h1);
      let n2 = charToHex(h2);
      switch (n1, n2) {
        case (?a, ?b) {
          let code = a * 16 + b;
          out := out # Char.toText(Char.fromNat32(Nat32.fromNat(code)));
          i += 3;
        };
        case _ { out := out # c; i += 1 };
      };
    } else {
      out := out # c;
      i += 1;
    };
  };
  out;
};
func charToHex(c : Text) : ?Nat {
  if (Text.size(c) != 1) return null;
  switch (Text.toIter(c).next()) {
    case (?ch) {
      let n = Char.toNat32(ch);
      if (n >= 48 and n <= 57) return ?(Nat32.toNat(n - 48));
      if (n >= 65 and n <= 70) return ?(Nat32.toNat(n - 55));
      if (n >= 97 and n <= 102) return ?(Nat32.toNat(n - 87));
      null;
    };
    case null { null };
  };
};

func escapeJson(s : Text) : Text {
  var out = "";
  var i : Nat = 0;
  while (i < Text.size(s)) {
    let c = textSlice(s, i, 1);
    if (c == "\\") { out := out # "\\\\"; i += 1 }
    else if (c == "\"") { out := out # "\\\""; i += 1 }
    else if (c == "\n") { out := out # "\\n"; i += 1 }
    else if (c == "\r") { out := out # "\\r"; i += 1 }
    else if (c == "\t") { out := out # "\\t"; i += 1 }
    else { out := out # c; i += 1 };
  };
  out;
};

func vaultIdsForUser(uid : Text) : [Text] {
  switch (byUser.get(uid)) {
    case null { ["default"] };
    case (?um) {
      let keys = Iter.toArray(um.keys());
      if (keys.size() == 0) { ["default"] } else { keys };
    };
  };
};

func vaultListJson(uid : Text) : Text {
  let ids = vaultIdsForUser(uid);
  var items : Text = "";
  for (vid in Array.vals(ids)) {
    if (items != "") { items := items # "," };
    items := items # "{\"id\":\"" # escapeJson(vid) # "\",\"label\":\"" # escapeJson(vid) # "\"}";
  };
  "{\"vaults\":[" # items # "]}";
};

public query func http_request(req : HttpRequest) : async HttpResponse {
  let uid = userId(req);
  let vid = vaultIdFromRequest(req);
  let (pathKind, pathArg) = parsePath(req.url);

  if (pathKind == "health") {
    return {
      status_code = 200;
      headers = corsHeaders();
      body = jsonBody("{\"ok\":true}");
      streaming_strategy = null;
      upgrade = null;
    };
  };

  if (pathKind == "vaults" and req.method == "GET") {
    return {
      status_code = 200;
      headers = corsHeaders();
      body = jsonBody(vaultListJson(uid));
      streaming_strategy = null;
      upgrade = null;
    };
  };

  if (pathKind == "export" and req.method == "GET") {
    let vault = getVault(uid, vid);
    let entries = Iter.toArray(vault.entries());
    var items : Text = "";
    for ((p, fmBody) in Array.vals(entries)) {
      if (items != "") { items := items # "," };
      items := items # "{\"path\":\"" # escapeJson(p) # "\",\"frontmatter\":\"" # escapeJson(fmBody.0) # "\",\"body\":\"" # escapeJson(fmBody.1) # "\"}";
    };
    let json = "{\"notes\":[" # items # "]}";
    return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null; upgrade = null };
  };

  if (pathKind == "notes" and req.method == "GET") {
    let vault = getVault(uid, vid);
    let entries = Iter.toArray(vault.entries());
    var items : Text = "";
    for ((p, fmBody) in Array.vals(entries)) {
      if (items != "") { items := items # "," };
      items := items # "{\"path\":\"" # escapeJson(p) # "\",\"frontmatter\":{},\"body\":\"" # escapeJson(fmBody.1) # "\"}";
    };
    let json = "{\"notes\":[" # items # "],\"total\":" # Nat.toText(entries.size()) # "}";
    return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null; upgrade = null };
  };

  if (pathKind == "note" and req.method == "GET") {
    let pathDecoded = decodePercentEncoded(pathArg);
    let pathNormalized = if (Text.size(pathDecoded) > 0 and textSlice(pathDecoded, Text.size(pathDecoded) - 1, 1) == "/") {
      textSlice(pathDecoded, 0, Text.size(pathDecoded) - 1)
    } else {
      pathDecoded
    };
    let vault = getVault(uid, vid);
    switch (vault.get(pathNormalized)) {
      case (?fmBody) {
        let json = "{\"path\":\"" # escapeJson(pathNormalized) # "\",\"frontmatter\":{},\"body\":\"" # escapeJson(fmBody.1) # "\"}";
        return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null; upgrade = null };
      };
      case null {
        switch (vault.get(pathArg)) {
          case (?fmBody) {
            let json = "{\"path\":\"" # escapeJson(pathArg) # "\",\"frontmatter\":{},\"body\":\"" # escapeJson(fmBody.1) # "\"}";
            return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null; upgrade = null };
          };
          case null {
            return { status_code = 404; headers = corsHeaders(); body = jsonBody("{\"error\":\"Not found\",\"code\":\"NOT_FOUND\"}"); streaming_strategy = null; upgrade = null };
          };
        };
      };
    };
  };

  if (pathKind == "proposals" and req.method == "GET") {
    let list = proposalsForVault(uid, vid);
    var items : Text = "";
    for (p in Array.vals(list)) {
      if (items != "") { items := items # "," };
      items := items # "{\"proposal_id\":\"" # escapeJson(p.proposal_id) # "\",\"path\":\"" # escapeJson(p.path) # "\",\"status\":\"" # escapeJson(p.status) # "\",\"intent\":\"" # escapeJson(p.intent) # "\",\"base_state_id\":\"" # escapeJson(p.base_state_id) # "\",\"external_ref\":\"" # escapeJson(p.external_ref) # "\",\"vault_id\":\"" # escapeJson(effectiveVaultId(p.vault_id)) # "\",\"created_at\":\"" # escapeJson(p.created_at) # "\",\"updated_at\":\"" # escapeJson(p.updated_at) # "\"}";
    };
    let json = "{\"proposals\":[" # items # "],\"total\":" # Nat.toText(list.size()) # "}";
    return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null; upgrade = null };
  };

  if (pathKind == "proposal" and req.method == "GET") {
    let list = proposalsForVault(uid, vid);
    switch (Array.find<ProposalRecord>(list, func(p : ProposalRecord) : Bool { p.proposal_id == pathArg })) {
      case (?p) {
        let json = "{\"proposal_id\":\"" # escapeJson(p.proposal_id) # "\",\"path\":\"" # escapeJson(p.path) # "\",\"status\":\"" # escapeJson(p.status) # "\",\"intent\":\"" # escapeJson(p.intent) # "\",\"base_state_id\":\"" # escapeJson(p.base_state_id) # "\",\"external_ref\":\"" # escapeJson(p.external_ref) # "\",\"vault_id\":\"" # escapeJson(effectiveVaultId(p.vault_id)) # "\",\"body\":\"" # escapeJson(p.body) # "\",\"frontmatter\":\"" # escapeJson(p.frontmatter) # "\",\"created_at\":\"" # escapeJson(p.created_at) # "\",\"updated_at\":\"" # escapeJson(p.updated_at) # "\"}";
        return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null; upgrade = null };
      };
      case null {
        return { status_code = 404; headers = corsHeaders(); body = jsonBody("{\"error\":\"Proposal not found\",\"code\":\"NOT_FOUND\"}"); streaming_strategy = null; upgrade = null };
      };
    };
  };

  // ICP HTTP gateway always invokes http_request (query) first. Mutating methods must return
  // upgrade = ?true so the gateway re-sends the same request to http_request_update (consensus).
  if (
    req.method == "POST" and (pathKind == "notes" or pathKind == "proposals" or pathKind == "approve" or pathKind == "discard")
  ) {
    return {
      status_code = 200;
      headers = [];
      body = Blob.fromArray([]);
      streaming_strategy = null;
      upgrade = ?true;
    };
  };

  if (req.method == "OPTIONS") {
    return { status_code = 204; headers = corsHeaders(); body = jsonBody(""); streaming_strategy = null; upgrade = null };
  };

  return { status_code = 404; headers = corsHeaders(); body = jsonBody("{\"error\":\"Not found\",\"code\":\"NOT_FOUND\"}"); streaming_strategy = null; upgrade = null };
};

public func http_request_update(req : HttpRequest) : async HttpResponse {
  let uid = userId(req);
  let vid = vaultIdFromRequest(req);
  let (pathKind, pathArg) = parsePath(req.url);
  let bodyText = if (req.body.size() > 0) { Option.get(Text.decodeUtf8(req.body), "{}") } else { "{}" };

  if (pathKind == "notes" and req.method == "POST") {
    let vault = getVault(uid, vid);
    let path = if (pathArg.size() > 0) { pathArg } else { Option.get(extractJsonString(bodyText, "path"), "") };
    if (path.size() == 0) {
      return { status_code = 400; headers = corsHeaders(); body = jsonBody("{\"error\":\"path required\",\"code\":\"BAD_REQUEST\"}"); streaming_strategy = null; upgrade = null };
    };
    let noteBody = Option.get(extractJsonString(bodyText, "body"), bodyText);
    let frontmatter = Option.get(extractJsonString(bodyText, "frontmatter"), "{}");
    vault.put(path, (frontmatter, noteBody));
    saveStable();
    return { status_code = 200; headers = corsHeaders(); body = jsonBody("{\"path\":\"" # escapeJson(path) # "\",\"written\":true}"); streaming_strategy = null; upgrade = null };
  };

  if (pathKind == "proposals" and req.method == "POST") {
    let path = Option.get(extractJsonString(bodyText, "path"), "inbox/proposal-" # Int.toText(Time.now()) # ".md");
    let body = Option.get(extractJsonString(bodyText, "body"), "");
    let intent = Option.get(extractJsonString(bodyText, "intent"), "");
    let frontmatter = Option.get(extractJsonString(bodyText, "frontmatter"), "{}");
    let base_state_id = Option.get(extractJsonString(bodyText, "base_state_id"), "");
    let external_ref = Option.get(extractJsonString(bodyText, "external_ref"), "");
    let proposal_id = "prop-" # Int.toText(Time.now());
    let now = "2025-01-01T00:00:00.000Z";
    var list = getProposalsList(uid);
    let newP : ProposalRecord = {
      proposal_id;
      path;
      status = "proposed";
      body;
      frontmatter;
      intent;
      base_state_id;
      external_ref;
      vault_id = vid;
      created_at = now;
      updated_at = now;
    };
    list := Array.append(list, [newP]);
    setProposalsList(uid, list);
    saveStable();
    let json = "{\"proposal_id\":\"" # escapeJson(proposal_id) # "\",\"path\":\"" # escapeJson(path) # "\",\"status\":\"proposed\"}";
    return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null; upgrade = null };
  };

  if (pathKind == "approve" and req.method == "POST") {
    var list = getProposalsList(uid);
    switch (Array.find<ProposalRecord>(list, func(p : ProposalRecord) : Bool { p.proposal_id == pathArg })) {
      case (?p) {
        let targetVid = effectiveVaultId(p.vault_id);
        let vault = getVault(uid, targetVid);
        vault.put(p.path, (p.frontmatter, p.body));
        list := Array.map<ProposalRecord, ProposalRecord>(list, func(x : ProposalRecord) : ProposalRecord {
          if (x.proposal_id == pathArg) { { x with status = "approved"; updated_at = "2025-01-01T00:00:00.000Z" } } else { x }
        });
        setProposalsList(uid, list);
        saveStable();
        return { status_code = 200; headers = corsHeaders(); body = jsonBody("{\"proposal_id\":\"" # pathArg # "\",\"status\":\"approved\"}"); streaming_strategy = null; upgrade = null };
      };
      case null {
        return { status_code = 404; headers = corsHeaders(); body = jsonBody("{\"error\":\"Proposal not found\",\"code\":\"NOT_FOUND\"}"); streaming_strategy = null; upgrade = null };
      };
    };
  };

  if (pathKind == "discard" and req.method == "POST") {
    var list = getProposalsList(uid);
    list := Array.map<ProposalRecord, ProposalRecord>(list, func(x : ProposalRecord) : ProposalRecord {
      if (x.proposal_id == pathArg) { { x with status = "discarded"; updated_at = "2025-01-01T00:00:00.000Z" } } else { x }
    });
    setProposalsList(uid, list);
    saveStable();
    return { status_code = 200; headers = corsHeaders(); body = jsonBody("{\"proposal_id\":\"" # pathArg # "\",\"status\":\"discarded\"}"); streaming_strategy = null; upgrade = null };
  };

  return { status_code = 404; headers = corsHeaders(); body = jsonBody("{\"error\":\"Not found\",\"code\":\"NOT_FOUND\"}"); streaming_strategy = null; upgrade = null };
};

}
