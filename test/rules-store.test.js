"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRulesStore } = require("./_load");

const { validateRule, createDefaultRule, findRuleById, escapeAttr, generateId, cloneRule, reorderArray } = loadRulesStore();

test("createDefaultRule: produces a well-formed default rule", () => {
  const r = createDefaultRule();
  assert.ok(r.id, "has an id");
  assert.strictEqual(r.enabled, true);
  assert.strictEqual(r.match.method, "ANY");
  assert.strictEqual(r.action.type, "mockResponse");
  assert.strictEqual(typeof r.action.status, "number");
  assert.ok(Array.isArray(r.action.transforms));
});

test("validateRule: accepts a rule once it has a url pattern", () => {
  const r = createDefaultRule();
  r.match.urlPattern = "/api/test";
  assert.equal(validateRule(r).valid, true);
});

test("validateRule: rejects malformed rules", () => {
  assert.equal(validateRule(null).valid, false, "null rejected");
  assert.equal(validateRule({ id: "x" }).valid, false, "missing match rejected");
  assert.equal(validateRule({ id: "x", match: { urlPattern: "/a" } }).valid, false, "missing action rejected");
  const noStatus = { id: "x", match: { urlPattern: "/a" }, action: { type: "mockResponse" } };
  assert.equal(validateRule(noStatus).valid, false, "mock without numeric status rejected");
});

test("findRuleById: lookup returns the rule or null", () => {
  const list = [{ id: "a" }, { id: "b" }];
  assert.strictEqual(findRuleById(list, "b"), list[1]);
  assert.strictEqual(findRuleById(list, "z"), null);
});

test("escapeAttr: neutralizes attribute-breaking characters", () => {
  assert.equal(escapeAttr('a"b'), "a&quot;b");
  assert.equal(escapeAttr("a<b>c"), "a&lt;b&gt;c");
  assert.equal(escapeAttr("a&b"), "a&amp;b");
  // a quote must never survive, so an attribute cannot be closed early
  assert.equal(escapeAttr('"><img src=x>').indexOf('"'), -1);
});

test("generateId: unique and uses a safe charset", () => {
  const a = generateId();
  const b = generateId();
  assert.notStrictEqual(a, b);
  assert.match(a, /^[0-9a-z]+$/);
});

// --- cloneRule (rule duplication) ---
test("cloneRule: deep copy with new id, (копия) suffix, disabled", () => {
  var rule = createDefaultRule();
  rule.name = "My API Mock";
  rule.enabled = true;
  rule.match.urlPattern = "*/api/users*";
  var clone = cloneRule(rule);
  assert.notStrictEqual(clone.id, rule.id);
  assert.equal(clone.name, "My API Mock (копия)");
  assert.equal(clone.enabled, false);
  assert.equal(clone.match.urlPattern, "*/api/users*");
  clone.match.urlPattern = "changed";
  assert.equal(rule.match.urlPattern, "*/api/users*", "original unmutated");
});

test("cloneRule: handles empty name", () => {
  var clone = cloneRule(createDefaultRule());
  assert.equal(clone.name, "Правило (копия)");
});

// --- reorderArray (drag-and-drop) ---
test("reorderArray: move forward (insert before)", () => {
  var a = ["a", "b", "c", "d"];
  reorderArray(a, 0, 2, true);
  assert.deepEqual(a, ["b", "a", "c", "d"]);
});
test("reorderArray: move backward (insert before)", () => {
  var a = ["a", "b", "c", "d"];
  reorderArray(a, 3, 1, true);
  assert.deepEqual(a, ["a", "d", "b", "c"]);
});
test("reorderArray: move after target", () => {
  var a = ["a", "b", "c", "d"];
  reorderArray(a, 0, 2, false);
  assert.deepEqual(a, ["b", "c", "a", "d"]);
});
test("reorderArray: no-op same index", () => {
  var a = ["a", "b", "c"];
  reorderArray(a, 1, 1, true);
  assert.deepEqual(a, ["a", "b", "c"]);
});
test("reorderArray: no-op invalid indices", () => {
  var a = ["a", "b"];
  reorderArray(a, -1, 0, true);
  reorderArray(a, 0, 99, true);
  assert.deepEqual(a, ["a", "b"]);
});
