"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadJsonEditor } = require("./_load");

const { highlightJSON, applySearchHighlight, getHighlightedHTML } = loadJsonEditor();

function countMarks(html) {
  return (html.match(/<mark/g) || []).length;
}

test("highlightJSON: empty/null input returns a bare newline", () => {
  assert.strictEqual(highlightJSON(""), "\n");
  assert.strictEqual(highlightJSON(null), "\n");
});

test("highlightJSON: HTML-escapes < > & so output is inject-safe", () => {
  const out = highlightJSON('"a<b>&c"');
  assert.ok(out.includes("&lt;"));
  assert.ok(out.includes("&gt;"));
  assert.ok(out.includes("&amp;"));
  assert.equal(out.indexOf("<b>"), -1, "no raw < must survive");
});

test("highlightJSON: wraps each JSON token type in its class span", () => {
  const out = highlightJSON('{ "k": 1, "s": "v", "b": true, "n": null }');
  assert.match(out, /<span class="json-key">"k":<\/span>/);
  assert.match(out, /<span class="json-number">1<\/span>/);
  assert.match(out, /<span class="json-string">"v"<\/span>/);
  assert.match(out, /<span class="json-boolean">true<\/span>/);
  assert.match(out, /<span class="json-null">null<\/span>/);
});

test("highlightJSON: bodies past the safety cap render without spans", () => {
  const big = '"' + "a".repeat(1000001) + '"';
  const out = highlightJSON(big);
  assert.equal(out.indexOf("<span"), -1, "no syntax spans above the cap");
  assert.ok(out.length > 1000000);
});

test("highlightJSON: typical large body (~60k) IS syntax-highlighted now", () => {
  const obj = {};
  for (let i = 0; i < 1700; i++) obj["field_" + i] = "value_" + i;
  const out = highlightJSON(JSON.stringify(obj, null, 2));
  assert.match(out, /<span class="json-key">/);
});

test("applySearchHighlight: empty query is a no-op", () => {
  const html = '<span class="x">abc</span>';
  assert.strictEqual(applySearchHighlight(html, ""), html);
});

test("applySearchHighlight: wraps content matches and never injects inside a tag", () => {
  const body = JSON.stringify({ a: "json", b: "json" }, null, 2);
  const html = highlightJSON(body);
  const out = applySearchHighlight(html, "json");
  // "json" occurs twice in content; occurrences inside class="json-string" are skipped
  assert.equal(countMarks(out), 2);
  assert.equal(/class="[^"]*<mark/.test(out), false, "no mark may land inside an attribute");
});

test("applySearchHighlight: regex-special chars in query are treated literally", () => {
  const body = JSON.stringify({ expr: "a.b(c)*" });
  const out = applySearchHighlight(highlightJSON(body), "a.b(c)*");
  assert.ok(countMarks(out) >= 1);
});

test("applySearchHighlight: matching is case-insensitive", () => {
  const out = applySearchHighlight(highlightJSON(JSON.stringify({ x: "Value" })), "value");
  assert.equal(countMarks(out), 1);
});

test("applySearchHighlight: large input completes fast (regression: was O(n^2), ~1.1s)", () => {
  const obj = {};
  for (let i = 0; i < 5000; i++) obj["k_" + i] = "val_" + i;
  const html = highlightJSON(JSON.stringify(obj, null, 2));
  const t0 = process.hrtime.bigint();
  const out = applySearchHighlight(html, "val");
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(countMarks(out), 5000);
  assert.ok(ms < 60, "expected < 60ms, got " + ms.toFixed(1) + "ms");
});

test("getHighlightedHTML: caches per textarea value, rebuilds on change", () => {
  const tid = "ta-cache";
  const first = getHighlightedHTML(tid, { value: '{"a":1}' });
  const cached = getHighlightedHTML(tid, { value: '{"a":1}' }); // same value
  assert.strictEqual(first, cached);
  const rebuilt = getHighlightedHTML(tid, { value: '{"a":2}' }); // different value
  assert.notStrictEqual(first, rebuilt);
});
