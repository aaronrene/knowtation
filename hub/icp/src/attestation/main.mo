/**
 * Knowtation Attestation Canister — immutable append-only ledger for AIR attestation records.
 *
 * AIR Improvement E: blockchain-backed attestation on ICP.
 * Records are write-once: no update, no delete. Once stored, permanent.
 *
 * Access control:
 *   storeAttestation    → authorized callers only (gateway identity)
 *   setAuthorizedCallers → canister controllers only
 *   getAttestation       → public query (anyone can verify)
 *   listAttestations     → public query (transparency)
 *   getStats             → public query (canister health)
 *
 * HTTP interface (via IC HTTP gateway):
 *   GET /health         → {"ok":true}
 *   GET /attest/<id>    → attestation record JSON or 404
 *   GET /stats          → { total, nextSeq }
 */

import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Buffer "mo:base/Buffer";
import Char "mo:base/Char";
import HashMap "mo:base/HashMap";
import Int "mo:base/Int";
import Iter "mo:base/Iter";
import Nat "mo:base/Nat";
import Nat32 "mo:base/Nat32";
import Principal "mo:base/Principal";
import Text "mo:base/Text";
import Time "mo:base/Time";

persistent actor Attestation {

  // -------------------------------------------------------------------------
  // Types
  // -------------------------------------------------------------------------

  type AttestationRecord = {
    id : Text;
    action : Text;
    path : Text;
    timestamp : Text;
    content_hash : Text;
    sig : Text;
    seq : Nat;
    stored_at : Text;
  };

  type StoreInput = {
    id : Text;
    action : Text;
    path : Text;
    timestamp : Text;
    content_hash : Text;
    sig : Text;
  };

  type StoreResult = {
    #ok : { seq : Nat };
    #err : Text;
  };

  type ListResult = {
    records : [AttestationRecord];
    total : Nat;
  };

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

  // -------------------------------------------------------------------------
  // Stable state
  // -------------------------------------------------------------------------

  var entries : [(Text, AttestationRecord)] = [];
  var nextSeq : Nat = 0;
  var authorizedCallers : [Principal] = [];

  // -------------------------------------------------------------------------
  // Transient (rebuilt on upgrade)
  // -------------------------------------------------------------------------

  transient var byId = HashMap.HashMap<Text, AttestationRecord>(64, Text.equal, Text.hash);
  transient var ordered = Buffer.Buffer<AttestationRecord>(64);

  func loadTransient() {
    byId := HashMap.HashMap<Text, AttestationRecord>(
      Nat.max(64, entries.size()),
      Text.equal,
      Text.hash,
    );
    ordered := Buffer.Buffer<AttestationRecord>(Nat.max(64, entries.size()));
    let sorted = Array.sort<(Text, AttestationRecord)>(
      entries,
      func(a : (Text, AttestationRecord), b : (Text, AttestationRecord)) : {
        #less;
        #equal;
        #greater;
      } {
        if (a.1.seq < b.1.seq) { #less } else if (a.1.seq == b.1.seq) { #equal } else {
          #greater;
        };
      },
    );
    for ((id, r) in Array.vals(sorted)) {
      byId.put(id, r);
      ordered.add(r);
    };
  };
  loadTransient();

  func saveStable() {
    let buf = Buffer.Buffer<(Text, AttestationRecord)>(ordered.size());
    for (r in ordered.vals()) {
      buf.add((r.id, r));
    };
    entries := Buffer.toArray(buf);
  };

  // -------------------------------------------------------------------------
  // Authorization helpers
  // -------------------------------------------------------------------------

  func isAuthorizedCaller(caller : Principal) : Bool {
    for (p in Array.vals(authorizedCallers)) {
      if (Principal.equal(p, caller)) { return true };
    };
    false;
  };

  func isController(caller : Principal) : Bool {
    Principal.isController(caller);
  };

  // -------------------------------------------------------------------------
  // Time helpers (same pattern as hub canister)
  // -------------------------------------------------------------------------

  func intToNatSafe(i : Int) : Nat {
    if (i < 0) { return 0 };
    switch (Nat.fromText(Int.toText(i))) {
      case null { 0 };
      case (?n) { n };
    };
  };

  func isLeapYear(y : Nat) : Bool {
    (y % 4 == 0 and y % 100 != 0) or (y % 400 == 0);
  };

  func daysInMonth(y : Nat, m : Nat) : Nat {
    switch (m) {
      case 1 { 31 };
      case 2 { if (isLeapYear(y)) { 29 } else { 28 } };
      case 3 { 31 };
      case 4 { 30 };
      case 5 { 31 };
      case 6 { 30 };
      case 7 { 31 };
      case 8 { 31 };
      case 9 { 30 };
      case 10 { 31 };
      case 11 { 30 };
      case 12 { 31 };
      case _ { 31 };
    };
  };

  func pad2(n : Nat) : Text {
    if (n < 10) { "0" # Nat.toText(n) } else { Nat.toText(n) };
  };

  func pad3(n : Nat) : Text {
    if (n < 10) { "00" # Nat.toText(n) } else if (n < 100) {
      "0" # Nat.toText(n);
    } else { Nat.toText(n) };
  };

  func pad4(n : Nat) : Text {
    let t = Nat.toText(n);
    let len = Text.size(t);
    if (len >= 4) { t } else if (len == 3) { "0" # t } else if (len == 2) {
      "00" # t;
    } else if (len == 1) { "000" # t } else { "0000" };
  };

  func nowIsoUtc() : Text {
    let ns = Time.now();
    if (ns < 0) { return "1970-01-01T00:00:00.000Z" };
    let secInt = ns / 1_000_000_000;
    let remNs = ns % 1_000_000_000;
    let secNat = intToNatSafe(secInt);
    let msNat = intToNatSafe(remNs / 1_000_000);
    let secsPerDay = 86400;
    let totalDays = secNat / secsPerDay;
    var sod = secNat % secsPerDay;
    let hour = sod / 3600;
    sod := sod % 3600;
    let minute = sod / 60;
    let second = sod % 60;
    var y : Nat = 1970;
    var d = totalDays;
    label yearLoop loop {
      let diy = if (isLeapYear(y)) { 366 } else { 365 };
      if (d >= diy) { d -= diy; y += 1 } else { break yearLoop };
    };
    var m : Nat = 1;
    label monthLoop loop {
      let dim = daysInMonth(y, m);
      if (d >= dim) { d -= dim; m += 1 } else { break monthLoop };
    };
    let day = d + 1;
    pad4(y) # "-" # pad2(m) # "-" # pad2(day) # "T" # pad2(hour) # ":" # pad2(minute) # ":" # pad2(second) # "." # pad3(msNat % 1000) # "Z";
  };

  // -------------------------------------------------------------------------
  // JSON helpers
  // -------------------------------------------------------------------------

  func natToHex4(code : Nat32) : Text {
    let n = Nat32.toNat(code);
    func hd(div : Nat) : Text {
      let dd = (n / div) % 16;
      switch (dd) {
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

  func escapeJson(s : Text) : Text {
    let chars = Text.toArray(s);
    var out = "";
    var idx : Nat = 0;
    while (idx < chars.size()) {
      let ch = chars[idx];
      let code = Char.toNat32(ch);
      if (code == 92) { out := out # "\\\\" } else if (code == 34) {
        out := out # "\\\"";
      } else if (code == 10) { out := out # "\\n" } else if (code == 13) {
        out := out # "\\r";
      } else if (code == 9) { out := out # "\\t" } else if (code < 32) {
        out := out # "\\u" # natToHex4(code);
      } else { out := out # Char.toText(ch) };
      idx += 1;
    };
    out;
  };

  func jsonBody(s : Text) : Blob { Text.encodeUtf8(s) };

  func corsHeaders() : [Header] {
    [
      ("Access-Control-Allow-Origin", "*"),
      ("Access-Control-Allow-Methods", "GET, OPTIONS"),
      ("Access-Control-Allow-Headers", "Content-Type, Accept"),
      ("Content-Type", "application/json"),
    ];
  };

  func recordToJson(r : AttestationRecord) : Text {
    "{\"id\":\"" # escapeJson(r.id) # "\",\"action\":\"" # escapeJson(r.action) # "\",\"path\":\"" # escapeJson(r.path) # "\",\"timestamp\":\"" # escapeJson(r.timestamp) # "\",\"content_hash\":\"" # escapeJson(r.content_hash) # "\",\"sig\":\"" # escapeJson(r.sig) # "\",\"seq\":" # Nat.toText(r.seq) # ",\"stored_at\":\"" # escapeJson(r.stored_at) # "\"}";
  };

  // -------------------------------------------------------------------------
  // URL parsing (same pattern as hub canister)
  // -------------------------------------------------------------------------

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
        if (tarr[i + j] != narr[j]) { ok := false; j := nlen } else {
          j += 1;
        };
      };
      if (ok) { return ?i };
      i += 1;
    };
    null;
  };

  func pathOnly(rawUrl : Text) : Text {
    let pathParts = Iter.toArray(Text.split(rawUrl, #char '?'));
    var path = if (pathParts.size() > 0) { pathParts[0] } else { rawUrl };
    switch (textFind(path, "://")) {
      case (?k) {
        let startAuth = k + 3;
        let pathLen = Text.size(path);
        if (startAuth < pathLen) {
          let afterLen = pathLen - startAuth;
          let after = textSlice(path, startAuth, afterLen);
          switch (textFind(after, "/")) {
            case (?m) {
              let afterSz = Text.size(after);
              if (m < afterSz) {
                path := textSlice(after, m, afterSz - m);
              } else { path := "/" };
            };
            case null { path := "/" };
          };
        } else { path := "/" };
      };
      case null {};
    };
    path;
  };

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
          case _ { buf.add(c); i += 1 };
        };
      } else { buf.add(c); i += 1 };
    };
    Text.fromIter(buf.vals());
  };

  func hexDigitChar(ch : Char) : ?Nat {
    let n = Char.toNat32(ch);
    if (n >= 48 and n <= 57) return ?(Nat32.toNat(n - 48));
    if (n >= 65 and n <= 70) return ?(Nat32.toNat(n - 55));
    if (n >= 97 and n <= 102) return ?(Nat32.toNat(n - 87));
    null;
  };

  // -------------------------------------------------------------------------
  // Candid API — update methods (authenticated)
  // -------------------------------------------------------------------------

  public shared (msg) func storeAttestation(input : StoreInput) : async StoreResult {
    if (not isAuthorizedCaller(msg.caller)) {
      return #err("Unauthorized: caller " # Principal.toText(msg.caller) # " is not authorized");
    };

    if (Text.size(input.id) == 0) {
      return #err("id is required");
    };

    switch (byId.get(input.id)) {
      case (?_existing) {
        return #err("Attestation " # input.id # " already exists (records are immutable)");
      };
      case null {};
    };

    let seq = nextSeq;
    nextSeq += 1;

    let record : AttestationRecord = {
      id = input.id;
      action = input.action;
      path = input.path;
      timestamp = input.timestamp;
      content_hash = input.content_hash;
      sig = input.sig;
      seq;
      stored_at = nowIsoUtc();
    };

    byId.put(record.id, record);
    ordered.add(record);
    saveStable();

    #ok({ seq });
  };

  public shared (msg) func setAuthorizedCallers(callers : [Principal]) : async () {
    if (not isController(msg.caller)) {
      assert (false);
    };
    authorizedCallers := callers;
  };

  // -------------------------------------------------------------------------
  // Candid API — query methods (public)
  // -------------------------------------------------------------------------

  public query func getAttestation(id : Text) : async ?AttestationRecord {
    byId.get(id);
  };

  public query func listAttestations(offset : Nat, limit : Nat) : async ListResult {
    let total = ordered.size();
    let effectiveLimit = if (limit > 100) { 100 } else if (limit == 0) { 20 } else {
      limit;
    };
    let start = if (offset >= total) { total } else { offset };
    let end = Nat.min(start + effectiveLimit, total);
    let buf = Buffer.Buffer<AttestationRecord>(end - start);
    var i = start;
    while (i < end) {
      buf.add(ordered.get(i));
      i += 1;
    };
    { records = Buffer.toArray(buf); total };
  };

  public query func getStats() : async { total : Nat; nextSeq : Nat } {
    { total = ordered.size(); nextSeq };
  };

  public query func getAuthorizedCallers() : async [Principal] {
    authorizedCallers;
  };

  // -------------------------------------------------------------------------
  // HTTP interface — browser-based verification (read-only)
  // -------------------------------------------------------------------------

  public query func http_request(req : HttpRequest) : async HttpResponse {
    let path = pathOnly(req.url);

    if (path == "/health" or path == "/health/") {
      return {
        status_code = 200;
        headers = corsHeaders();
        body = jsonBody("{\"ok\":true,\"canister\":\"attestation\"}");
        streaming_strategy = null;
        upgrade = null;
      };
    };

    if (path == "/stats" or path == "/stats/") {
      return {
        status_code = 200;
        headers = corsHeaders();
        body = jsonBody(
          "{\"total\":" # Nat.toText(ordered.size()) # ",\"next_seq\":" # Nat.toText(nextSeq) # "}"
        );
        streaming_strategy = null;
        upgrade = null;
      };
    };

    if (Text.startsWith(path, #text "/attest/")) {
      let rawId = Text.trimStart(path, #text "/attest/");
      let id = decodePercentEncoded(rawId);
      switch (byId.get(id)) {
        case (?r) {
          return {
            status_code = 200;
            headers = corsHeaders();
            body = jsonBody(recordToJson(r));
            streaming_strategy = null;
            upgrade = null;
          };
        };
        case null {
          return {
            status_code = 404;
            headers = corsHeaders();
            body = jsonBody("{\"error\":\"Attestation not found\",\"code\":\"NOT_FOUND\"}");
            streaming_strategy = null;
            upgrade = null;
          };
        };
      };
    };

    if (req.method == "OPTIONS") {
      return {
        status_code = 204;
        headers = corsHeaders();
        body = jsonBody("");
        streaming_strategy = null;
        upgrade = null;
      };
    };

    {
      status_code = 404;
      headers = corsHeaders();
      body = jsonBody("{\"error\":\"Not found\",\"code\":\"NOT_FOUND\"}");
      streaming_strategy = null;
      upgrade = null;
    };
  };
};
