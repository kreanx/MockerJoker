importScripts("../shared/constants.js");


var currentRules = [];
var varSavers = [];
var masterEnabled = true;
var rulesLoaded = false;
var loadCallbacks = [];

var hitCounters = {};
var lastHitTime = {};
var tabSeenRequests = {};
var tabVarsMap = {};
var tabInterceptedCount = {};
var interceptionLog = {};
// DevTools panel ports, keyed by the tab they inspect ("devtools:<tabId>").
// Breakpoint hits are routed ONLY to the panel inspecting that tab; if there
// is none, the request is auto-resumed so it never hangs.
var devtoolsPorts = {};
var pendingBreakpoints = {};

function updateBadge(tabId) {
  var count = tabInterceptedCount[tabId] || 0;
  var text = count > 0 ? String(count > 999 ? "999+" : count) : "";
  try {
    chrome.action.setBadgeText({ text: text, tabId: tabId });
    chrome.action.setBadgeBackgroundColor({ color: "#cba6f7", tabId: tabId });
    if (chrome.action.setBadgeTextColor) {
      chrome.action.setBadgeTextColor({ color: "#1e1e2e", tabId: tabId });
    }
  } catch (e) {}
}

function loadRules() {
  chrome.storage.local.get({ rules: [], varSavers: [], masterEnabled: true }, function (data) {
    currentRules = data.rules || [];
    varSavers = data.varSavers || [];
    masterEnabled = data.masterEnabled !== false;
    rulesLoaded = true;
    pushToAllTabs();
    loadCallbacks.forEach(function (cb) { cb(); });
    loadCallbacks = [];
  });
}

function waitForRules(callback) {
  if (rulesLoaded) {
    callback();
  } else {
    loadCallbacks.push(callback);
  }
}

function saveRules(rules, master) {
  currentRules = rules;
  if (typeof master === "boolean") masterEnabled = master;
  chrome.storage.local.set({ rules: currentRules, masterEnabled: masterEnabled });
  pushToAllTabs();
}

function saveVarSavers(newVarSavers) {
  varSavers = newVarSavers;
  chrome.storage.local.set({ varSavers: varSavers });
  pushToAllTabs();
}

function pushToAllTabs() {
  chrome.tabs.query({}, function (tabs) {
    tabs.forEach(function (tab) {
      chrome.tabs.sendMessage(tab.id, {
        type: CONST.MSG.RULES_UPDATED,
        rules: currentRules,
        varSavers: varSavers,
        masterEnabled: masterEnabled
      }, function () {
        if (chrome.runtime.lastError) {}
      });
    });
  });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === CONST.MSG.GET_RULES) {
    waitForRules(function () {
      var senderTabId = sender.tab ? sender.tab.id : "unknown";
      var savedVars = tabVarsMap[senderTabId] || {};
      sendResponse({ rules: currentRules, varSavers: varSavers, tabVars: savedVars, masterEnabled: masterEnabled });
    });
    return true;
  }
  if (msg.type === CONST.MSG.TAB_VARS) {
    var tabId = sender.tab ? sender.tab.id : "unknown";
    tabVarsMap[tabId] = msg.tabVars;
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === CONST.MSG.SAVE_RULES) {
    hitCounters = {};
    lastHitTime = {};
    // Popup/panel rule editors keep a stale copy of the rules array; a save
    // from them must not wipe breakpoints created meanwhile in DevTools.
    var preservedBps = currentRules.filter(function (r) {
      return r.type === "breakpoint" && !(msg.rules || []).some(function (m) { return m.id === r.id; });
    });
    saveRules((msg.rules || []).concat(preservedBps), msg.masterEnabled);
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === "saveVarSavers") {
    saveVarSavers(msg.varSavers);
    var activeVarNames = {};
    msg.varSavers.forEach(function (vs) {
      if (vs.varName && vs.enabled) activeVarNames[vs.varName] = true;
    });
    for (var tid in tabVarsMap) {
      var cleaned = {};
      for (var vn in tabVarsMap[tid]) {
        if (activeVarNames[vn]) cleaned[vn] = tabVarsMap[tid][vn];
      }
      tabVarsMap[tid] = cleaned;
    }
    pushToAllTabs();
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === CONST.MSG.OPEN_PANEL) {
    chrome.tabs.create({ url: chrome.runtime.getURL("panel/panel.html") });
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === CONST.MSG.HIT_COUNT) {
    var id = msg.ruleId;
    hitCounters[id] = (hitCounters[id] || 0) + 1;
    lastHitTime[id] = msg.timestamp;
    var senderTabId = sender.tab ? sender.tab.id : null;
    if (senderTabId) {
      tabInterceptedCount[senderTabId] = (tabInterceptedCount[senderTabId] || 0) + 1;
      updateBadge(senderTabId);
    }
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === CONST.MSG.GET_HIT_COUNTERS) {
    sendResponse({ counters: hitCounters, lastHitTime: lastHitTime });
    return true;
  }

  if (msg.type === CONST.MSG.RESET_HIT_COUNTERS) {
    hitCounters = {};
    lastHitTime = {};
    tabInterceptedCount = {};
    chrome.tabs.query({}, function (tabs) {
      tabs.forEach(function (tab) { updateBadge(tab.id); });
    });
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === CONST.MSG.SEEN_REQUESTS) {
    var tabId = sender.tab ? sender.tab.id : "unknown";
    tabSeenRequests[tabId] = msg.requests;
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === CONST.MSG.GET_SEEN_REQUESTS) {
    if (msg.tabId && tabSeenRequests[msg.tabId]) {
      sendResponse({ requests: tabSeenRequests[msg.tabId] });
    } else {
      var all = [];
      var urls = {};
      for (var tid in tabSeenRequests) {
        var reqs = tabSeenRequests[tid];
        for (var i = 0; i < reqs.length; i++) {
          var key = reqs[i].method + " " + reqs[i].url;
          if (!urls[key]) {
            urls[key] = true;
            all.push(reqs[i]);
          }
        }
      }
      sendResponse({ requests: all });
    }
    return true;
  }
  if (msg.type === CONST.MSG.INTERCEPTION) {
    var tabId = sender.tab ? sender.tab.id : "unknown";
    if (!interceptionLog[tabId]) interceptionLog[tabId] = [];
    var log = interceptionLog[tabId];
    var existing = null;
    for (var li = log.length - 1; li >= 0; li--) {
      if (log[li].id === msg.data.id) { existing = log[li]; break; }
    }
    if (existing) { for (var dk in msg.data) existing[dk] = msg.data[dk]; msg.data = existing; }
    else { log.push(msg.data); }
    if (log.length > CONST.INTERCEPTION_LIMIT) log.shift();
    broadcastToPanels({ type: "interception", tabId: tabId, data: msg.data });
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === CONST.MSG.SAVE_BREAKPOINTS) {
    // Breakpoints MUST go through the background (not direct storage writes):
    // saveRules() updates the in-memory rules AND pushes RULES_UPDATED to all
    // tabs, so a breakpoint becomes active immediately, without a page reload.
    // Direct storage writes left the SW's stale rules in place forever while
    // the open DevTools port kept the SW alive — breakpoints never fired.
    var nonBp = currentRules.filter(function (r) { return r.type !== "breakpoint"; });
    saveRules(nonBp.concat(msg.breakpoints || []), masterEnabled);
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === CONST.MSG.BREAKPOINT_HIT) {
    var bpTabId = sender.tab ? sender.tab.id : "unknown";
    pendingBreakpoints[msg.bpMsgId] = bpTabId;
    var panel = devtoolsPorts[bpTabId];
    if (panel) {
      panel.postMessage({ type: "breakpoint", tabId: bpTabId, bpMsgId: msg.bpMsgId, data: msg.data });
    } else {
      // No DevTools panel inspecting this tab: resume immediately. A paused
      // request nobody can see would hang the page forever.
      resumeBreakpoint(msg.bpMsgId, { action: "resume" });
    }
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === CONST.MSG.BREAKPOINT_RESUME) {
    resumeBreakpoint(msg.bpMsgId, msg.result || { action: "resume" });
    sendResponse({ success: true });
    return true;
  }
});

