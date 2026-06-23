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
  var ctxMenu = document.getElementById("ctxMenu");
  var ctxMock = document.getElementById("ctxMock");
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

  // Pretty-print JSON body. If originalBody is provided, highlight changed lines.
  function prettyBody(body, originalBody) {
    if (body == null || body === "") return '<span class="empty">— нет данных —</span>';
    var pretty;
    try { pretty = JSON.stringify(JSON.parse(body), null, 2); }
    catch (e) { return '<pre class="raw-body">' + escapeHtml(body.substring(0, 5000)) + '</pre>'; }

    if (!originalBody) {
      return '<pre class="json-body">' + escapeHtml(pretty) + '</pre>';
    }

    // Line-by-line diff against original
    var origPretty;
    try { origPretty = JSON.stringify(JSON.parse(originalBody), null, 2); }
    catch (e) { return '<pre class="json-body">' + escapeHtml(pretty) + '</pre>'; }

    var resLines = pretty.split("\n");
    var origLines = origPretty.split("\n");
    var html = "";
    for (var i = 0; i < resLines.length; i++) {
      var changed = i >= origLines.length || resLines[i] !== origLines[i];
      html += '<span class="' + (changed ? "json-line-changed" : "json-line") + '">' + escapeHtml(resLines[i]) + '\n</span>';
    }
    return '<pre class="json-body">' + html + '</pre>';
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
    detailTitle.textContent = entry.method + " " + (entry.url || "").substring(0, 100);

    // General tab
    var general = '<table class="hdr-table">';
    general += '<tr><td class="hdr-key">URL</td><td class="hdr-val" style="word-break:break-all">' + escapeHtml(entry.url) + '</td></tr>';
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

    // Body tab (result body, with diff highlighting if originalBody exists)
    document.getElementById("tab-body").innerHTML = prettyBody(entry.body, entry.originalBody);

    // Original tab
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

  // Row click → detail
  tbody.addEventListener("click", function (e) {
    var tr = e.target.closest("tr");
    if (!tr || !tr.dataset.id) return;
    var entry = entries.find(function (x) { return x.id === tr.dataset.id; });
    if (entry) showDetail(entry);
  });

  // Right-click → context menu
  tbody.addEventListener("contextmenu", function (e) {
    var tr = e.target.closest("tr");
    if (!tr || !tr.dataset.id) return;
    e.preventDefault();
    var entry = entries.find(function (x) { return x.id === tr.dataset.id; });
    if (!entry) return;
    ctxMenu.style.left = e.clientX + "px";
    ctxMenu.style.top = e.clientY + "px";
    ctxMenu.classList.remove("hidden");
    ctxMenu.dataset.url = entry.url || "";
    ctxMenu.dataset.method = entry.method || "GET";
  });

  document.addEventListener("click", function () { ctxMenu.classList.add("hidden"); });
  ctxMenu.addEventListener("click", function (e) {
    e.stopPropagation();
    var url = ctxMenu.dataset.url;
    var method = ctxMenu.dataset.method;
    ctxMenu.classList.add("hidden");
    if (url) {
      chrome.tabs.create({
        url: chrome.runtime.getURL("panel/panel.html") + "?mockUrl=" + encodeURIComponent(url) + "&mockMethod=" + encodeURIComponent(method)
      });
    }
  });

  // Tab switching
  document.querySelectorAll(".dt-tab").forEach(function (tab) {
    tab.addEventListener("click", function () { switchTab(tab.dataset.tab); });
  });
  closeDetail.addEventListener("click", function () {
    detailPanel.classList.add("hidden"); selectedId = null; render();
  });

  // Port — filter by inspected tab
  port.onMessage.addListener(function (msg) {
    if (msg.type === "backlog") {
      if (msg.data[inspectedTabId]) entries = entries.concat(msg.data[inspectedTabId]);
      applyFilter();
    } else if (msg.type === "interception") {
      if (msg.tabId === inspectedTabId) {
        entries.push(msg.data);
        applyFilter();
      }
    }
  });

  filterInput.addEventListener("input", applyFilter);
  clearBtn.addEventListener("click", function () { entries = []; filtered = []; render(); detailPanel.classList.add("hidden"); selectedId = null; });
})();
