(function () {
  var inspectedTabId = chrome.devtools.inspectedWindow.tabId;
  var port = chrome.runtime.connect({ name: "devtools" });
  var tbody = document.getElementById("logBody");
  var filterInput = document.getElementById("filterInput");
  var clearBtn = document.getElementById("clearBtn");
  var countLabel = document.getElementById("countLabel");
  var detailPanel = document.getElementById("detailPanel");
  var detailTitle = document.getElementById("detailTitle");
  var closeDetail = document.getElementById("closeDetail");
  var entries = [];
  var filtered = [];
  var filterText = "";
  var selectedId = null;

  function formatTime(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function prettyBody(body) {
    if (body == null || body === "") return '<span class="empty">— нет данных —</span>';
    try {
      var parsed = JSON.parse(body);
      return '<pre class="json-body">' + escapeHtml(JSON.stringify(parsed, null, 2)) + '</pre>';
    } catch (e) {
      return '<pre class="raw-body">' + escapeHtml(body.substring(0, 5000)) + '</pre>';
    }
  }

  function formatHeaders(hdrs) {
    if (!hdrs || Object.keys(hdrs).length === 0) return '<span class="empty">— нет заголовков —</span>';
    var html = '<table class="hdr-table">';
    var keys = Object.keys(hdrs).sort();
    for (var i = 0; i < keys.length; i++) {
      html += '<tr><td class="hdr-key">' + escapeHtml(keys[i]) + '</td><td class="hdr-val">' + escapeHtml(hdrs[keys[i]]) + '</td></tr>';
    }
    return html + '</table>';
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
      if (e.id === selectedId) rowClass += " row-selected";
      html += '<tr class="' + rowClass + '" data-id="' + escapeHtml(e.id) + '">' +
        '<td class="col-time">' + escapeHtml(formatTime(e.timestamp)) + '</td>' +
        '<td class="col-method">' + escapeHtml(e.method || "") + '</td>' +
        '<td class="col-url" title="' + escapeHtml(e.url) + '">' + escapeHtml(e.url) + '</td>' +
        '<td class="col-status ' + statusClass + '">' + (e.status != null ? e.status : "-") + '</td>' +
        '<td class="col-action">' + actionLabel + '</td>' +
        '<td class="col-rule">' + escapeHtml(e.ruleName || "-") + '</td></tr>';
    }
    if (countLabel) {
      countLabel.textContent = list.length + " зап." + (matchedCount > 0 ? " · " + matchedCount + " перехв." : "");
    }
    tbody.innerHTML = html || '<tr><td colspan="6" class="empty-state">Нет запросов</td></tr>';
  }

  function applyFilter() {
    filterText = filterInput.value.toLowerCase();
    if (!filterText) { render(); return; }
    filtered = entries.filter(function (e) {
      return (e.url && e.url.toLowerCase().indexOf(filterText) !== -1) ||
        (e.ruleName && e.ruleName.toLowerCase().indexOf(filterText) !== -1) ||
        (e.method && e.method.toLowerCase().indexOf(filterText) !== -1) ||
        (e.actionType && e.actionType.toLowerCase().indexOf(filterText) !== -1) ||
        (String(e.status) === filterText);
    });
    render();
  }

  function showDetail(entry) {
    selectedId = entry.id;
    render();
    detailPanel.classList.remove("hidden");
    detailTitle.textContent = entry.method + " " + (entry.url || "").substring(0, 120);

    // General tab
    var general = '<table class="hdr-table">';
    general += '<tr><td class="hdr-key">URL</td><td class="hdr-val">' + escapeHtml(entry.url) + '</td></tr>';
    general += '<tr><td class="hdr-key">Метод</td><td class="hdr-val">' + escapeHtml(entry.method) + '</td></tr>';
    general += '<tr><td class="hdr-key">Статус</td><td class="hdr-val">' + (entry.status || "-") + '</td></tr>';
    general += '<tr><td class="hdr-key">Перехвачен</td><td class="hdr-val">' + (entry.matched ? "да" : "нет") + '</td></tr>';
    if (entry.ruleName) general += '<tr><td class="hdr-key">Правило</td><td class="hdr-val">' + escapeHtml(entry.ruleName) + '</td></tr>';
    if (entry.actionType) general += '<tr><td class="hdr-key">Действие</td><td class="hdr-val">' + escapeHtml(entry.actionType) + '</td></tr>';
    if (entry.delay) general += '<tr><td class="hdr-key">Задержка</td><td class="hdr-val">' + entry.delay + 'ms</td></tr>';
    general += '</table>';
    document.getElementById("tab-general").innerHTML = general;

    // Headers tab
    document.getElementById("tab-headers").innerHTML = formatHeaders(entry.headers);

    // Body tab (response/result)
    document.getElementById("tab-body").innerHTML = prettyBody(entry.body);

    // Original tab (only for modifyResponse / conditional mock)
    var origTab = document.querySelector('.dt-tab-orig');
    if (entry.originalBody != null) {
      origTab.classList.remove("hidden");
      document.getElementById("tab-original").innerHTML = prettyBody(entry.originalBody);
    } else {
      origTab.classList.add("hidden");
    }

    switchTab("general");
  }

  function switchTab(name) {
    document.querySelectorAll(".dt-tab").forEach(function (t) { t.classList.remove("active"); });
    document.querySelectorAll(".dt-pane").forEach(function (p) { p.classList.remove("active"); });
    var tab = document.querySelector('.dt-tab[data-tab="' + name + '"]');
    var pane = document.getElementById("tab-" + name);
    if (tab) tab.classList.add("active");
    if (pane) pane.classList.add("active");
  }

  // Row click → show detail
  tbody.addEventListener("click", function (e) {
    var tr = e.target.closest("tr");
    if (!tr || !tr.dataset.id) return;
    var entry = entries.find(function (x) { return x.id === tr.dataset.id; });
    if (entry) showDetail(entry);
  });

  // Tab switching
  document.querySelectorAll(".dt-tab").forEach(function (tab) {
    tab.addEventListener("click", function () { switchTab(tab.dataset.tab); });
  });

  closeDetail.addEventListener("click", function () {
    detailPanel.classList.add("hidden");
    selectedId = null;
    render();
  });

  // Port message handler — filter by inspected tab
  port.onMessage.addListener(function (msg) {
    if (msg.type === "backlog") {
      if (msg.data[inspectedTabId]) {
        entries = entries.concat(msg.data[inspectedTabId]);
      }
      applyFilter();
    } else if (msg.type === "interception") {
      if (msg.tabId === inspectedTabId) {
        entries.push(msg.data);
        // If detail is open for this entry, refresh it
        if (selectedId && document.querySelector('.dt-tab[data-tab="body"]')) {
          var ent = entries.find(function (x) { return x.id === selectedId; });
          if (ent) {
            document.getElementById("tab-body").innerHTML = prettyBody(ent.body);
          }
        }
        applyFilter();
      }
    }
  });

  filterInput.addEventListener("input", applyFilter);
  clearBtn.addEventListener("click", function () { entries = []; filtered = []; render(); detailPanel.classList.add("hidden"); selectedId = null; });
})();
