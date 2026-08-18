"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadInjected } = require("./_load");

const api = loadInjected();
const {
  globToRegex, parseGraphQL, splitPath, getByPath, setByPath,
  matchBodyConditions, resolveVarsInString, applyBodyTransforms,
  parseValue, bpInfo, matchVarConditions, saveVariables, processVarSavers, findAllRules,
  hasMatchingResponseVarSaver, _setRuntime
} = api;

// Reset shared runtime state before each group of assertions.
function runtime(rules, varSavers, tabVars, master) {
  _setRuntime(rules || [], varSavers || [], tabVars || {}, master !== false);
}

// ---------- globToRegex ----------
test("globToRegex: anchored full-match (pattern must cover the whole URL)", () => {
  assert.equal(globToRegex("/api/users").test("/api/users"), true);
  assert.equal(globToRegex("/api/users").test("https://x/api/users"), false, "anchored ^...$ rejects prefix");
});

test("globToRegex: '*' maps to .* and matches across the whole string", () => {
  assert.equal(globToRegex("*/api/users*").test("https://x/api/users"), true);
  assert.equal(globToRegex("*/api/*").test("https://x/api/a/b"), true);
  assert.equal(globToRegex("*").test("https://anything/whatever"), true);
});

test("globToRegex: case-insensitive", () => {
  assert.equal(globToRegex("*/api*").test("https://X/API/USERS"), true);
});

test("globToRegex: memoizes compiled regex (identity reuse)", () => {
  assert.strictEqual(globToRegex("/x"), globToRegex("/x"));
});

test("globToRegex: rejects empty and overlong patterns", () => {
  assert.equal(globToRegex("").test("anything"), false);
  assert.equal(globToRegex("x".repeat(501)).test("x".repeat(501)), false);
});

// ---------- parseValue ----------
test("parseValue: JSON-literal semantics — bare scalars typed, quoted stay strings", () => {
  assert.strictEqual(parseValue("true"), true);
  assert.strictEqual(parseValue("false"), false);
  assert.strictEqual(parseValue("null"), null);
  assert.strictEqual(parseValue("42"), 42);
  assert.strictEqual(parseValue("-3.14"), -3.14);
  assert.strictEqual(parseValue("hello"), "hello");
  // quoted -> string with quotes stripped (the "number as string" use case)
  assert.strictEqual(parseValue('"123"'), "123");
  assert.strictEqual(parseValue('"true"'), "true");
  assert.strictEqual(parseValue('"null"'), "null");
  // JSON literals become real arrays/objects
  assert.deepEqual(parseValue("[1,2]"), [1, 2]);
  assert.deepEqual(parseValue('{"a":1}'), { a: 1 });
  // leading zeros: unquoted stays legacy number coercion, quoted is a string
  assert.strictEqual(parseValue("007"), 7);
  assert.strictEqual(parseValue('"007"'), "007");
  // single quotes are string markers too (content verbatim); JSON wins over them
  assert.strictEqual(parseValue("'123'"), "123");
  assert.strictEqual(parseValue("'007'"), "007");
  assert.strictEqual(parseValue("''"), "");
  assert.strictEqual(parseValue("\"'123'\""), "'123'");
  assert.strictEqual(parseValue(""), "");
  // non-strings pass through untouched
  assert.strictEqual(parseValue(7), 7);
});

// ---------- path utils ----------
test("splitPath: dots, [idx], [*], empty", () => {
  assert.deepEqual(splitPath("a.b.c"), ["a", "b", "c"]);
  assert.deepEqual(splitPath("items[0].name"), ["items", "0", "name"]);
  assert.deepEqual(splitPath("a[*].b"), ["a", "*", "b"]);
  assert.deepEqual(splitPath(""), []);
});

test("getByPath: nested objects + array index", () => {
  const o = { a: { b: { c: 7 } }, items: [{ name: "x" }] };
  assert.strictEqual(getByPath(o, "a.b.c"), 7);
  assert.strictEqual(getByPath(o, "items[0].name"), "x");
  assert.strictEqual(getByPath(o, "missing.path"), undefined);
});

