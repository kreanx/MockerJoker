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
  // Produce the CONST object by evaluating constants.js in isolation
  const getConst = new Function(read("shared/constants.js") + ";\nreturn CONST;");
  const CONST = getConst();
  const win = makeFakeWindow();
  let exported = null;
  globalThis.__RM_TEST_EXPORT = function (api) { exported = api; };
  try {
    // Pass CONST as a parameter — injected.js now references CONST.* directly.
    new Function("window", "CONST", read("content/injected.js"))(win, CONST);
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
      "\n;return {validateRule: validateRule, createDefaultRule: createDefaultRule, findRuleById: findRuleById, escapeAttr: escapeAttr, generateId: generateId, cloneRule: cloneRule, reorderArray: reorderArray};"
  );
  return factory(function () { return null; }, {});
}

// --- background/background.js — service worker logic over stubbed chrome.* ---
// Returns { bg, chrome } where `chrome` exposes spies: storage state,
// sendMessage recordings (runtime + tabs), captured onMessage/onConnect listeners.
function loadBackground(initialStorage) {
  const store = Object.assign({ rules: [], varSavers: [], masterEnabled: true }, initialStorage || {});
  const state = {
    runtimeMessages: [],   // messages sent via chrome.runtime.sendMessage
    tabMessages: [],       // messages sent via chrome.tabs.sendMessage
    runtimeListeners: [],
    connectListeners: [],
    tabsRemovedListeners: [],
    tabsUpdatedListeners: []
  };
  function makePort(name) {
    const port = {
      name: name,
      posted: [],
      msgListeners: [],
      disconnectListeners: [],
      postMessage(m) { port.posted.push(m); },
      onMessage: { addListener(fn) { port.msgListeners.push(fn); } },
      onDisconnect: { addListener(fn) { port.disconnectListeners.push(fn); } },
      disconnect() {
        port.disconnectListeners.forEach((fn) => fn());
      }
    };
    return port;
  }
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener(fn) { state.runtimeListeners.push(fn); } },
      onConnect: { addListener(fn) { state.connectListeners.push(fn); } },
      sendMessage(msg, cb) { state.runtimeMessages.push(msg); if (cb) cb({ success: true }); }
    },
    storage: {
      local: {
        get(defs, cb) {
          const out = {};
          for (const k of Object.keys(defs)) out[k] = store[k] !== undefined ? store[k] : defs[k];
          cb(out);
        },
        set(obj, cb) { Object.assign(store, obj); if (cb) cb(); }
      },
      session: {
        get(defs, cb) {
          const out = {};
          for (const k of Object.keys(defs)) out[k] = store[k] !== undefined ? store[k] : defs[k];
          cb(out);
        },
        set(obj, cb) { Object.assign(store, obj); if (cb) cb(); }
      }
    },
    tabs: {
      sendMessage(tabId, msg, cb) { state.tabMessages.push({ tabId, msg }); if (cb) cb(); },
      query(_, cb) { cb([]); },
      onRemoved: { addListener(fn) { state.tabsRemovedListeners.push(fn); } },
      onUpdated: { addListener(fn) { state.tabsUpdatedListeners.push(fn); } }
    },
    action: {
      setBadgeText() {}, setBadgeBackgroundColor() {}, setBadgeTextColor() {}
    }
  };
  const src = read("shared/constants.js") + "\n" +
    read("background/background.js").replace(/^importScripts\([^)]*\);/m, "");
  const factory = new Function("chrome", src);
  factory(chrome);
  return { chrome, state, store, makePort,
    send(msg, sender) {
      let response = null;
      const keepOpen = state.runtimeListeners.some((fn) => fn(msg, sender || {}, (r) => { response = r; }));
      return keepOpen === true ? response : response; // sync handlers respond immediately
    },
    connect(name) {
      const port = makePort(name);
      state.connectListeners.forEach((fn) => fn(port));
      return port;
    }
  };
}

module.exports = { loadJsonEditor, loadInjected, loadRulesStore, loadBackground, EXT };
