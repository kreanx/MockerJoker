"use strict";

// Test harness: loads the extension's plain (non-module) source files into
// isolated Function scopes with the browser globals they need stubbed.
// Zero external dependencies — uses only Node built-ins.

const fs = require("fs");
const path = require("path");

const EXT = path.join(__dirname, "..", "extension");
function read(rel) {
  return fs.readFileSync(path.join(EXT, rel), "utf8");
}

// --- shared/json-editor.js — pure syntax + search highlighting ---
function loadJsonEditor() {
  const src = read("shared/json-editor.js");
  const factory = new Function(
    "$", "document",
    src +
      "\n;return {highlightJSON: highlightJSON, applySearchHighlight: applySearchHighlight, getHighlightedHTML: getHighlightedHTML};"
  );
  return factory(function () { return null; }, {});
}

// --- content/injected.js — request matching / transform core, via test hook ---
function makeFakeWindow() {
  const xhrProto = {
    open: function () {},
    send: function () {},
    setRequestHeader: function () {},
    getResponseHeader: function () { return null; },
    getAllResponseHeaders: function () { return ""; },
    dispatchEvent: function () {}
  };
  function XMLHttpRequest() {
    Object.assign(this, Object.create(xhrProto));
  }
  XMLHttpRequest.prototype = xhrProto;
  return {
    fetch: function () { return Promise.resolve({}); },
    XMLHttpRequest: XMLHttpRequest,
    postMessage: function () {},
    addEventListener: function () {},
    location: { href: "https://app.example.com/page" }
  };
}

function loadInjected() {
  const src = read("content/injected.js");
  const win = makeFakeWindow();
  let exported = null;
  globalThis.__RM_TEST_EXPORT = function (api) { exported = api; };
  try {
    new Function("window", src)(win);
  } finally {
    delete globalThis.__RM_TEST_EXPORT;
  }
  if (!exported) throw new Error("injected.js test-export hook did not fire");
  return exported;
}

// --- shared/{constants,utils,rules-store}.js — rule validation / escaping ---
function loadRulesStore() {
  const src =
    read("shared/constants.js") + "\n" + read("shared/utils.js") + "\n" + read("shared/rules-store.js");
  const factory = new Function(
    "$", "document",
    src +
      "\n;return {validateRule: validateRule, createDefaultRule: createDefaultRule, findRuleById: findRuleById, escapeAttr: escapeAttr, generateId: generateId};"
  );
  return factory(function () { return null; }, {});
}

module.exports = { loadJsonEditor, loadInjected, loadRulesStore, EXT };
