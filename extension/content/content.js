(function () {
  var MSG = {
    GET_RULES: "getRules",
    SAVE_RULES: "saveRules",
    RULES_UPDATED: "rulesUpdated",
    HIT_COUNT: "hitCount",
    SEEN_REQUESTS: "seenRequests"
  };
  var PAGE = {
    RULES: "REQUEST_MOCKER_RULES",
    INIT: "REQUEST_MOCKER_INIT",
    HIT: "REQUEST_MOCKER_HIT",
    SEEN: "REQUEST_MOCKER_SEEN"
  };

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
        chrome.runtime.sendMessage({ type: MSG.GET_RULES }, function (res) {
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
    safeSendMessage({ type: MSG.GET_RULES }, function (res) {
      if (res) {
        window.postMessage(
          { type: PAGE.RULES, rules: res.rules, masterEnabled: res.masterEnabled },
          "*"
        );
      }
    });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data) return;

    if (data.type === PAGE.INIT) {
      sendRulesToPage();
    }

    if (data.type === PAGE.HIT) {
      safeSendMessage({
        type: MSG.HIT_COUNT,
        ruleId: data.ruleId,
        url: data.url,
        method: data.method,
        timestamp: data.timestamp
      });
    }

    if (data.type === PAGE.SEEN) {
      safeSendMessage({
        type: MSG.SEEN_REQUESTS,
        requests: data.requests
      });
    }
  });

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg.type === MSG.RULES_UPDATED) {
      sendRulesToPage();
    }
  });

  sendRulesToPage();
})();
