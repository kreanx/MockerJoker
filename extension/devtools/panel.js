(function () {
  var inspectedTabId = chrome.devtools.inspectedWindow.tabId;
  var port = chrome.runtime.connect({ name: "devtools" });
  var tbody = document.getElementById("logBody");
  var filterInput = document.getElementById("filterInput");
  var clearBtn = document.getElementById("clearBtn");
  var countLabel = document.getElementById("countLabel");
  var entries = [];
  var filtered = [];
  var filterText = "";

  function formatTime(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function render() {
    var html = "";
    var list = filterText ? filtered : entries;
    var matchedCount = 0;
    for (var i = list.length - 1; i >= 0; i--) {
      var e = list[i];
      if (e.matched) matchedCount++;
      var statusClass = e.status >= 400 ? "status-error"
        : e.status >= 300 ? "status-redirect"
        : e.status >= 200 ? "status-ok" : "";
      var actionLabel = e.actionType === "mockResponse" ? "MOCK"
        : e.actionType === "modifyResponse" ? "MOD-RESP"
        : e.actionType === "modifyRequest" || e.actionType === "modifyBody" ? "MOD-REQ"
        : e.matched ? "matched" : "—";
      var rowClass = e.matched ? "row-matched" : "row-passthrough";
      html += '<tr class="' + rowClass + '">' +
        '<td class="col-time">' + escapeHtml(formatTime(e.timestamp)) + '</td>' +
        '<td class="col-method">' + escapeHtml(e.method || "") + '</td>' +
        '<td class="col-url" title="' + escapeHtml(e.url) + '">' + escapeHtml(e.url) + '</td>' +
        '<td class="col-status ' + statusClass + '">' + (e.status != null ? e.status : "-") + '</td>' +
        '<td class="col-action">' + actionLabel + '</td>' +
        '<td class="col-rule">' + escapeHtml(e.ruleName || "-") + '</td></tr>';
    }
    if (countLabel) {
      countLabel.textContent = list.length + " запросов" + (matchedCount > 0 ? " · " + matchedCount + " перехвачено" : "");
    }
    tbody.innerHTML = html || '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary, #6c7086);padding:40px">Нет перехваченных запросов</td></tr>';
  }

  function applyFilter() {
    filterText = filterInput.value.toLowerCase();
    if (!filterText) { render(); return; }
    filtered = entries.filter(function (e) {
      return (e.url && e.url.toLowerCase().indexOf(filterText) !== -1) ||
        (e.ruleName && e.ruleName.toLowerCase().indexOf(filterText) !== -1) ||
        (e.method && e.method.toLowerCase().indexOf(filterText) !== -1) ||
        (e.actionType && e.actionType.toLowerCase().indexOf(filterText) !== -1);
    });
    render();
  }

  // Only show entries for THIS tab (the one DevTools is inspecting)
  port.onMessage.addListener(function (msg) {
    if (msg.type === "backlog") {
      if (msg.data[inspectedTabId]) {
        entries = entries.concat(msg.data[inspectedTabId]);
      }
      applyFilter();
    } else if (msg.type === "interception") {
      if (msg.tabId === inspectedTabId) {
        entries.push(msg.data);
        applyFilter();
      }
    }
  });

  filterInput.addEventListener("input", applyFilter);
  clearBtn.addEventListener("click", function () { entries = []; filtered = []; render(); });
})();
