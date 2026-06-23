(function () {
  var port = chrome.runtime.connect({ name: "devtools" });
  var tbody = document.getElementById("logBody");
  var filterInput = document.getElementById("filterInput");
  var clearBtn = document.getElementById("clearBtn");
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
    for (var i = list.length - 1; i >= 0; i--) {
      var e = list[i];
      var statusClass = e.status >= 400 ? "status-error"
        : e.status >= 300 ? "status-redirect"
        : e.status >= 200 ? "status-ok" : "";
      html += '<tr>' +
        '<td class="col-time">' + escapeHtml(formatTime(e.timestamp)) + '</td>' +
        '<td class="col-method">' + escapeHtml(e.method || "") + '</td>' +
        '<td class="col-url" title="' + escapeHtml(e.url) + '">' + escapeHtml(e.url) + '</td>' +
        '<td class="col-status ' + statusClass + '">' + (e.status != null ? e.status : "-") + '</td>' +
        '<td class="col-action">' + escapeHtml(e.actionType || (e.matched ? "matched" : "passthrough")) + '</td>' +
        '<td class="col-rule">' + escapeHtml(e.ruleName || "-") + '</td></tr>';
    }
    tbody.innerHTML = html || '<tr><td colspan="6" style="text-align:center;color:var(--text-secondary, #6c7086);padding:40px">Нет перехваченных запросов</td></tr>';
  }

  function applyFilter() {
    filterText = filterInput.value.toLowerCase();
    if (!filterText) { render(); return; }
    filtered = entries.filter(function (e) {
      return (e.url && e.url.toLowerCase().indexOf(filterText) !== -1) ||
        (e.ruleName && e.ruleName.toLowerCase().indexOf(filterText) !== -1) ||
        (e.method && e.method.toLowerCase().indexOf(filterText) !== -1);
    });
    render();
  }

  port.onMessage.addListener(function (msg) {
    if (msg.type === "backlog") {
      for (var tabId in msg.data) {
        entries = entries.concat(msg.data[tabId]);
      }
      applyFilter();
    } else if (msg.type === "interception") {
      entries.push(msg.data);
      applyFilter();
    }
  });

  filterInput.addEventListener("input", applyFilter);
  clearBtn.addEventListener("click", function () { entries = []; filtered = []; render(); });
})();
