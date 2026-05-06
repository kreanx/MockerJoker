(function () {
  var script = document.createElement("script");
  script.src = chrome.runtime.getURL("content/injected.js");
  script.onload = function () {
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  var contextValid = true;
  var retryTimer = null;

  function tryRecover() {
    if (retryTimer) return;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      try {
        chrome.runtime.sendMessage({ type: "getRules" }, function (res) {
          if (chrome.runtime.lastError) {
            contextValid = false;
            tryRecover();
            return;
          }
          contextValid = true;
          sendRulesToPage();
        });
      } catch (e) {
        contextValid = false;
        tryRecover();
      }
    }, 3000);
  }

  function safeSendMessage(msg, callback) {
    try {
      chrome.runtime.sendMessage(msg, function (res) {
        if (chrome.runtime.lastError) {
          contextValid = false;
          tryRecover();
          return;
        }
        contextValid = true;
        if (callback) callback(res);
      });
    } catch (e) {
      contextValid = false;
      tryRecover();
    }
  }

  function sendRulesToPage() {
    safeSendMessage({ type: "getRules" }, function (res) {
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
      safeSendMessage({
        type: "hitCount",
        ruleId: data.ruleId,
        url: data.url,
        method: data.method,
        timestamp: data.timestamp
      });
    }

    if (data.type === "REQUEST_MOCKER_SEEN") {
      safeSendMessage({
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
