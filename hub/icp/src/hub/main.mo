/**
 * Knowtation Hub canister — minimal Hub API (vault + proposals) for ICP.
 * Implements GET /health, GET/POST /api/v1/notes, GET /api/v1/notes/:path, GET/POST /api/v1/proposals, approve, discard.
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
import Option "mo:base/Option";
import Text "mo:base/Text";
import Time "mo:base/Time";

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
type ProposalRecord = {
  proposal_id : Text;
  path : Text;
  status : Text;
  body : Text;
  frontmatter : Text;
  intent : Text;
  created_at : Text;
  updated_at : Text;
};

// Single stable var (avoids DFX 0.30.2 parser bug with consecutive "stable var" lines)
type StableStorage = {
  vaultEntries : [(Text, [(Text, (Text, Text))])];
  proposalEntries : [(Text, [ProposalRecord])];
};
var storage : StableStorage = { vaultEntries = []; proposalEntries = [] };

transient var vaults = HashMap.HashMap<Text, HashMap.HashMap<Text, (Text, Text)>>(10, Text.equal, Text.hash);
transient var proposals = HashMap.HashMap<Text, [ProposalRecord]>(10, Text.equal, Text.hash);

func loadStable() {
  for ((uid, entries) in Array.vals(storage.vaultEntries)) {
    let m = HashMap.HashMap<Text, (Text, Text)>(10, Text.equal, Text.hash);
    for ((path, fmBody) in Array.vals(entries)) {
      m.put(path, fmBody);
    };
    vaults.put(uid, m);
  };
  for ((uid, list) in Array.vals(storage.proposalEntries)) {
    proposals.put(uid, list);
  };
};

func saveStable() {
  storage := {
    vaultEntries = Iter.toArray(Iter.map<((Text, HashMap.HashMap<Text, (Text, Text)>)), (Text, [(Text, (Text, Text))])>(vaults.entries(), func((uid, m) : (Text, HashMap.HashMap<Text, (Text, Text)>)) : (Text, [(Text, (Text, Text))]) {
      (uid, Iter.toArray(m.entries()))
    }));
    proposalEntries = Iter.toArray(Iter.map<((Text, [ProposalRecord])), (Text, [ProposalRecord])>(proposals.entries(), func((uid, list) : (Text, [ProposalRecord])) : (Text, [ProposalRecord]) {
      (uid, list)
    }));
  };
};

loadStable();

func charToLower(c : Char) : Char {
  if (c >= 'A' and c <= 'Z') { Char.fromNat32(Char.toNat32(c) + 32) } else { c }
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

func corsHeaders() : [Header] {
  [
    ("Access-Control-Allow-Origin", "*"),
    ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
    ("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Vault-Id, X-User-Id, X-Test-User"),
    ("Content-Type", "application/json"),
  ];
};

func jsonBody(s : Text) : Blob { Text.encodeUtf8(s) };

func parsePath(url : Text) : (Text, Text) {
  let pathParts = Iter.toArray(Text.split(url, #char '?'));
  let path = if (pathParts.size() > 0) { pathParts[0] } else { url };
  if (path == "/health" or path == "/health/") {
    ("health", "");
  } else if (Text.startsWith(path, #text "/api/v1/notes/")) {
    let suffix = Text.trimStart(path, #text "/api/v1/notes/");
    ("note", suffix);
  } else if (path == "/api/v1/notes" or path == "/api/v1/notes/") {
    ("notes", "");
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

func getVault(uid : Text) : HashMap.HashMap<Text, (Text, Text)> {
  switch (vaults.get(uid)) {
    case (?m) { m };
    case null {
      let m = HashMap.HashMap<Text, (Text, Text)>(10, Text.equal, Text.hash);
      vaults.put(uid, m);
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

public query func http_request(req : HttpRequest) : async HttpResponse {
  let uid = userId(req);
  let (pathKind, pathArg) = parsePath(req.url);

  if (pathKind == "health") {
    return {
      status_code = 200;
      headers = corsHeaders();
      body = jsonBody("{\"ok\":true}");
      streaming_strategy = null;
    };
  };

  if (pathKind == "export" and req.method == "GET") {
    let vault = getVault(uid);
    let entries = Iter.toArray(vault.entries());
    var items : Text = "";
    for ((p, fmBody) in Array.vals(entries)) {
      if (items != "") { items := items # "," };
      items := items # "{\"path\":\"" # escapeJson(p) # "\",\"frontmatter\":\"" # escapeJson(fmBody.0) # "\",\"body\":\"" # escapeJson(fmBody.1) # "\"}";
    };
    let json = "{\"notes\":[" # items # "]}";
    return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null };
  };

  if (pathKind == "notes" and req.method == "GET") {
    let vault = getVault(uid);
    let entries = Iter.toArray(vault.entries());
    var items : Text = "";
    for ((p, fmBody) in Array.vals(entries)) {
      if (items != "") { items := items # "," };
      items := items # "{\"path\":\"" # escapeJson(p) # "\",\"frontmatter\":{},\"body\":\"" # escapeJson(fmBody.1) # "\"}";
    };
    let json = "{\"notes\":[" # items # "],\"total\":" # Nat.toText(entries.size()) # "}";
    return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null };
  };

  if (pathKind == "note" and req.method == "GET") {
    let vault = getVault(uid);
    switch (vault.get(pathArg)) {
      case (?fmBody) {
        let json = "{\"path\":\"" # escapeJson(pathArg) # "\",\"frontmatter\":{},\"body\":\"" # escapeJson(fmBody.1) # "\"}";
        return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null };
      };
      case null {
        return { status_code = 404; headers = corsHeaders(); body = jsonBody("{\"error\":\"Not found\",\"code\":\"NOT_FOUND\"}"); streaming_strategy = null };
      };
    };
  };

  if (pathKind == "proposals" and req.method == "GET") {
    let list = getProposalsList(uid);
    var items : Text = "";
    for (p in Array.vals(list)) {
      if (items != "") { items := items # "," };
      items := items # "{\"proposal_id\":\"" # escapeJson(p.proposal_id) # "\",\"path\":\"" # escapeJson(p.path) # "\",\"status\":\"" # escapeJson(p.status) # "\",\"created_at\":\"" # escapeJson(p.created_at) # "\",\"updated_at\":\"" # escapeJson(p.updated_at) # "\"}";
    };
    let json = "{\"proposals\":[" # items # "],\"total\":" # Nat.toText(list.size()) # "}";
    return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null };
  };

  if (pathKind == "proposal" and req.method == "GET") {
    let list = getProposalsList(uid);
    switch (Array.find<ProposalRecord>(list, func(p : ProposalRecord) : Bool { p.proposal_id == pathArg })) {
      case (?p) {
        let json = "{\"proposal_id\":\"" # escapeJson(p.proposal_id) # "\",\"path\":\"" # escapeJson(p.path) # "\",\"status\":\"" # escapeJson(p.status) # "\",\"body\":\"" # escapeJson(p.body) # "\",\"created_at\":\"" # escapeJson(p.created_at) # "\",\"updated_at\":\"" # escapeJson(p.updated_at) # "\"}";
        return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null };
      };
      case null {
        return { status_code = 404; headers = corsHeaders(); body = jsonBody("{\"error\":\"Proposal not found\",\"code\":\"NOT_FOUND\"}"); streaming_strategy = null };
      };
    };
  };

  if (req.method == "OPTIONS") {
    return { status_code = 204; headers = corsHeaders(); body = jsonBody(""); streaming_strategy = null };
  };

  return { status_code = 404; headers = corsHeaders(); body = jsonBody("{\"error\":\"Not found\",\"code\":\"NOT_FOUND\"}"); streaming_strategy = null };
};

public func http_request_update(req : HttpRequest) : async HttpResponse {
  let uid = userId(req);
  let (pathKind, pathArg) = parsePath(req.url);
  let bodyText = if (req.body.size() > 0) { Option.get(Text.decodeUtf8(req.body), "{}") } else { "{}" };

  if (pathKind == "notes" and req.method == "POST") {
    let vault = getVault(uid);
    let path = if (pathArg.size() > 0) { pathArg } else { Option.get(extractJsonString(bodyText, "path"), "") };
    if (path.size() == 0) {
      return { status_code = 400; headers = corsHeaders(); body = jsonBody("{\"error\":\"path required\",\"code\":\"BAD_REQUEST\"}"); streaming_strategy = null };
    };
    let noteBody = Option.get(extractJsonString(bodyText, "body"), bodyText);
    let frontmatter = Option.get(extractJsonString(bodyText, "frontmatter"), "{}");
    vault.put(path, (frontmatter, noteBody));
    saveStable();
    return { status_code = 200; headers = corsHeaders(); body = jsonBody("{\"path\":\"" # escapeJson(path) # "\",\"written\":true}"); streaming_strategy = null };
  };

  if (pathKind == "proposals" and req.method == "POST") {
    let path = Option.get(extractJsonString(bodyText, "path"), "inbox/proposal-" # Int.toText(Time.now()) # ".md");
    let body = Option.get(extractJsonString(bodyText, "body"), "");
    let intent = Option.get(extractJsonString(bodyText, "intent"), "");
    let frontmatter = Option.get(extractJsonString(bodyText, "frontmatter"), "{}");
    let proposal_id = "prop-" # Int.toText(Time.now());
    let now = "2025-01-01T00:00:00.000Z";
    var list = getProposalsList(uid);
    let newP : ProposalRecord = { proposal_id; path; status = "proposed"; body; frontmatter; intent; created_at = now; updated_at = now };
    list := Array.append(list, [newP]);
    setProposalsList(uid, list);
    saveStable();
    let json = "{\"proposal_id\":\"" # escapeJson(proposal_id) # "\",\"path\":\"" # escapeJson(path) # "\",\"status\":\"proposed\"}";
    return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null };
  };

  if (pathKind == "approve" and req.method == "POST") {
    var list = getProposalsList(uid);
    switch (Array.find<ProposalRecord>(list, func(p : ProposalRecord) : Bool { p.proposal_id == pathArg })) {
      case (?p) {
        let vault = getVault(uid);
        vault.put(p.path, (p.frontmatter, p.body));
        list := Array.map<ProposalRecord, ProposalRecord>(list, func(x : ProposalRecord) : ProposalRecord {
          if (x.proposal_id == pathArg) { { x with status = "approved"; updated_at = "2025-01-01T00:00:00.000Z" } } else { x }
        });
        setProposalsList(uid, list);
        saveStable();
        return { status_code = 200; headers = corsHeaders(); body = jsonBody("{\"proposal_id\":\"" # pathArg # "\",\"status\":\"approved\"}"); streaming_strategy = null };
      };
      case null {
        return { status_code = 404; headers = corsHeaders(); body = jsonBody("{\"error\":\"Proposal not found\",\"code\":\"NOT_FOUND\"}"); streaming_strategy = null };
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
    return { status_code = 200; headers = corsHeaders(); body = jsonBody("{\"proposal_id\":\"" # pathArg # "\",\"status\":\"discarded\"}"); streaming_strategy = null };
  };

  return { status_code = 404; headers = corsHeaders(); body = jsonBody("{\"error\":\"Not found\",\"code\":\"NOT_FOUND\"}"); streaming_strategy = null };
};

}
