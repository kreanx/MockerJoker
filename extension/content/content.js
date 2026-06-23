(function () {
  var contextValid = true;
  var retryTimer = null;

  function loadScript(url) {
    var s = document.createElement("script");
    s.src = chrome.runtime.getURL(url);
    s.onload = function () { s.remove(); };
    (document.head || document.documentElement).appendChild(s);
  }
  // Constants must be loaded before injected.js — both execute in page context.
  loadScript("shared/constants.js");
  loadScript("content/injected.js");

  function tryRecover() {
    if (retryTimer) return;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      try {
        chrome.runtime.sendMessage({ type: CONST.MSG.GET_RULES }, function (res) {
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
    safeSendMessage({ type: CONST.MSG.GET_RULES }, function (res) {
      if (res) {
        window.postMessage(
          { type: CONST.PAGE_MSG.RULES, rules: res.rules, varSavers: res.varSavers || [], tabVars: res.tabVars || {}, masterEnabled: res.masterEnabled },
          "*"
        );
      }
    });
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data) return;

    if (data.type === CONST.PAGE_MSG.INIT) {
      sendRulesToPage();
    }

    if (data.type === CONST.PAGE_MSG.HIT) {
      safeSendMessage({
        type: CONST.MSG.HIT_COUNT,
        ruleId: data.ruleId,
        url: data.url,
        method: data.method,
        timestamp: data.timestamp
      });
    }

    if (data.type === CONST.PAGE_MSG.SEEN) {
      safeSendMessage({
        type: CONST.MSG.SEEN_REQUESTS,
        requests: data.requests
      });
    }

    if (data.type === CONST.PAGE_MSG.TAB_VARS) {
      safeSendMessage({
        type: CONST.MSG.TAB_VARS,
        tabVars: data.tabVars
      });
    }
  });

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg.type === CONST.MSG.RULES_UPDATED) {
      sendRulesToPage();
    }
  });

  sendRulesToPage();
})();