test("getByPath: '*' wildcard collects across arrays", () => {
  const o = { items: [{ id: 1 }, { id: 2 }, { id: 3 }] };
  assert.deepEqual(getByPath(o, "items[*].id"), [1, 2, 3]);
});

test("setByPath: sets nested + creates intermediate objects/arrays", () => {
  const o = {};
  setByPath(o, "a.b.c", 9);
  assert.strictEqual(o.a.b.c, 9);
  setByPath(o, "arr[2].name", "z");
  assert.strictEqual(o.arr.length, 3);
  assert.strictEqual(o.arr[2].name, "z");
  assert.strictEqual(o.arr[0], undefined);
});

test("setByPath: blocks prototype-pollution keys", () => {
  const o = {};
  setByPath(o, "__proto__.polluted", "yes");
  setByPath(o, "constructor.prototype.x", "yes");
  assert.equal(({}).polluted, undefined);
  assert.equal(({}).x, undefined);
});

// ---------- matchBodyConditions ----------
test("matchBodyConditions: equals / notEquals / contains / exists + array contains", () => {
  const body = { user: { id: 5, name: "Alice", tags: ["a", "b"] } };
  assert.equal(matchBodyConditions(body, [{ path: "user.id", operator: "equals", value: '"5"' }]), false);
  assert.equal(matchBodyConditions(body, [{ path: "user.name", operator: "equals", value: '"Alice"' }]), true);
  assert.equal(matchBodyConditions(body, [{ path: "user.id", operator: "notEquals", value: "9" }]), true);
  assert.equal(matchBodyConditions(body, [{ path: "user.name", operator: "contains", value: "lic" }]), true);
  assert.equal(matchBodyConditions(body, [{ path: "user.name", operator: "contains", value: "zzz" }]), false);
  assert.equal(matchBodyConditions(body, [{ path: "user.email", operator: "exists", value: "" }]), false);
  assert.equal(matchBodyConditions(body, [{ path: "user.tags", operator: "contains", value: "b" }]), true);
  assert.equal(matchBodyConditions(body, []), true);
  assert.equal(matchBodyConditions(null, [{ path: "x", operator: "equals", value: "1" }]), false);
});

// ---------- variable resolution ----------
test("resolveVarsInString: substitutes $var, objects become JSON, unknown left intact", () => {
  runtime([], [], { $token: "abc123", $obj: { k: 1 } });
  assert.equal(resolveVarsInString("Bearer $token"), "Bearer abc123");
  assert.equal(resolveVarsInString("$obj"), JSON.stringify({ k: 1 }));
  assert.equal(resolveVarsInString("$missing stays"), "$missing stays");
  assert.equal(resolveVarsInString("plain text"), "plain text");
});

test("applyBodyTransforms: sets values, quoted literals stay strings, $var keeps its type", () => {
  runtime([], [], { $newId: 99, $code: "007" });
  const body = { id: 1, code: 0, num: null, nested: { x: 0 }, label: null };
  applyBodyTransforms(body, [
    { path: "id", value: "$newId" },      // number var -> number
    { path: "code", value: "$code" },     // string var "007" stays string, not 7
    { path: "num", value: "007" },        // bare literal keeps legacy coercion -> 7
    { path: "nested.x", value: '"5"' },   // double-quoted literal -> string "5"
    { path: "label", value: "'5'" }       // single-quoted literal -> string "5"
  ]);
  assert.strictEqual(body.id, 99);
  assert.strictEqual(body.code, "007");
  assert.strictEqual(body.num, 7);
  assert.strictEqual(body.nested.x, "5");
  assert.strictEqual(body.label, "5");
});

test("bpInfo: outcome for the interception-log column", () => {
  assert.deepEqual(bpInfo("request", { action: "abort" }), { phase: "request", outcome: "aborted" });
  assert.deepEqual(bpInfo("request", { action: "resume", mods: { body: "x" } }), { phase: "request", outcome: "edited" });
  assert.deepEqual(bpInfo("response", { action: "resume", mods: {} }), { phase: "response", outcome: "passed" });
  assert.deepEqual(bpInfo("response", { action: "resume" }), { phase: "response", outcome: "passed" });
});

