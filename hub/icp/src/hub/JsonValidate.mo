/// Validate / normalize JSON text used as raw fragments in proposal GET responses.
/// RFC 8259 subset: objects, arrays, strings, numbers, true/false/null.
/// Proposal enrich fields must be a JSON array (`suggested_labels_json`) or object (`assistant_suggested_frontmatter_json`).

import Char "mo:base/Char";
import Nat32 "mo:base/Nat32";
import Text "mo:base/Text";

module {
  /// ASCII `"` for comparisons — cannot use `'"'` as a Char literal (lexer treats `"` as Text).
  func jsonDquote() : Char {
    Char.fromNat32(Nat32.fromNat(34));
  };

  func isAsciiSpace(c : Char) : Bool {
    c == ' ' or c == '\t' or c == '\n' or c == '\r';
  };

  public func trimAsciiWhitespace(t : Text) : Text {
    Text.trim(t, #predicate isAsciiSpace);
  };

  func skipSpace(chars : [Char], start : Nat) : Nat {
    var i = start;
    while (i < chars.size() and isAsciiSpace(chars[i])) {
      i += 1;
    };
    i;
  };

  func isDigit(c : Char) : Bool {
    let n = Char.toNat32(c);
    n >= 48 and n <= 57;
  };

  func isHex(c : Char) : Bool {
    let n = Char.toNat32(c);
    (n >= 48 and n <= 57) or (n >= 65 and n <= 70) or (n >= 97 and n <= 102);
  };

  func matchLiteral(chars : [Char], start : Nat, lit : Text) : ?Nat {
    let cs = Text.toArray(lit);
    var j : Nat = 0;
    while (j < cs.size()) {
      if (start + j >= chars.size() or chars[start + j] != cs[j]) {
        return null;
      };
      j += 1;
    };
    ?(start + cs.size());
  };

  func parseString(chars : [Char], start : Nat) : ?Nat {
    if (start >= chars.size() or chars[start] != jsonDquote()) {
      return null;
    };
    var i = start + 1;
    while (i < chars.size()) {
      let c = chars[i];
      if (c == jsonDquote()) {
        return ?(i + 1);
      };
      if (c == '\\') {
        if (i + 1 >= chars.size()) {
          return null;
        };
        let esc = chars[i + 1];
        if (esc == 'u') {
          if (i + 5 >= chars.size()) {
            return null;
          };
          var k = 0;
          while (k < 4) {
            if (not isHex(chars[i + 2 + k])) {
              return null;
            };
            k += 1;
          };
          i += 6;
        } else if (
          esc == jsonDquote() or esc == '\\' or esc == '/' or esc == 'b' or esc == 'f' or esc == 'n' or esc == 'r' or esc == 't'
        ) {
          i += 2;
        } else {
          return null;
        };
      } else {
        let code = Char.toNat32(c);
        if (code < 32) {
          return null;
        };
        i += 1;
      };
    };
    null;
  };

  func parseNumber(chars : [Char], start : Nat) : ?Nat {
    var i = start;
    if (i < chars.size() and chars[i] == '-') {
      i += 1;
    };
    if (i >= chars.size()) {
      return null;
    };
    if (not isDigit(chars[i])) {
      return null;
    };
    if (chars[i] == '0') {
      i += 1;
    } else {
      while (i < chars.size() and isDigit(chars[i])) {
        i += 1;
      };
    };
    if (i < chars.size() and chars[i] == '.') {
      i += 1;
      if (i >= chars.size() or not isDigit(chars[i])) {
        return null;
      };
      while (i < chars.size() and isDigit(chars[i])) {
        i += 1;
      };
    };
    if (i < chars.size() and (chars[i] == 'e' or chars[i] == 'E')) {
      i += 1;
      if (i < chars.size() and (chars[i] == '+' or chars[i] == '-')) {
        i += 1;
      };
      if (i >= chars.size() or not isDigit(chars[i])) {
        return null;
      };
      while (i < chars.size() and isDigit(chars[i])) {
        i += 1;
      };
    };
    ?i;
  };

  func parseArray(chars : [Char], start : Nat) : ?Nat {
    if (start >= chars.size() or chars[start] != '[') {
      return null;
    };
    var i = start + 1;
    i := skipSpace(chars, i);
    if (i < chars.size() and chars[i] == ']') {
      return ?(i + 1);
    };
    while (true) {
      switch (parseValue(chars, i)) {
        case null { return null };
        case (?j) { i := j };
      };
      i := skipSpace(chars, i);
      if (i >= chars.size()) {
        return null;
      };
      if (chars[i] == ']') {
        return ?(i + 1);
      };
      if (chars[i] == ',') {
        i += 1;
      } else {
        return null;
      };
    };
    null;
  };

  func parseObject(chars : [Char], start : Nat) : ?Nat {
    if (start >= chars.size() or chars[start] != '{') {
      return null;
    };
    var i = start + 1;
    i := skipSpace(chars, i);
    if (i < chars.size() and chars[i] == '}') {
      return ?(i + 1);
    };
    while (true) {
      switch (parseString(chars, i)) {
        case null { return null };
        case (?j) { i := j };
      };
      i := skipSpace(chars, i);
      if (i >= chars.size() or chars[i] != ':') {
        return null;
      };
      i += 1;
      switch (parseValue(chars, i)) {
        case null { return null };
        case (?j) { i := j };
      };
      i := skipSpace(chars, i);
      if (i >= chars.size()) {
        return null;
      };
      if (chars[i] == '}') {
        return ?(i + 1);
      };
      if (chars[i] == ',') {
        i += 1;
      } else {
        return null;
      };
    };
    null;
  };

  func parseValue(chars : [Char], start : Nat) : ?Nat {
    let i = skipSpace(chars, start);
    if (i >= chars.size()) {
      return null;
    };
    let c = chars[i];
    if (c == jsonDquote()) {
      parseString(chars, i);
    } else if (c == '[') {
      parseArray(chars, i);
    } else if (c == '{') {
      parseObject(chars, i);
    } else if (c == 't') {
      matchLiteral(chars, i, "true");
    } else if (c == 'f') {
      matchLiteral(chars, i, "false");
    } else if (c == 'n') {
      matchLiteral(chars, i, "null");
    } else if (c == '-' or isDigit(c)) {
      parseNumber(chars, i);
    } else {
      null;
    };
  };

  func consumesFullValueStartingWith(chars : [Char], expectOpen : Char) : Bool {
    if (chars.size() == 0) {
      return false;
    };
    let i0 = skipSpace(chars, 0);
    if (i0 >= chars.size() or chars[i0] != expectOpen) {
      return false;
    };
    switch (parseValue(chars, 0)) {
      case null { false };
      case (?j) { skipSpace(chars, j) == chars.size() };
    };
  };

  /// Safe fragment for `"suggested_labels":` … in GET JSON (must be a JSON array).
  public func normalizeJsonArrayFragment(raw : Text) : Text {
    let t = trimAsciiWhitespace(raw);
    if (t.size() == 0) {
      return "[]";
    };
    let chars = Text.toArray(t);
    if (consumesFullValueStartingWith(chars, '[')) {
      t;
    } else {
      "[]";
    };
  };

  /// Safe fragment for `"assistant_suggested_frontmatter":` … in GET JSON (must be a JSON object).
  public func normalizeJsonObjectFragment(raw : Text) : Text {
    let t = trimAsciiWhitespace(raw);
    if (t.size() == 0) {
      return "{}";
    };
    let chars = Text.toArray(t);
    if (consumesFullValueStartingWith(chars, '{')) {
      t;
    } else {
      "{}";
    };
  };

  public type EnrichPrepare = {
    #ok : Text;
    #coercedDefault;
    #tooLarge;
  };

  public func prepareEnrichJsonArray(raw : Text, maxChars : Nat) : EnrichPrepare {
    let t = trimAsciiWhitespace(raw);
    if (t.size() == 0) {
      return #coercedDefault;
    };
    let chars = Text.toArray(t);
    if (not consumesFullValueStartingWith(chars, '[')) {
      return #coercedDefault;
    };
    if (t.size() > maxChars) {
      return #tooLarge;
    };
    #ok(t);
  };

  public func prepareEnrichJsonObject(raw : Text, maxChars : Nat) : EnrichPrepare {
    let t = trimAsciiWhitespace(raw);
    if (t.size() == 0) {
      return #coercedDefault;
    };
    let chars = Text.toArray(t);
    if (not consumesFullValueStartingWith(chars, '{')) {
      return #coercedDefault;
    };
    if (t.size() > maxChars) {
      return #tooLarge;
    };
    #ok(t);
  };
};
