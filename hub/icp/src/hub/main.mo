/**
 * Knowtation Hub canister — minimal Hub API (vault + proposals) for ICP.
 * Phase 15.1: notes partitioned by (userId, vault_id); X-Vault-Id on requests (default vault id: default).
 * Implements GET /health, GET/POST /api/v1/notes, DELETE /api/v1/notes/:path, POST /api/v1/notes/batch, POST /api/v1/notes/delete-by-prefix, GET /api/v1/notes/:path, GET /api/v1/vaults, DELETE /api/v1/vaults/:id (non-default), GET /api/v1/export,
 * GET/POST /api/v1/proposals, evaluation, approve, discard.
 * Auth: for dev use X-Test-User or X-User-Id header; canister validates proof from gateway in production.
 * See docs/HUB-API.md and docs/CANISTER-AUTH-CONTRACT.md.
 */

import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
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

/// Serialize transient maps into stable storage. Uses Buffer for vault rows — `Array.append` in a loop is
/// quadratic and exceeds the per-message instruction limit (40B) on mainnet for large multi-user vaults.
func saveStable() {
  let vaultBuf = Buffer.Buffer<(Text, Text, [(Text, (Text, Text))])>(8);
  for ((uid, um) in byUser.entries()) {
    for ((vaultId, m) in um.entries()) {
      vaultBuf.add((uid, vaultId, Iter.toArray(m.entries())));
    };
  };
  storage := {
    vaultEntries = Buffer.toArray(vaultBuf);
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
    ("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS"),
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
  let buf = Buffer.Buffer<Char>(len);
  var i = start;
  var n : Nat = 0;
  while (n < len and i < arr.size()) {
    buf.add(arr[i]);
    i += 1;
    n += 1;
  };
  Text.fromIter(buf.vals());
};

/// Vault-relative path under prefix (exact match or prefix/...).
func notePathUnderProjectPrefix(p : Text, base : Text) : Bool {
  if (p == base) { true } else { Text.startsWith(p, #text (base # "/")) };
};

func stripVaultPathPrefixSlashes(s : Text) : Text {
  var x = s;
  while (x.size() > 0 and textSlice(x, 0, 1) == "/") {
    x := textSlice(x, 1, x.size() - 1);
  };
  while (x.size() > 0 and textSlice(x, x.size() - 1, 1) == "/") {
    x := textSlice(x, 0, x.size() - 1);
  };
  x;
};

func normalizeDeletePrefixRaw(raw : Text) : ?Text {
  let t = Text.trim(raw, #predicate isAsciiSpace);
  if (t.size() == 0) { return null };
  if (textFind(t, "..") != null) { return null };
  let s = stripVaultPathPrefixSlashes(t);
  if (s.size() == 0) { return null };
  let parts = Iter.toArray(Text.split(s, #char '/'));
  for (seg in Array.vals(parts)) {
    if (seg == "." or seg == "..") { return null };
  };
  ?s;
};

func discardProposalsUnderPrefix(uid : Text, vid : Text, base : Text) : Nat {
  let list = getProposalsList(uid);
  let buf = Buffer.Buffer<ProposalRecord>(list.size());
  var disc : Nat = 0;
  let effVid = effectiveVaultId(vid);
  for (r in Array.vals(list)) {
    if (
      r.status == "proposed" and effectiveVaultId(r.vault_id) == effVid and notePathUnderProjectPrefix(r.path, base)
    ) {
      disc += 1;
      buf.add({
        r with status = "discarded";
        updated_at = "2025-01-01T00:00:00.000Z";
      });
    } else {
      buf.add(r);
    };
  };
  setProposalsList(uid, Buffer.toArray(buf));
  disc;
};

/// Linear-time substring search. The previous implementation compared via `textSlice` at every
/// index, and `textSlice` called `Text.toArray` on the full haystack each time — O(n²) on large
/// POST bodies (e.g. `POST /api/v1/notes/batch`), exceeding the per-message instruction limit.
func textFind(t : Text, needle : Text) : ?Nat {
  let tarr = Text.toArray(t);
  let narr = Text.toArray(needle);
  let nlen = narr.size();
  let tlen = tarr.size();
  if (nlen == 0) { return ?0 };
  if (nlen > tlen) { return null };
  var i : Nat = 0;
  while (i + nlen <= tlen) {
    var j : Nat = 0;
    var ok = true;
    while (j < nlen) {
      if (tarr[i + j] != narr[j]) {
        ok := false;
        j := nlen;
      } else {
        j += 1;
      };
    };
    if (ok) { return ?i };
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
  } else if (path == "/api/v1/notes/batch" or path == "/api/v1/notes/batch/") {
    ("notes_batch", "");
  } else if (path == "/api/v1/notes/delete-by-prefix" or path == "/api/v1/notes/delete-by-prefix/") {
    ("notes_delete_prefix", "");
  } else if (Text.startsWith(path, #text "/api/v1/notes/")) {
    let suffix = Text.trimStart(path, #text "/api/v1/notes/");
    ("note", suffix);
  } else if (path == "/api/v1/notes" or path == "/api/v1/notes/") {
    ("notes", "");
  } else if (Text.startsWith(path, #text "/api/v1/vaults/")) {
    let rest = Text.trimStart(path, #text "/api/v1/vaults/");
    let parts = Iter.toArray(Text.split(rest, #char '/'));
    let idRaw = if (parts.size() > 0) { parts[0] } else { "" };
    ("vault_delete", idRaw);
  } else if (path == "/api/v1/vaults" or path == "/api/v1/vaults/") {
    ("vaults", "");
  } else if (Text.startsWith(path, #text "/api/v1/proposals/")) {
    let rest = Text.trimStart(path, #text "/api/v1/proposals/");
    let parts = Iter.toArray(Text.split(rest, #char '/'));
    if (parts.size() >= 2 and parts[1] == "evaluation") { ("evaluation", parts[0]) }
    else if (parts.size() >= 2 and parts[1] == "review-hints") { ("review_hints", parts[0]) }
    else if (parts.size() == 1) { ("proposal", parts[0]) }
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
// Linear in output size: one Text.toArray on body, Buffer for result (avoids quadratic Text #= in a loop).
func extractJsonString(body : Text, key : Text) : ?Text {
  let needle = "\"" # key # "\":\"";
  switch (textFind(body, needle)) {
    case null { null };
    case (?start) {
      let chars = Text.toArray(body);
      var i = start + Text.size(needle);
      let buf = Buffer.Buffer<Char>(32);
      while (i < chars.size()) {
        let ch = chars[i];
        if (ch == '\\' and i + 1 < chars.size()) {
          buf.add(chars[i]);
          buf.add(chars[i + 1]);
          i += 2;
        } else if (ch == '\"') {
          return ?Text.fromIter(buf.vals());
        } else {
          buf.add(ch);
          i += 1;
        };
      };
      null;
    };
  };
};

func skipWsFromCharIndex(chars : [Char], j0 : Nat) : Nat {
  var j = j0;
  while (j < chars.size()) {
    let ch = chars[j];
    if (ch == ' ' or ch == '\t' or ch == '\n' or ch == '\r') { j += 1 } else { return j };
  };
  j;
};

/// Balanced `{...}` starting at startBrace (must point at `{`). Respects strings and escapes.
func extractJsonObjectSlice(body : Text, startBrace : Nat) : ?Text {
  let chars = Text.toArray(body);
  if (startBrace >= chars.size()) { return null };
  if (chars[startBrace] != '{') { return null };
  var i = startBrace;
  var depth : Int = 0;
  var inStr = false;
  var esc = false;
  while (i < chars.size()) {
    let ch = chars[i];
    if (esc) {
      esc := false;
      i += 1;
    } else if (inStr) {
      if (ch == '\\') { esc := true } else if (ch == '\"') { inStr := false };
      i += 1;
    } else if (ch == '\"') {
      inStr := true;
      i += 1;
    } else {
      if (ch == '{') { depth += 1 };
      if (ch == '}') {
        depth -= 1;
        if (depth == 0) {
          let len = (i + 1) - startBrace;
          return ?textSlice(body, startBrace, len);
        };
      };
      i += 1;
    };
  };
  null;
};

/// POST bodies often use `"frontmatter":{...}` (JSON object). extractJsonString only handled a quoted string; mismatch stored `"{}"` and hid metadata in the Hub.
func extractFrontmatterFromPostBody(body : Text) : Text {
  switch (extractJsonString(body, "frontmatter")) {
    case (?t) { t };
    case null {
      let needle = "\"frontmatter\":";
      switch (textFind(body, needle)) {
        case null { "{}" };
        case (?start) {
          let chars = Text.toArray(body);
          let idx = skipWsFromCharIndex(chars, start + Text.size(needle));
          if (idx >= chars.size()) { return "{}" };
          if (chars[idx] == '\"') {
            return Option.get(extractJsonString(body, "frontmatter"), "{}");
          };
          if (chars[idx] != '{') { return "{}" };
          switch (extractJsonObjectSlice(body, idx)) {
            case (?obj) { obj };
            case null { "{}" };
          };
        };
      };
    };
  };
};

func skipWsChars(chars : [Char], i0 : Nat) : Nat {
  var i = i0;
  while (i < chars.size()) {
    let ch = chars[i];
    if (ch == ' ' or ch == '\t' or ch == '\n' or ch == '\r') { i += 1 } else { return i };
  };
  i;
};

func sliceCharsToText(chars : [Char], start : Nat, len : Nat) : Text {
  let buf = Buffer.Buffer<Char>(len);
  var j : Nat = 0;
  while (j < len) {
    buf.add(chars[start + j]);
    j += 1;
  };
  Text.fromIter(buf.vals());
};

/// `startBrace` must index `{`. Returns index of matching closing `}`.
func findJsonObjectEndChars(chars : [Char], startBrace : Nat) : ?Nat {
  if (startBrace >= chars.size() or chars[startBrace] != '{') { return null };
  var i = startBrace;
  var depth : Int = 0;
  var inStr = false;
  var esc = false;
  while (i < chars.size()) {
    let ch = chars[i];
    if (esc) {
      esc := false;
      i += 1;
    } else if (inStr) {
      if (ch == '\\') { esc := true } else if (ch == '\"') { inStr := false };
      i += 1;
    } else if (ch == '\"') {
      inStr := true;
      i += 1;
    } else {
      if (ch == '{') { depth += 1 };
      if (ch == '}') {
        depth -= 1;
        if (depth == 0) { return ?i };
      };
      i += 1;
    };
  };
  null;
};

/// Parse `{"notes":[{...},...]}` into (path, frontmatterJsonText, body) per element.
func parseNotesBatch(body : Text) : ?[(Text, Text, Text)] {
  let chars = Text.toArray(body);
  switch (textFind(body, "\"notes\"")) {
    case null { null };
    case (?nk) {
      var i = nk + 7;
      i := skipWsChars(chars, i);
      if (i >= chars.size() or chars[i] != ':') { return null };
      i += 1;
      i := skipWsChars(chars, i);
      if (i >= chars.size() or chars[i] != '[') { return null };
      i += 1;
      let out = Buffer.Buffer<(Text, Text, Text)>(8);
      while (i < chars.size()) {
        i := skipWsChars(chars, i);
        if (i >= chars.size()) { return null };
        if (chars[i] == ']') {
          return ?Buffer.toArray(out);
        };
        if (out.size() >= 100) { return null };
        if (chars[i] != '{') { return null };
        switch (findJsonObjectEndChars(chars, i)) {
          case null { return null };
          case (?endIdx) {
            let objLen = (endIdx + 1) - i;
            let objText = sliceCharsToText(chars, i, objLen);
            let path = Option.get(extractJsonString(objText, "path"), "");
            if (path.size() == 0) { return null };
            let noteBody = Option.get(extractJsonString(objText, "body"), "");
            let frontmatter = extractFrontmatterFromPostBody(objText);
            out.add((path, frontmatter, noteBody));
            i := endIdx + 1;
            i := skipWsChars(chars, i);
            if (i < chars.size() and chars[i] == ',') { i += 1 };
          };
        };
      };
      null;
    };
  };
};

/// Single hex digit (percent-decoding); avoids allocating one-char `Text` per path byte.
func hexDigitChar(ch : Char) : ?Nat {
  let n = Char.toNat32(ch);
  if (n >= 48 and n <= 57) return ?(Nat32.toNat(n - 48));
  if (n >= 65 and n <= 70) return ?(Nat32.toNat(n - 55));
  if (n >= 97 and n <= 102) return ?(Nat32.toNat(n - 87));
  null;
};

/// Decode percent-encoded path segment (e.g. inbox%2Fnote.md -> inbox/note.md) so GET lookup matches POST-stored keys.
func decodePercentEncoded(s : Text) : Text {
  let chars = Text.toArray(s);
  let buf = Buffer.Buffer<Char>(chars.size());
  var i : Nat = 0;
  while (i < chars.size()) {
    let c = chars[i];
    if (c == '%' and i + 2 < chars.size()) {
      switch (hexDigitChar(chars[i + 1]), hexDigitChar(chars[i + 2])) {
        case (?a, ?b) {
          let code = a * 16 + b;
          buf.add(Char.fromNat32(Nat32.fromNat(code)));
          i += 3;
        };
        case _ {
          buf.add(c);
          i += 1;
        };
      };
    } else {
      buf.add(c);
      i += 1;
    };
  };
  Text.fromIter(buf.vals());
};

/// Decode URL path segment and strip a single trailing slash (matches GET note lookup).
func normalizeNotePathFromArg(pathArg : Text) : Text {
  let pathDecoded = decodePercentEncoded(pathArg);
  if (Text.size(pathDecoded) > 0 and textSlice(pathDecoded, Text.size(pathDecoded) - 1, 1) == "/") {
    textSlice(pathDecoded, 0, Text.size(pathDecoded) - 1)
  } else {
    pathDecoded
  };
};

/// 4 lowercase hex digits (JSON \\uXXXX) for BMP code points; used for U+0000..U+001F.
func natToHex4(code : Nat32) : Text {
  let n = Nat32.toNat(code);
  func hd(div : Nat) : Text {
    let d = (n / div) % 16;
    switch (d) {
      case 0 { "0" };
      case 1 { "1" };
      case 2 { "2" };
      case 3 { "3" };
      case 4 { "4" };
      case 5 { "5" };
      case 6 { "6" };
      case 7 { "7" };
      case 8 { "8" };
      case 9 { "9" };
      case 10 { "a" };
      case 11 { "b" };
      case 12 { "c" };
      case 13 { "d" };
      case 14 { "e" };
      case 15 { "f" };
      case _ { "0" };
    };
  };
  hd(4096) # hd(256) # hd(16) # hd(1);
};

/// Human evaluation: approve allowed when status empty/none/passed (see docs/PROPOSAL-LIFECYCLE.md).
func evalStatusAllowsApprove(es : Text) : Bool {
  if (es == "" or es == "none") { true } else if (es == "passed") { true } else { false };
};

func outcomeToEvaluationStatus(out : Text) : ?Text {
  if (out == "pass") { ?"passed" } else if (out == "fail") { ?"failed" } else if (out == "needs_changes") { ?"needs_changes" } else { null };
};

/// Best-effort: reject pass if serialized checklist contains an explicit false (full JSON parse not in canister v1).
func checklistJsonOkForPass(checklistJson : Text) : Bool {
  switch (textFind(checklistJson, "\"passed\":false")) {
    case null { true };
    case (?_) { false };
  };
};

/// RFC 8259: control chars U+0000..U+001F must be escaped; pass-through broke JSON.parse in the Hub.
func escapeJson(s : Text) : Text {
  let chars = Text.toArray(s);
  var out = "";
  var idx : Nat = 0;
  while (idx < chars.size()) {
    let ch = chars[idx];
    let code = Char.toNat32(ch);
    if (code == 92) { out := out # "\\\\" }
    else if (code == 34) { out := out # "\\\"" }
    else if (code == 10) { out := out # "\\n" }
    else if (code == 13) { out := out # "\\r" }
    else if (code == 9) { out := out # "\\t" }
    else if (code < 32) { out := out # "\\u" # natToHex4(code) }
    else { out := out # Char.toText(ch) };
    idx += 1;
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
      items := items # "{\"path\":\"" # escapeJson(p) # "\",\"frontmatter\":\"" # escapeJson(fmBody.0) # "\",\"body\":\"" # escapeJson(fmBody.1) # "\"}";
    };
    let json = "{\"notes\":[" # items # "],\"total\":" # Nat.toText(entries.size()) # "}";
    return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null; upgrade = null };
  };

  if (pathKind == "note" and req.method == "GET") {
    let pathNormalized = normalizeNotePathFromArg(pathArg);
    let vault = getVault(uid, vid);
    switch (vault.get(pathNormalized)) {
      case (?fmBody) {
        let json = "{\"path\":\"" # escapeJson(pathNormalized) # "\",\"frontmatter\":\"" # escapeJson(fmBody.0) # "\",\"body\":\"" # escapeJson(fmBody.1) # "\"}";
        return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null; upgrade = null };
      };
      case null {
        switch (vault.get(pathArg)) {
          case (?fmBody) {
            let json = "{\"path\":\"" # escapeJson(pathArg) # "\",\"frontmatter\":\"" # escapeJson(fmBody.0) # "\",\"body\":\"" # escapeJson(fmBody.1) # "\"}";
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
      items := items # "{\"proposal_id\":\"" # escapeJson(p.proposal_id) # "\",\"path\":\"" # escapeJson(p.path) # "\",\"status\":\"" # escapeJson(p.status) # "\",\"intent\":\"" # escapeJson(p.intent) # "\",\"base_state_id\":\"" # escapeJson(p.base_state_id) # "\",\"external_ref\":\"" # escapeJson(p.external_ref) # "\",\"vault_id\":\"" # escapeJson(effectiveVaultId(p.vault_id)) # "\",\"created_at\":\"" # escapeJson(p.created_at) # "\",\"updated_at\":\"" # escapeJson(p.updated_at) # "\",\"evaluation_status\":\"" # escapeJson(p.evaluation_status) # "\",\"evaluation_grade\":\"" # escapeJson(p.evaluation_grade) # "\",\"evaluated_by\":\"" # escapeJson(p.evaluated_by) # "\",\"evaluated_at\":\"" # escapeJson(p.evaluated_at) # "\",\"review_queue\":\"" # escapeJson(p.review_queue) # "\",\"review_severity\":\"" # escapeJson(p.review_severity) # "\",\"auto_flag_reasons_json\":" # (if (Text.size(p.auto_flag_reasons_json) > 0) { p.auto_flag_reasons_json } else { "[]" }) # "}";
    };
    let json = "{\"proposals\":[" # items # "],\"total\":" # Nat.toText(list.size()) # "}";
    return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null; upgrade = null };
  };

  if (pathKind == "proposal" and req.method == "GET") {
    let list = proposalsForVault(uid, vid);
    switch (Array.find<ProposalRecord>(list, func(p : ProposalRecord) : Bool { p.proposal_id == pathArg })) {
      case (?p) {
        let json = "{\"proposal_id\":\"" # escapeJson(p.proposal_id) # "\",\"path\":\"" # escapeJson(p.path) # "\",\"status\":\"" # escapeJson(p.status) # "\",\"intent\":\"" # escapeJson(p.intent) # "\",\"base_state_id\":\"" # escapeJson(p.base_state_id) # "\",\"external_ref\":\"" # escapeJson(p.external_ref) # "\",\"vault_id\":\"" # escapeJson(effectiveVaultId(p.vault_id)) # "\",\"body\":\"" # escapeJson(p.body) # "\",\"frontmatter\":\"" # escapeJson(p.frontmatter) # "\",\"created_at\":\"" # escapeJson(p.created_at) # "\",\"updated_at\":\"" # escapeJson(p.updated_at) # "\",\"evaluation_status\":\"" # escapeJson(p.evaluation_status) # "\",\"evaluation_grade\":\"" # escapeJson(p.evaluation_grade) # "\",\"evaluation_checklist\":" # (if (Text.size(p.evaluation_checklist) > 0) { p.evaluation_checklist } else { "[]" }) # ",\"evaluation_comment\":\"" # escapeJson(p.evaluation_comment) # "\",\"evaluated_by\":\"" # escapeJson(p.evaluated_by) # "\",\"evaluated_at\":\"" # escapeJson(p.evaluated_at) # "\",\"evaluation_waiver\":" # (if (Text.size(p.evaluation_waiver_json) > 0) { p.evaluation_waiver_json } else { "null" }) # ",\"review_queue\":\"" # escapeJson(p.review_queue) # "\",\"review_severity\":\"" # escapeJson(p.review_severity) # "\",\"auto_flag_reasons_json\":" # (if (Text.size(p.auto_flag_reasons_json) > 0) { p.auto_flag_reasons_json } else { "[]" }) # ",\"review_hints\":\"" # escapeJson(p.review_hints) # "\",\"review_hints_at\":\"" # escapeJson(p.review_hints_at) # "\",\"review_hints_model\":\"" # escapeJson(p.review_hints_model) # "\"}";
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
    (req.method == "POST" and (pathKind == "notes" or pathKind == "notes_batch" or pathKind == "notes_delete_prefix" or pathKind == "proposals" or pathKind == "approve" or pathKind == "discard" or pathKind == "evaluation" or pathKind == "review_hints"))
    or (req.method == "DELETE" and (pathKind == "note" or pathKind == "vault_delete"))
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

  if (pathKind == "vault_delete" and req.method == "DELETE") {
    let targetVid = sanitizeVaultId(pathArg);
    if (targetVid == "default") {
      return {
        status_code = 400;
        headers = corsHeaders();
        body = jsonBody("{\"error\":\"Cannot delete the default vault\",\"code\":\"BAD_REQUEST\"}");
        streaming_strategy = null;
        upgrade = null;
      };
    };
    switch (byUser.get(uid)) {
      case null {
        return {
          status_code = 404;
          headers = corsHeaders();
          body = jsonBody("{\"error\":\"Vault not found\",\"code\":\"NOT_FOUND\"}");
          streaming_strategy = null;
          upgrade = null;
        };
      };
      case (?um) {
        switch (um.get(targetVid)) {
          case null {
            return {
              status_code = 404;
              headers = corsHeaders();
              body = jsonBody("{\"error\":\"Vault not found\",\"code\":\"NOT_FOUND\"}");
              streaming_strategy = null;
              upgrade = null;
            };
          };
          case (?_) { };
        };
        let _ = um.remove(targetVid);
        let list = getProposalsList(uid);
        let propBuf = Buffer.Buffer<ProposalRecord>(list.size());
        var dropped : Nat = 0;
        for (r in Array.vals(list)) {
          if (effectiveVaultId(r.vault_id) == targetVid) {
            dropped += 1;
          } else {
            propBuf.add(r);
          };
        };
        setProposalsList(uid, Buffer.toArray(propBuf));
        saveStable();
        return {
          status_code = 200;
          headers = corsHeaders();
          body = jsonBody(
            "{\"ok\":true,\"deleted_vault_id\":\"" # escapeJson(targetVid) # "\",\"proposals_removed\":" # Nat.toText(dropped) # "}",
          );
          streaming_strategy = null;
          upgrade = null;
        };
      };
    };
  };

  if (pathKind == "note" and req.method == "DELETE") {
    let pathNormalized = normalizeNotePathFromArg(pathArg);
    let vault = getVault(uid, vid);
    var deletedPath : ?Text = null;
    switch (vault.remove(pathNormalized)) {
      case (?_) { deletedPath := ?pathNormalized };
      case null {
        switch (vault.remove(pathArg)) {
          case (?_) { deletedPath := ?pathArg };
          case null {};
        };
      };
    };
    switch (deletedPath) {
      case (?p) {
        saveStable();
        return {
          status_code = 200;
          headers = corsHeaders();
          body = jsonBody("{\"path\":\"" # escapeJson(p) # "\",\"deleted\":true}");
          streaming_strategy = null;
          upgrade = null;
        };
      };
      case null {
        return {
          status_code = 404;
          headers = corsHeaders();
          body = jsonBody("{\"error\":\"Not found\",\"code\":\"NOT_FOUND\"}");
          streaming_strategy = null;
          upgrade = null;
        };
      };
    };
  };

  if (pathKind == "notes_batch" and req.method == "POST") {
    switch (parseNotesBatch(bodyText)) {
      case null {
        return {
          status_code = 400;
          headers = corsHeaders();
          body = jsonBody("{\"error\":\"Invalid notes batch: expect notes array, max 100 items, path and body per object\",\"code\":\"BAD_REQUEST\"}");
          streaming_strategy = null;
          upgrade = null;
        };
      };
      case (?items) {
        let vault = getVault(uid, vid);
        var count : Nat = 0;
        for (tup in Array.vals(items)) {
          let (p, fm, nb) = tup;
          if (p.size() > 0) {
            vault.put(p, (fm, nb));
            count += 1;
          };
        };
        saveStable();
        return {
          status_code = 200;
          headers = corsHeaders();
          body = jsonBody("{\"imported\":" # Nat.toText(count) # ",\"written\":true}");
          streaming_strategy = null;
          upgrade = null;
        };
      };
    };
  };

  if (pathKind == "notes_delete_prefix" and req.method == "POST") {
    let rawPrefix = Option.get(extractJsonString(bodyText, "path_prefix"), "");
    switch (normalizeDeletePrefixRaw(rawPrefix)) {
      case null {
        return {
          status_code = 400;
          headers = corsHeaders();
          body = jsonBody("{\"error\":\"Invalid or missing path_prefix\",\"code\":\"BAD_REQUEST\"}");
          streaming_strategy = null;
          upgrade = null;
        };
      };
      case (?base) {
        let vault = getVault(uid, vid);
        let entries = Iter.toArray(vault.entries());
        let buf = Buffer.Buffer<Text>(8);
        for ((p, _) in Array.vals(entries)) {
          if (notePathUnderProjectPrefix(p, base)) { buf.add(p) };
        };
        let toRemove = Buffer.toArray(buf);
        for (p in Array.vals(toRemove)) { ignore vault.remove(p) };
        let propDisc = discardProposalsUnderPrefix(uid, vid, base);
        saveStable();
        var jsonPaths : Text = "";
        for (p in Array.vals(toRemove)) {
          if (jsonPaths != "") { jsonPaths := jsonPaths # "," };
          jsonPaths := jsonPaths # "\"" # escapeJson(p) # "\"";
        };
        let json = "{\"deleted\":" # Nat.toText(toRemove.size()) # ",\"paths\":[" # jsonPaths # "],\"proposals_discarded\":" # Nat.toText(propDisc) # "}";
        return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null; upgrade = null };
      };
    };
  };

  if (pathKind == "notes" and req.method == "POST") {
    let vault = getVault(uid, vid);
    let path = if (pathArg.size() > 0) { pathArg } else { Option.get(extractJsonString(bodyText, "path"), "") };
    if (path.size() == 0) {
      return { status_code = 400; headers = corsHeaders(); body = jsonBody("{\"error\":\"path required\",\"code\":\"BAD_REQUEST\"}"); streaming_strategy = null; upgrade = null };
    };
    let noteBody = Option.get(extractJsonString(bodyText, "body"), bodyText);
    let frontmatter = extractFrontmatterFromPostBody(bodyText);
    vault.put(path, (frontmatter, noteBody));
    saveStable();
    return { status_code = 200; headers = corsHeaders(); body = jsonBody("{\"path\":\"" # escapeJson(path) # "\",\"written\":true}"); streaming_strategy = null; upgrade = null };
  };

  if (pathKind == "proposals" and req.method == "POST") {
    let path = Option.get(extractJsonString(bodyText, "path"), "inbox/proposal-" # Int.toText(Time.now()) # ".md");
    let body = Option.get(extractJsonString(bodyText, "body"), "");
    let intent = Option.get(extractJsonString(bodyText, "intent"), "");
    let frontmatter = extractFrontmatterFromPostBody(bodyText);
    let base_state_id = Option.get(extractJsonString(bodyText, "base_state_id"), "");
    let external_ref = Option.get(extractJsonString(bodyText, "external_ref"), "");
    let evalIn = Option.get(extractJsonString(bodyText, "evaluation_status"), "");
    let evalInit = if (evalIn == "pending") { "pending" } else { "" };
    let rq = Option.get(extractJsonString(bodyText, "review_queue"), "");
    let rs = Option.get(extractJsonString(bodyText, "review_severity"), "");
    let afr = Option.get(extractJsonString(bodyText, "auto_flag_reasons_json"), "");
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
      evaluation_status = evalInit;
      evaluation_grade = "";
      evaluation_checklist = "";
      evaluation_comment = "";
      evaluated_by = "";
      evaluated_at = "";
      evaluation_waiver_json = "";
      review_queue = rq;
      review_severity = rs;
      auto_flag_reasons_json = afr;
      review_hints = "";
      review_hints_at = "";
      review_hints_model = "";
    };
    list := Array.append(list, [newP]);
    setProposalsList(uid, list);
    saveStable();
    let json = "{\"proposal_id\":\"" # escapeJson(proposal_id) # "\",\"path\":\"" # escapeJson(path) # "\",\"status\":\"proposed\"}";
    return { status_code = 200; headers = corsHeaders(); body = jsonBody(json); streaming_strategy = null; upgrade = null };
  };

  if (pathKind == "evaluation" and req.method == "POST") {
    let outcome = Option.get(extractJsonString(bodyText, "outcome"), "");
    let grade = Option.get(extractJsonString(bodyText, "grade"), "");
    let comment = Option.get(extractJsonString(bodyText, "comment"), "");
    let checklistJson = Option.get(extractJsonString(bodyText, "evaluation_checklist_json"), "[]");
    switch (outcomeToEvaluationStatus(outcome)) {
      case null {
        return {
          status_code = 400;
          headers = corsHeaders();
          body = jsonBody("{\"error\":\"outcome must be pass, fail, or needs_changes\",\"code\":\"BAD_REQUEST\"}");
          streaming_strategy = null;
          upgrade = null;
        };
      };
      case (?evStatus) {
        var listEv = getProposalsList(uid);
        switch (Array.find<ProposalRecord>(listEv, func(p : ProposalRecord) : Bool { p.proposal_id == pathArg })) {
          case null {
            return {
              status_code = 404;
              headers = corsHeaders();
              body = jsonBody("{\"error\":\"Proposal not found\",\"code\":\"NOT_FOUND\"}");
              streaming_strategy = null;
              upgrade = null;
            };
          };
          case (?pEv) {
            if (pEv.status != "proposed") {
              return {
                status_code = 400;
                headers = corsHeaders();
                body = jsonBody("{\"error\":\"Can only evaluate proposed proposals\",\"code\":\"BAD_REQUEST\"}");
                streaming_strategy = null;
                upgrade = null;
              };
            };
            if ((evStatus == "failed" or evStatus == "needs_changes") and Text.size(comment) == 0) {
              return {
                status_code = 400;
                headers = corsHeaders();
                body = jsonBody("{\"error\":\"comment is required for fail and needs_changes\",\"code\":\"BAD_REQUEST\"}");
                streaming_strategy = null;
                upgrade = null;
              };
            };
            if (evStatus == "passed" and not checklistJsonOkForPass(checklistJson)) {
              return {
                status_code = 400;
                headers = corsHeaders();
                body = jsonBody("{\"error\":\"All checklist items must pass for a pass outcome\",\"code\":\"BAD_REQUEST\"}");
                streaming_strategy = null;
                upgrade = null;
              };
            };
            let nowEv = "2025-01-01T00:00:00.000Z";
            listEv := Array.map<ProposalRecord, ProposalRecord>(listEv, func(x : ProposalRecord) : ProposalRecord {
              if (x.proposal_id == pathArg) {
                {
                  x with
                  evaluation_status = evStatus;
                  evaluation_grade = grade;
                  evaluation_checklist = checklistJson;
                  evaluation_comment = comment;
                  evaluated_by = uid;
                  evaluated_at = nowEv;
                  updated_at = nowEv;
                }
              } else { x }
            });
            setProposalsList(uid, listEv);
            saveStable();
            return {
              status_code = 200;
              headers = corsHeaders();
              body = jsonBody(
                "{\"proposal_id\":\"" # escapeJson(pathArg) # "\",\"evaluation_status\":\"" # escapeJson(evStatus) # "\"}",
              );
              streaming_strategy = null;
              upgrade = null;
            };
          };
        };
      };
    };
  };

  if (pathKind == "review_hints" and req.method == "POST") {
    let hints = Option.get(extractJsonString(bodyText, "review_hints"), "");
    let model = Option.get(extractJsonString(bodyText, "review_hints_model"), "");
    var listRh = getProposalsList(uid);
    switch (Array.find<ProposalRecord>(listRh, func(p : ProposalRecord) : Bool { p.proposal_id == pathArg })) {
      case null {
        return {
          status_code = 404;
          headers = corsHeaders();
          body = jsonBody("{\"error\":\"Proposal not found\",\"code\":\"NOT_FOUND\"}");
          streaming_strategy = null;
          upgrade = null;
        };
      };
      case (?pRh) {
        if (pRh.status != "proposed") {
          return {
            status_code = 400;
            headers = corsHeaders();
            body = jsonBody("{\"error\":\"Can only attach hints to proposed proposals\",\"code\":\"BAD_REQUEST\"}");
            streaming_strategy = null;
            upgrade = null;
          };
        };
        let nowRh = "2025-01-01T00:00:00.000Z";
        listRh := Array.map<ProposalRecord, ProposalRecord>(listRh, func(x : ProposalRecord) : ProposalRecord {
          if (x.proposal_id == pathArg) {
            {
              x with
              review_hints = hints;
              review_hints_model = model;
              review_hints_at = nowRh;
              updated_at = nowRh;
            }
          } else {
            x
          }
        });
        setProposalsList(uid, listRh);
        saveStable();
        return {
          status_code = 200;
          headers = corsHeaders();
          body = jsonBody("{\"proposal_id\":\"" # escapeJson(pathArg) # "\",\"ok\":true}");
          streaming_strategy = null;
          upgrade = null;
        };
      };
    };
  };

  if (pathKind == "approve" and req.method == "POST") {
    let waiverRaw = Option.get(extractJsonString(bodyText, "waiver_reason"), "");
    var list = getProposalsList(uid);
    switch (Array.find<ProposalRecord>(list, func(p : ProposalRecord) : Bool { p.proposal_id == pathArg })) {
      case (?p) {
        let needsWaiver = not evalStatusAllowsApprove(p.evaluation_status);
        if (needsWaiver and Text.size(waiverRaw) < 3) {
          return {
            status_code = 403;
            headers = corsHeaders();
            body = jsonBody(
              "{\"error\":\"Evaluation must be passed before approve, or provide waiver_reason\",\"code\":\"EVALUATION_REQUIRED\"}",
            );
            streaming_strategy = null;
            upgrade = null;
          };
        };
        let targetVid = effectiveVaultId(p.vault_id);
        let vault = getVault(uid, targetVid);
        vault.put(p.path, (p.frontmatter, p.body));
        let nowAp = "2025-01-01T00:00:00.000Z";
        let waiverJson = if (needsWaiver and Text.size(waiverRaw) >= 3) {
          "{\"by\":\"" # escapeJson(uid) # "\",\"at\":\"" # nowAp # "\",\"reason\":\"" # escapeJson(waiverRaw) # "\"}"
        } else {
          ""
        };
        list := Array.map<ProposalRecord, ProposalRecord>(list, func(x : ProposalRecord) : ProposalRecord {
          if (x.proposal_id == pathArg) {
            {
              x with status = "approved";
              updated_at = nowAp;
              evaluation_waiver_json = if (Text.size(waiverJson) > 0) { waiverJson } else { x.evaluation_waiver_json };
            }
          } else {
            x
          }
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
