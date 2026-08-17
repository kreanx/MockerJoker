"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadInjected, loadBackground } = require("./_load.js");

// ---------- injected.js: findBreakpointRule ----------

test("findBreakpointRule: malformed rule without match does not throw", () => {
  const api = loadInjected();
  api._setRuntime(
    [{ id: "bp1", type: "breakpoint", enabled: true }], // no match — must be skipped, not crash
    [], {}, true
  );
  assert.equal(api.findBreakpointRule("https://x.com/api", "GET"), null);
});

test("findBreakpointRule: glob + method matching, disabled skipped", () => {
  const api = loadInjected();
  api._setRuntime([
    { id: "bp1", type: "breakpoint", enabled: true, match: { urlPattern: "*/api/*", method: "ANY" }, breakpoint: { phase: "response" } },
    { id: "bp2", type: "breakpoint", enabled: false, match: { urlPattern: "*", method: "ANY" }, breakpoint: { phase: "request" } },
    { id: "bp3", type: "breakpoint", enabled: true, match: { urlPattern: "*/api/*", method: "POST" }, breakpoint: { phase: "request" } }
  ], [], {}, true);
  assert.equal(api.findBreakpointRule("https://x.com/api/users", "GET").id, "bp1");
  assert.equal(api.findBreakpointRule("https://x.com/other", "GET"), null); // glob must match
  assert.equal(api.findBreakpointRule("https://x.com/api/users", "POST").id, "bp1"); // first match wins
});

// ---------- injected.js: applyBpRequestMods ----------

test("applyBpRequestMods: null mods returns same args untouched", () => {
  const api = loadInjected();
  const input = "https://x.com/api";
  const init = { method: "GET", headers: { a: "1" } };
  const out = api.applyBpRequestMods(input, init, null);
  assert.equal(out.input, input);
  assert.equal(out.init, init);
});

test("applyBpRequestMods: url/method/body applied, input objects not mutated", () => {
  const api = loadInjected();
  const init = { method: "GET", headers: { a: "1" }, body: "orig" };
  const out = api.applyBpRequestMods("https://x.com/api", init, {
    url: "https://x.com/api/v2", method: "post", body: '{"edited":true}'
  });
  assert.equal(out.input, "https://x.com/api/v2");
  assert.equal(out.init.method, "POST");
  assert.equal(out.init.body, '{"edited":true}');
  // originals untouched
  assert.equal(init.method, "GET");
  assert.equal(init.body, "orig");
  assert.notEqual(init.headers, out.init.headers);
});

test("applyBpRequestMods: init undefined → created", () => {
  const api = loadInjected();
  const out = api.applyBpRequestMods("https://x.com", undefined, { method: "PUT" });
  assert.deepEqual(out.init, { method: "PUT" });
});

// ---------- injected.js: buildBpResponse ----------

test("buildBpResponse: no effective change → null", () => {
  const api = loadInjected();
  assert.equal(api.buildBpResponse(200, { "content-type": "application/json" }, '{"a":1}', null), null);
  assert.equal(api.buildBpResponse(200, {}, '{"a":1}', {}), null);
  assert.equal(api.buildBpResponse(200, {}, '{"a":1}', { status: 200, body: '{"a":1}' }), null);
});

test("buildBpResponse: body and status edits produce a new Response", async () => {
  const api = loadInjected();
  const mod = api.buildBpResponse(200, { "x-k": "v" }, '{"a":1}', { status: 500, body: '{"a":2}' });
  assert.notEqual(mod, null);
  assert.equal(mod.status, 500);
  assert.equal(await mod.text(), '{"a":2}');
  assert.equal(mod.headers.get("x-k"), "v");
});

test("buildBpResponse: status outside 200-599 falls back to original", async () => {
  const api = loadInjected();
  const stringStatus = api.buildBpResponse(200, {}, "body", { status: "404", body: "nf" });
  assert.equal(stringStatus.status, 404);
  const invalid = api.buildBpResponse(200, {}, "body", { status: 999 });
  assert.equal(invalid, null); // 999 rejected → status unchanged → body unchanged → null
  const statusOnly = api.buildBpResponse(200, {}, "body", { status: 150 });
  assert.equal(statusOnly, null);
});

test("buildBpResponse: 204/205/304 must not carry a body", async () => {
  const api = loadInjected();
  const mod = api.buildBpResponse(200, {}, "body", { status: 204, body: "nope" });
  assert.equal(mod.status, 204);
  assert.equal(await mod.text(), "");
});

// ---------- background.js: breakpoint routing ----------

function bpRule(id, phase) {
  return { id, type: "breakpoint", enabled: true, match: { urlPattern: "*/api/*", method: "ANY" }, breakpoint: { phase, extracts: [] } };
}

test("background: saveBreakpoints merges into rules and pushes to tabs", () => {
  const bg = loadBackground({ rules: [{ id: "r1", type: "mockResponse", match: { urlPattern: "*" }, action: {} }] });
  bg.send({ type: "saveBreakpoints", breakpoints: [bpRule("bp9", "response")] });
  assert.deepEqual(bg.store.rules.map((r) => r.id).sort(), ["bp9", "r1"]);
  assert.equal(bg.store.rules.find((r) => r.id === "bp9").type, "breakpoint");
});

