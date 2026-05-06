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
    if (event.data && event.data.type === "REQUEST_MOCKER_INIT") {
      sendRulesToPage();
    }
  });

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg.type === "rulesUpdated") {
      sendRulesToPage();
    }
  });

  sendRulesToPage();
})();