test("matchVarConditions: checks tabVars", () => {
  runtime([], [], { $count: 5, $role: "admin" });
  assert.equal(matchVarConditions([{ var: "$count", operator: "equals", value: "5" }]), true);
  assert.equal(matchVarConditions([{ var: "$role", operator: "contains", value: "dmi" }]), true);
  assert.equal(matchVarConditions([{ var: "$role", operator: "notEquals", value: "user" }]), true);
  assert.equal(matchVarConditions([{ var: "$missing", operator: "exists", value: "" }]), false);
  assert.equal(matchVarConditions([]), true);
});

// ---------- parseGraphQL ----------
test("parseGraphQL: detects query/operationName, ignores non-gql bodies", () => {
  assert.ok(parseGraphQL('{"query":"{ x }","operationName":"GetX"}'));
  assert.equal(parseGraphQL('{"foo":"bar"}'), null);
  assert.equal(parseGraphQL(null), null);
  assert.equal(parseGraphQL("not json"), null);
});

// ---------- saveVariables ----------
test("saveVariables: extracts from body / header / status", () => {
  runtime([], [], {});
  saveVariables([{ var: "$bid", source: "body", path: "data.id" }], { data: { id: 42 } }, {}, 200);
  saveVariables([{ var: "$hid", source: "header", path: "X-Token" }], null, { "x-token": "abc" }, 200);
  saveVariables([{ var: "$sid", source: "status" }], null, {}, 404);
  assert.equal(resolveVarsInString("$bid"), "42");
  assert.equal(resolveVarsInString("$hid"), "abc");
  assert.equal(resolveVarsInString("$sid"), "404");
});

// ---------- processVarSavers (GraphQL operation filter) ----------
test("processVarSavers: graphql filter matches operationName from request body", () => {
  runtime([], [
    { urlPattern: "*", source: "body", target: "request", path: "variables.input.id", varName: "$reqId", graphql: true, graphqlOperation: "CreateBucket", enabled: true }
  ], {});
  const reqBody = { query: "mutation CreateBucket($input: CreateBucketInput!) { createBucket(input: $input) { id } }", variables: { input: { id: "bucket-1" } }, operationName: "CreateBucket" };
  processVarSavers("https://x/graphql", reqBody, {}, null, "request", reqBody);
  assert.equal(resolveVarsInString("$reqId"), "bucket-1");
});

test("processVarSavers: graphql filter skips other operations and plain JSON", () => {
  runtime([], [
    { urlPattern: "*", source: "body", target: "request", path: "variables.input.id", varName: "$reqId", graphql: true, graphqlOperation: "CreateBucket", enabled: true }
  ], {});
  const other = { query: "query GetUser { user { id } }", variables: { input: { id: "bucket-2" } }, operationName: "GetUser" };
  processVarSavers("https://x/graphql", other, {}, null, "request", other);
  assert.equal(resolveVarsInString("$reqId"), "$reqId", "other operation must not save");
  processVarSavers("https://x/graphql", { foo: "bar" }, {}, null, "request", { foo: "bar" });
  assert.equal(resolveVarsInString("$reqId"), "$reqId", "non-GraphQL body must not save");
});

test("processVarSavers: graphql without operation matches any GraphQL operation", () => {
  runtime([], [
    { urlPattern: "*", source: "body", target: "request", path: "operationName", varName: "$gqlOp", graphql: true, graphqlOperation: "", enabled: true }
  ], {});
  processVarSavers("https://x/graphql", { query: "{ x }", operationName: "GetX" }, {}, null, "request", { query: "{ x }", operationName: "GetX" });
  assert.equal(resolveVarsInString("$gqlOp"), "GetX");
  processVarSavers("https://x/graphql", { foo: "bar" }, {}, null, "request", { foo: "bar" });
  assert.equal(resolveVarsInString("$gqlOp"), "GetX", "non-GraphQL body must not update");
});

test("processVarSavers: graphql operation supports glob patterns", () => {
  runtime([], [
    { urlPattern: "*", source: "body", target: "request", path: "operationName", varName: "$gqlGlob", graphql: true, graphqlOperation: "*Bucket*", enabled: true }
  ], {});
  processVarSavers("https://x/graphql", { query: "mutation CreateBucket { x }", operationName: "CreateBucket" }, {}, null, "request", { query: "mutation CreateBucket { x }", operationName: "CreateBucket" });
  assert.equal(resolveVarsInString("$gqlGlob"), "CreateBucket");
});