test("background: SAVE_RULES from popup preserves breakpoints created meanwhile", () => {
  const bg = loadBackground({ rules: [{ id: "r1", type: "mockResponse", match: {}, action: {} }, bpRule("bpX", "request")] });
  // popup saved a stale array that does not know about bpX
  bg.send({ type: "saveRules", rules: [{ id: "r2", type: "mockResponse", match: {}, action: {} }], masterEnabled: true });
  const ids = bg.store.rules.map((r) => r.id).sort();
  assert.ok(ids.includes("bpX"), "breakpoint must survive popup save: " + ids);
  assert.ok(ids.includes("r2"));
  assert.ok(!ids.includes("r1"), "old rule replaced by popup save");
});

test("background: breakpoint hit with no panel auto-resumes to its tab", () => {
  const bg = loadBackground();
  bg.send({ type: "breakpointHit", bpMsgId: "bp_1", data: { phase: "response" } }, { tab: { id: 7 } });
  assert.equal(bg.state.tabMessages.length, 1);
  assert.equal(bg.state.tabMessages[0].tabId, 7);
  assert.equal(bg.state.tabMessages[0].msg.type, "breakpointResume");
  assert.equal(bg.state.tabMessages[0].msg.result.action, "resume");
});

test("background: hit routed to the panel inspecting that tab; resume clears pending", () => {
  const bg = loadBackground();
  const port7 = bg.connect("devtools:7");
  bg.connect("devtools:9"); // panel for another tab must not receive tab 7 hits

  bg.send({ type: "breakpointHit", bpMsgId: "bp_1", data: { phase: "request" } }, { tab: { id: 7 } });
  assert.equal(port7.posted.filter((m) => m.type === "breakpoint").length, 1);
  assert.equal(port7.posted.find((m) => m.type === "breakpoint").bpMsgId, "bp_1");
  assert.equal(bg.state.tabMessages.length, 0, "no auto-resume while a panel holds the tab");

  // resume via port
  port7.msgListeners.forEach((fn) => fn({ type: "breakpointResume", bpMsgId: "bp_1", result: { action: "abort" } }));
  assert.equal(bg.state.tabMessages.length, 1);
  assert.equal(bg.state.tabMessages[0].msg.result.action, "abort");

  // duplicate resume must not re-send
  port7.msgListeners.forEach((fn) => fn({ type: "breakpointResume", bpMsgId: "bp_1", result: { action: "resume" } }));
  assert.equal(bg.state.tabMessages.length, 1);
});

test("background: panel disconnect resumes its tab's pending breakpoints", () => {
  const bg = loadBackground();
  const port7 = bg.connect("devtools:7");
  bg.send({ type: "breakpointHit", bpMsgId: "bp_1", data: {} }, { tab: { id: 7 } });
  bg.send({ type: "breakpointHit", bpMsgId: "bp_2", data: {} }, { tab: { id: 7 } });
  assert.equal(bg.state.tabMessages.length, 0);

  port7.disconnect();
  assert.equal(bg.state.tabMessages.length, 2);
  assert.ok(bg.state.tabMessages.every((t) => t.msg.result.action === "resume"));
});

test("background: legacy port name is ignored", () => {
  const bg = loadBackground();
  bg.connect("devtools");
  bg.send({ type: "breakpointHit", bpMsgId: "bp_1", data: {} }, { tab: { id: 7 } });
  assert.equal(bg.state.tabMessages.length, 1, "no panel for tab 7 → auto-resume");
});

test("background: tab close resumes its pending breakpoints", () => {
  const bg = loadBackground();
  const port7 = bg.connect("devtools:7");
  bg.send({ type: "breakpointHit", bpMsgId: "bp_1", data: {} }, { tab: { id: 7 } });
  bg.send({ type: "breakpointHit", bpMsgId: "bp_2", data: {} }, { tab: { id: 7 } });
  bg.send({ type: "breakpointHit", bpMsgId: "bp_3", data: {} }, { tab: { id: 8 } });
  assert.equal(bg.state.tabMessages.length, 1); // tab 8 has no panel → auto-resume

  bg.state.tabsRemovedListeners.forEach((fn) => fn(7));
  // tab 7's pendings resumed, tab 8's left with its panel
  const resumed = bg.state.tabMessages.map((t) => t.msg.bpMsgId).sort();
  assert.deepEqual(resumed, ["bp_1", "bp_2", "bp_3"]); // bp_3 = earlier auto-resume
  // duplicate resume (e.g. later port disconnect) must not re-send
  port7.disconnect();
  assert.equal(bg.state.tabMessages.length, 3);
});

// ---------- injected.js local CONST must stay in sync with shared/constants.js ----------
// injected.js deliberately re-declares CONST (page-context isolation). When a
// new message type is added only to shared/constants.js, injected silently
// posts {type: undefined} — this exact bug shipped with the first breakpoint
// release. This test fails on any future desync.
test("injected.js local CONST.PAGE_MSG covers every type in shared/constants.js", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "..", "extension", "content", "injected.js"), "utf8");
  const m = /var CONST = (\{[\s\S]*?\n  \});/.exec(src);
  assert.ok(m, "local CONST block not found in injected.js");
  const localConst = new Function("return " + m[1])();
  const sharedSrc = fs.readFileSync(path.join(__dirname, "..", "extension", "shared", "constants.js"), "utf8");
  const sharedConst = new Function(sharedSrc + "; return CONST;")();
  for (const key of Object.keys(sharedConst.PAGE_MSG)) {
    assert.ok(localConst.PAGE_MSG.hasOwnProperty(key),
      `injected.js local CONST.PAGE_MSG is missing "${key}" (shared/constants.js has it) — messages of this type will be posted as undefined`);
    assert.equal(localConst.PAGE_MSG[key], sharedConst.PAGE_MSG[key], `PAGE_MSG.${key} value mismatch`);
  }
});
