var MSG = {
  GET_RULES: "getRules",
  SAVE_RULES: "saveRules",
  OPEN_PANEL: "openPanel",
  HIT_COUNT: "hitCount",
  GET_HIT_COUNTERS: "getHitCounters",
  RESET_HIT_COUNTERS: "resetHitCounters",
  SEEN_REQUESTS: "seenRequests",
  GET_SEEN_REQUESTS: "getSeenRequests",
  RULES_UPDATED: "rulesUpdated"
};

var currentRules = [];
var masterEnabled = true;
var rulesLoaded = false;
var loadCallbacks = [];

var hitCounters = {};
var lastHitTime = {};
var tabSeenRequests = {};

function loadRules() {
  chrome.storage.local.get({ rules: [], masterEnabled: true }, function (data) {
    currentRules = data.rules || [];
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

function pushToAllTabs() {
  chrome.tabs.query({}, function (tabs) {
    tabs.forEach(function (tab) {
      chrome.tabs.sendMessage(tab.id, {
        type: MSG.RULES_UPDATED,
        rules: currentRules,
        masterEnabled: masterEnabled
      }, function () {
        if (chrome.runtime.lastError) {}
      });
    });
  });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === MSG.GET_RULES) {
    waitForRules(function () {
      sendResponse({ rules: currentRules, masterEnabled: masterEnabled });
    });
    return true;
  }
  if (msg.type === MSG.SAVE_RULES) {
    hitCounters = {};
    lastHitTime = {};
    saveRules(msg.rules, msg.masterEnabled);
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === MSG.OPEN_PANEL) {
    chrome.tabs.create({ url: chrome.runtime.getURL("panel/panel.html") });
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === MSG.HIT_COUNT) {
    var id = msg.ruleId;
    hitCounters[id] = (hitCounters[id] || 0) + 1;
    lastHitTime[id] = msg.timestamp;
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === MSG.GET_HIT_COUNTERS) {
    sendResponse({ counters: hitCounters, lastHitTime: lastHitTime });
    return true;
  }

  if (msg.type === MSG.RESET_HIT_COUNTERS) {
    hitCounters = {};
    lastHitTime = {};
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === MSG.SEEN_REQUESTS) {
    var tabId = sender.tab ? sender.tab.id : "unknown";
    tabSeenRequests[tabId] = msg.requests;
    sendResponse({ success: true });
    return true;
  }

  if (msg.type === MSG.GET_SEEN_REQUESTS) {
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
});

loadRules();
