var currentRules = [];
var masterEnabled = true;
var rulesLoaded = false;
var loadCallbacks = [];

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
        type: "rulesUpdated",
        rules: currentRules,
        masterEnabled: masterEnabled
      }, function () {
        if (chrome.runtime.lastError) {}
      });
    });
  });
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === "getRules") {
    waitForRules(function () {
      sendResponse({ rules: currentRules, masterEnabled: masterEnabled });
    });
    return true;
  }
  if (msg.type === "saveRules") {
    saveRules(msg.rules, msg.masterEnabled);
    sendResponse({ success: true });
    return true;
  }
  if (msg.type === "openPanel") {
    chrome.tabs.create({ url: chrome.runtime.getURL("panel/panel.html") });
    sendResponse({ success: true });
    return true;
  }
});

loadRules();