function broadcastToPanels(message) {
  for (var tabId in devtoolsPorts) {
    try { devtoolsPorts[tabId].postMessage(message); } catch (e) {}
  }
}

function resumeBreakpoint(bpMsgId, result) {
  var tabId = pendingBreakpoints[bpMsgId];
  if (tabId == null) return;
  delete pendingBreakpoints[bpMsgId];
  chrome.tabs.sendMessage(tabId, { type: CONST.MSG.BREAKPOINT_RESUME, bpMsgId: bpMsgId, result: result }, function () {
    if (chrome.runtime.lastError) {}
  });
}

function resumeAllForTab(tabId) {
  var ids = Object.keys(pendingBreakpoints).filter(function (id) {
    return pendingBreakpoints[id] === tabId;
  });
  ids.forEach(function (id) { resumeBreakpoint(id, { action: "resume" }); });
}

chrome.runtime.onConnect.addListener(function (port) {
  var m = /^devtools:(\d+)$/.exec(port.name || "");
  if (!m) return;
  var tabId = parseInt(m[1], 10);
  devtoolsPorts[tabId] = port;
  // A reconnecting panel takes over any pauses left by its predecessor.
  port.postMessage({ type: "backlog", tabId: tabId, data: interceptionLog[tabId] || [] });
  port.onMessage.addListener(function (msg) {
    if (msg.type === "breakpointResume") {
      resumeBreakpoint(msg.bpMsgId, msg.result || { action: "resume" });
    }
  });
  port.onDisconnect.addListener(function () {
    if (devtoolsPorts[tabId] === port) delete devtoolsPorts[tabId];
    // Closing the DevTools panel releases its paused requests (Charles-like).
    resumeAllForTab(tabId);
  });
});

chrome.tabs.onRemoved.addListener(function (tabId) {
  resumeAllForTab(tabId); // content script is gone; drop its pauses
  delete tabInterceptedCount[tabId];
  delete tabVarsMap[tabId];
  delete tabSeenRequests[tabId];
  delete interceptionLog[tabId];
  delete devtoolsPorts[tabId];
});

chrome.tabs.onUpdated.addListener(function (tabId, changeInfo) {
  if (changeInfo.status === "loading" && changeInfo.url) {
    tabInterceptedCount[tabId] = 0;
    updateBadge(tabId);
  }
});

loadRules();
