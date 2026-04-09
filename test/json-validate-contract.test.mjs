/**
 * Contract examples for hub/icp JsonValidate.mo (enrich fragments).
 * Motoko implementation mirrors RFC 8259 subset; these cases must stay parseable as JSON
 * values and match JSON.parse for acceptance (including trailing whitespace after the value).
 */
import assert from 'node:assert';
import test from 'node:test';

const validArrays = ['[]', '[1]', ' [ "a" ] ', '[1]\n', '["x","y"]'];
const validObjects = ['{}', '{"a":1}', ' { } ', '{"k":[1,2]}'];

for (const s of validArrays) {
  test(`valid JSON array: ${JSON.stringify(s)}`, () => {
    const v = JSON.parse(s);
    assert.ok(Array.isArray(v));
  });
}

for (const s of validObjects) {
  test(`valid JSON object: ${JSON.stringify(s)}`, () => {
    const v = JSON.parse(s);
    assert.ok(v !== null && typeof v === 'object' && !Array.isArray(v));
  });
}

const invalidAsArray = ['{}', '[', '[1,]', '{"a":1}', '[broken', ''];
for (const s of invalidAsArray) {
  test(`not a JSON array (parse fails or not array): ${JSON.stringify(s)}`, () => {
    try {
      const v = JSON.parse(s);
      assert.ok(notArray(v), 'expected not array');
    } catch {
      assert.ok(true);
    }
  });
}

function notArray(v) {
  return !Array.isArray(v);
}