test("processVarSavers: response-target saver matches operation from the triggering request", () => {
  runtime([], [
    { urlPattern: "*", source: "body", target: "response", path: "data.bucketId", varName: "$respBucket", graphql: true, graphqlOperation: "CreateBucket", enabled: true }
  ], {});
  const respBody = { data: { bucketId: "b-777" } };
  const reqCreate = { query: "mutation CreateBucket { x }", operationName: "CreateBucket" };
  processVarSavers("https://x/graphql", respBody, {}, 200, "response", reqCreate);
  assert.equal(resolveVarsInString("$respBucket"), "b-777");
  const reqOther = { query: "query GetUser { x }", operationName: "GetUser" };
  processVarSavers("https://x/graphql", respBody, {}, 200, "response", reqOther);
  assert.equal(resolveVarsInString("$respBucket"), "b-777", "mismatched operation must keep previous value");
});

test("processVarSavers: legacy savers without graphql field keep working", () => {
  runtime([], [
    { urlPattern: "*", source: "body", target: "request", path: "id", varName: "$legacy", enabled: true }
  ], {});
  processVarSavers("https://x/api", { id: 5 }, {}, null, "request", { id: 5 });
  assert.equal(resolveVarsInString("$legacy"), "5");
});

// ---------- findAllRules ----------
test("findAllRules: URL + method + enabled filtering", () => {
  runtime([
    { id: "r1", enabled: true, match: { urlPattern: "*/api/users*", method: "GET" },
      action: { type: "mockResponse", status: 200, body: "{}" } },
    { id: "r2", enabled: false, match: { urlPattern: "*" },
      action: { type: "mockResponse", status: 200, body: "{}" } },
    { id: "r3", enabled: true, match: { urlPattern: "*", method: "POST" },
      action: { type: "modifyBody", transforms: [] } }
  ]);
  const matched = findAllRules("https://x/api/users", "GET", null);
  const ids = matched.map(function (r) { return r.id; });
  assert.ok(ids.indexOf("r1") !== -1);
  assert.equal(ids.indexOf("r2"), -1, "disabled rule excluded");
  assert.equal(ids.indexOf("r3"), -1, "method mismatch excluded");
});

test("findAllRules: masterEnabled=false disables all matching", () => {
  runtime(
    [{ id: "r1", enabled: true, match: { urlPattern: "*" }, action: { type: "mockResponse", status: 200, body: "{}" } }],
    [], {}, false
  );
  assert.equal(findAllRules("https://x/any", "GET", null).length, 0);
});

test("findAllRules: bodyConditions gate modify-type rules", () => {
  runtime([
    { id: "r1", enabled: true,
      match: { urlPattern: "*/api*", method: "ANY", bodyConditions: [{ path: "id", operator: "equals", value: "7" }] },
      action: { type: "modifyBody", transforms: [{ path: "id", value: "8" }] } }
  ]);
  assert.equal(findAllRules("https://x/api", "POST", { id: 7 }).length, 1);
  assert.equal(findAllRules("https://x/api", "POST", { id: 9 }).length, 0);
});

// ---------- hasMatchingResponseVarSaver (response body-read gate) ----------
test("hasMatchingResponseVarSaver: gated by URL, target, and enabled", () => {
  runtime([], [
    { urlPattern: "*/api/token*", source: "body", target: "response", varName: "$t", enabled: true },
    { urlPattern: "*/api/other*", source: "body", target: "request", varName: "$r", enabled: true },
    { urlPattern: "*/api/x*", source: "body", target: "response", varName: "$d", enabled: false }
  ]);
  assert.equal(hasMatchingResponseVarSaver("https://x/api/token"), true);
  assert.equal(hasMatchingResponseVarSaver("https://x/api/unrelated"), false);
  assert.equal(hasMatchingResponseVarSaver("https://x/api/other"), false, "request-target excluded");
  assert.equal(hasMatchingResponseVarSaver("https://x/api/x"), false, "disabled excluded");
});
