(function () {
  var script = document.createElement("script");
  script.src = chrome.runtime.getURL("content/injected.js");
  script.onload = function () {
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  function sendRulesToPage() {
    chrome.runtime.sendMessage({ type: "getRules" }, function (res) {
      if (res) {
        window.postMessage(
          { type: "REQUEST_MOCKER_RULES", rules: res.rules, masterEnabled: res.masterEnabled },
          "*"
        );
      }
    });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data) return;

    if (data.type === "REQUEST_MOCKER_INIT") {
      sendRulesToPage();
    }

    if (data.type === "REQUEST_MOCKER_HIT") {
      chrome.runtime.sendMessage({
        type: "hitCount",
        ruleId: data.ruleId,
        url: data.url,
        method: data.method,
        timestamp: data.timestamp
      });
    }

    if (data.type === "REQUEST_MOCKER_SEEN") {
      chrome.runtime.sendMessage({
        type: "seenRequests",
        requests: data.requests
      });
    }
  });

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg.type === "rulesUpdated") {
      sendRulesToPage();
    }
  });

  sendRulesToPage();
})();
