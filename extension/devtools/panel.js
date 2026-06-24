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
  var tableWrap = document.getElementById("tableWrap");
  var entries = [];
  var filtered = [];
  var filterText = "";
  var selectedId = null;
  var statusFilter = "all";
  var pageOrigin = "";
  var sortCol = null;
  var sortDir = 1;

  if (chrome.tabs && chrome.tabs.get) {
    chrome.tabs.get(inspectedTabId, function (tab) {
      if (chrome.runtime.lastError || !tab || !tab.url) {
        chrome.devtools.inspectedWindow.eval("location.origin", function (result) {
          if (result) { pageOrigin = result; render(); }
        });
        return;
      }
      try { pageOrigin = new URL(tab.url).origin; } catch (e) {}
      render();
    });
  }

  function formatTime(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function getBodySize(e) {
    if (e.body) return e.body.length;
    if (e.headers && e.headers["content-length"]) return parseInt(e.headers["content-length"], 10) || 0;
    return 0;
  }

  function formatSize(body, headers) {
    var bytes = 0;
    if (body) bytes = body.length;
    else if (headers && headers["content-length"]) bytes = parseInt(headers["content-length"], 10) || 0;
    if (!bytes) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " kB";
    return (bytes / 1048576).toFixed(1) + " MB";
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function shortUrl(url) {
    if (!url) return "";
    if (pageOrigin && url.indexOf(pageOrigin) === 0) {
      var path = url.substring(pageOrigin.length);
      return path || "/";
    }
    return url;
  }

  function highlightJson(str) {
    var s = str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return s.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      function (m) {
        var cls = "json-num";
        if (/^"/.test(m)) cls = /:$/.test(m) ? "json-key" : "json-str";
        else if (/true|false/.test(m)) cls = "json-bool";
        else if (/null/.test(m)) cls = "json-null";
        return '<span class="' + cls + '">' + m + '</span>';
      }
    );
  }

  function prettyBody(body, originalBody) {
    if (body == null || body === "") return '<span class="empty">— нет данных —</span>';
    var pretty;
    try { pretty = JSON.stringify(JSON.parse(body), null, 2); }
    catch (e) { return '<pre class="raw-body">' + escapeHtml(body.substring(0, 5000)) + '</pre>'; }

    if (!originalBody) return '<pre class="json-body">' + highlightJson(pretty) + '</pre>';

    var origPretty;
    try { origPretty = JSON.stringify(JSON.parse(originalBody), null, 2); }
    catch (e) { return '<pre class="json-body">' + highlightJson(pretty) + '</pre>'; }

    var resLines = pretty.split("\n");
    var origLines = origPretty.split("\n");
    var html = "";
    for (var i = 0; i < resLines.length; i++) {
      var changed = i >= origLines.length || resLines[i] !== origLines[i];
      html += '<div class="' + (changed ? "json-line-changed" : "json-line") + '">' + highlightJson(resLines[i]) + '</div>';
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

  function matchesStatusFilter(e) {
    if (statusFilter === "all") return true;
    if (statusFilter === "mocked") return e.matched;
    var s = e.status || 0;
    if (statusFilter === "2xx") return s >= 200 && s < 300;
    if (statusFilter === "4xx") return s >= 400 && s < 500;
    if (statusFilter === "5xx") return s >= 500;
    return true;
  }

  function compareEntries(a, b, col) {
    switch (col) {
      case "time": return (a.timestamp || 0) - (b.timestamp || 0);
      case "method": return (a.method || "").localeCompare(b.method || "");
      case "url": return (a.url || "").localeCompare(b.url || "");
      case "status": return (a.status || 0) - (b.status || 0);
      case "size": return getBodySize(a) - getBodySize(b);
      case "action": return (a.actionType || "").localeCompare(b.actionType || "");
      case "rule": return (a.ruleName || "").localeCompare(b.ruleName || "");
      default: return 0;
    }
  }

  function getSortedList() {
    var list = (filterText ? filtered : entries).filter(matchesStatusFilter);
    if (sortCol) {
      list = list.slice().sort(function (a, b) { return compareEntries(a, b, sortCol) * sortDir; });
    }
    return list;
  }

  function updateSortIndicators() {
    var ths = document.querySelectorAll("#interceptionTable th");
    Array.prototype.forEach.call(ths, function (th) {
      th.classList.remove("sort-asc", "sort-desc");
    });
    if (sortCol) {
      var active = document.querySelector("#interceptionTable th.col-" + sortCol);
      if (active) active.classList.add(sortDir > 0 ? "sort-asc" : "sort-desc");
    }
  }

  function render() {
    var list = getSortedList();
    var html = "";
    var matchedCount = 0;
    for (var i = list.length - 1; i >= 0; i--) {
      var e = list[i];
      if (e.matched) matchedCount++;
      var statusClass = e.status >= 400 ? "status-error" : e.status >= 300 ? "status-redirect" : e.status >= 200 ? "status-ok" : "";
      var actionLabel = e.actionType === "mockResponse" ? "MOCK"
        : e.actionType === "modifyResponse" ? "MOD-RESP"
        : e.actionType === "modifyRequest" || e.actionType === "modifyBody" ? "MOD-REQ"
        : e.matched ? "matched" : "—";
      var rowClass = e.matched ? "row-matched" : "row-passthrough";
      if (e.id === selectedId) rowClass += " row-selected";
      var dispUrl = shortUrl(e.url);
      html += '<tr class="' + rowClass + '" data-id="' + escapeHtml(e.id) + '">' +
        '<td>' + escapeHtml(formatTime(e.timestamp)) + '</td>' +
        '<td>' + escapeHtml(e.method || "") + '</td>' +
        '<td class="' + (dispUrl === e.url ? "col-url cross-origin" : "col-url") + '" title="' + escapeHtml(e.url) + '">' + escapeHtml(dispUrl) + '</td>' +
        '<td class="' + statusClass + '">' + (e.status != null ? e.status : "-") + '</td>' +
        '<td>' + formatSize(e.body, e.headers) + '</td>' +
        '<td class="col-action">' + actionLabel + '</td>' +
        '<td>' + escapeHtml(e.ruleName || "-") + '</td></tr>';
    }
    if (countLabel) countLabel.textContent = list.length + " зап." + (matchedCount > 0 ? " · " + matchedCount + " перехв." : "");
    tbody.innerHTML = html || '<tr><td colspan="7" class="empty-state">Нет запросов</td></tr>';
    updateSortIndicators();
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

  function showDetail(entry) {
    selectedId = entry.id;
    render();
    detailPanel.classList.remove("hidden");
    detailTitle.textContent = entry.method + " " + shortUrl(entry.url);

    var general = '<table class="hdr-table">';
    general += '<tr><td class="hdr-key">URL</td><td style="word-break:break-all">' + escapeHtml(entry.url) + '</td></tr>';
    general += '<tr><td class="hdr-key">Метод</td><td>' + escapeHtml(entry.method) + '</td></tr>';
    general += '<tr><td class="hdr-key">Статус</td><td>' + (entry.status || "-") + '</td></tr>';
    general += '<tr><td class="hdr-key">Размер</td><td>' + formatSize(entry.body, entry.headers) + '</td></tr>';
    general += '<tr><td class="hdr-key">Перехвачен</td><td>' + (entry.matched ? "да" : "нет") + '</td></tr>';
    if (entry.ruleName) general += '<tr><td class="hdr-key">Правило</td><td>' + escapeHtml(entry.ruleName) + '</td></tr>';
    if (entry.actionType) general += '<tr><td class="hdr-key">Действие</td><td>' + escapeHtml(entry.actionType) + '</td></tr>';
    if (entry.delay) general += '<tr><td class="hdr-key">Задержка</td><td>' + entry.delay + 'ms</td></tr>';
    general += '</table><div class="detail-actions">';
    general += '<button class="dt-btn" id="btnCopyUrl">URL</button>';
    general += '<button class="dt-btn" id="btnCopyCurl">cURL</button>';
    if (entry.body) general += '<button class="dt-btn" id="btnCopyBody">Тело</button>';
    general += '<button class="dt-btn" id="btnMockReq">Замокать</button></div>';
    document.getElementById("tab-general").innerHTML = general;
    document.getElementById("tab-headers").innerHTML = formatHeaders(entry.headers);
    document.getElementById("tab-body").innerHTML = prettyBody(entry.body, entry.originalBody);

    var origTab = document.querySelector('.dt-tab-orig');
    if (entry.originalBody != null) {
      origTab.classList.remove("hidden");
      document.getElementById("tab-original").innerHTML = prettyBody(entry.originalBody);
    } else { origTab.classList.add("hidden"); }

    document.getElementById("btnCopyUrl").onclick = function () { copyText(entry.url); };
    document.getElementById("btnCopyCurl").onclick = function () { copyText(buildCurl(entry)); };
    if (entry.body) document.getElementById("btnCopyBody").onclick = function () { copyText(entry.body); };
    document.getElementById("btnMockReq").onclick = function () {
      chrome.tabs.create({ url: chrome.runtime.getURL("panel/panel.html") + "?mockUrl=" + encodeURIComponent(entry.url) + "&mockMethod=" + encodeURIComponent(entry.method) });
    };
    switchTab("general");
  }

  function buildCurl(e) {
    var cmd = "curl -X " + (e.method || "GET");
    if (e.headers) { for (var k in e.headers) { cmd += " -H '" + k + ": " + e.headers[k] + "'"; } }
    cmd += " '" + e.url + "'";
    return cmd;
  }

  function copyText(text) {
    navigator.clipboard.writeText(text).then(function () {
      filterInput.placeholder = "Скопировано!";
      setTimeout(function () { filterInput.placeholder = "Фильтр..."; }, 1500);
    });
  }

  function switchTab(name) {
    document.querySelectorAll(".dt-tab").forEach(function (t) { t.classList.remove("active"); });
    document.querySelectorAll(".dt-pane").forEach(function (p) { p.classList.remove("active"); });
    var tab = document.querySelector('.dt-tab[data-tab="' + name + '"]');
    var pane = document.getElementById("tab-" + name);
    if (tab) tab.classList.add("active");
    if (pane) pane.classList.add("active");
  }

  // --- Column resize (fixed: clientX + getBoundingClientRect + clamp) ---
  function initColumnResize() {
    var ths = document.querySelectorAll("#interceptionTable th");
    Array.prototype.forEach.call(ths, function (th, idx) {
      if (idx === ths.length - 1) return;
      var grip = document.createElement("div");
      grip.className = "col-resizer";
      th.appendChild(grip);

      grip.addEventListener("mousedown", function (e) {
        e.preventDefault();
        e.stopPropagation();

        var startX = e.clientX;
        var startW = th.getBoundingClientRect().width;
        var maxW = tableWrap.clientWidth - 120;

        function onMove(ev) {
          var newW = startW + (ev.clientX - startX);
          newW = Math.max(30, Math.min(maxW, newW));
          th.style.width = newW + "px";
        }
        function onUp() {
          document.removeEventListener("mousemove", onMove);
          document.removeEventListener("mouseup", onUp);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        }
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      });
    });
  }

  // --- Column sort ---
  function initColumnSort() {
    var ths = document.querySelectorAll("#interceptionTable th");
    Array.prototype.forEach.call(ths, function (th) {
      th.addEventListener("click", function (e) {
        if (e.target.classList.contains("col-resizer")) return;
        var col = th.className.replace(/^col-/, "").split(" ")[0];
        if (sortCol === col) sortDir = -sortDir;
        else { sortCol = col; sortDir = 1; }
        render();
      });
    });
  }

  // --- Events ---
  tbody.addEventListener("click", function (e) {
    var tr = e.target.closest("tr");
    if (!tr || !tr.dataset.id) return;
    var entry = entries.find(function (x) { return x.id === tr.dataset.id; });
    if (entry) showDetail(entry);
  });

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
    var url = ctxMenu.dataset.url, method = ctxMenu.dataset.method;
    ctxMenu.classList.add("hidden");
    if (url) chrome.tabs.create({ url: chrome.runtime.getURL("panel/panel.html") + "?mockUrl=" + encodeURIComponent(url) + "&mockMethod=" + encodeURIComponent(method) });
  });

  document.querySelectorAll(".sf-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".sf-btn").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      statusFilter = btn.dataset.filter;
      render();
    });
  });

  document.querySelectorAll(".dt-tab").forEach(function (tab) {
    tab.addEventListener("click", function () { switchTab(tab.dataset.tab); });
  });

  closeDetail.addEventListener("click", function () { detailPanel.classList.add("hidden"); selectedId = null; render(); });
  filterInput.addEventListener("input", applyFilter);
  clearBtn.addEventListener("click", function () { entries = []; filtered = []; render(); detailPanel.classList.add("hidden"); selectedId = null; });

  port.onMessage.addListener(function (msg) {
    if (msg.type === "backlog") {
      if (msg.data[inspectedTabId]) entries = entries.concat(msg.data[inspectedTabId]);
      applyFilter();
    } else if (msg.type === "interception") {
      if (msg.tabId === inspectedTabId) { entries.push(msg.data); applyFilter(); }
    }
  });

  initColumnResize();
  initColumnSort();
})();
