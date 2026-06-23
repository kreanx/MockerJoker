"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadRulesStore } = require("./_load");

const { validateRule, createDefaultRule, findRuleById, escapeAttr, generateId } = loadRulesStore();

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
