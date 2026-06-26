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
  var hSplitHandle = document.getElementById("hSplitHandle");
  var responseView = document.getElementById("responseView");
  var entries = [];
  var filtered = [];
  var filterText = "";
  var selectedId = null;
  var statusFilter = "all";
  var pageOrigin = "";
  var sortCol = null;
  var sortDir = 1;

  // --- Theme sync ---
  function applyTheme(theme) { document.documentElement.setAttribute("data-theme", theme || "dark"); }
  chrome.storage.local.get({ theme: "dark" }, function (data) { applyTheme(data.theme); });
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" && changes.theme) applyTheme(changes.theme.newValue);
  });

  // --- Page origin ---
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
    return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
  function methodClass(m) {
    return { "GET": "m-get", "POST": "m-post", "PUT": "m-put", "DELETE": "m-delete", "PATCH": "m-patch" }[(m || "").toUpperCase()] || "";
  }
  function getBodySize(e) {
    if (e.body) return e.body.length;
    if (e.headers && e.headers["content-length"]) return parseInt(e.headers["content-length"], 10) || 0;
    return 0;
  }
  function formatSize(body, headers) {
    var b = body ? body.length : (headers && headers["content-length"] ? parseInt(headers["content-length"], 10) || 0 : 0);
    if (!b) return "—";
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " kB";
    return (b / 1048576).toFixed(1) + " MB";
  }
  function escapeHtml(s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function shortUrl(url) {
    if (!url) return "";
    if (pageOrigin && url.indexOf(pageOrigin) === 0) { var p = url.substring(pageOrigin.length); return p || "/"; }
    return url;
  }

  function isDynamicSegment(s) {
    if (/^\d+$/.test(s)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
    if (/^[0-9a-f]{16,}$/i.test(s)) return true;
    if (s.length >= 20 && /[0-9]/.test(s) && /[a-zA-Z]/.test(s)) return true;
    return false;
  }

  function renderUrl(url) {
    if (!url) return "";
    var origin = "", path = url;
    if (pageOrigin && url.indexOf(pageOrigin) === 0) {
      path = url.substring(pageOrigin.length) || "/";
    } else {
      var m = url.match(/^(\w+:)?\/\/[^/]+(.*)/);
      if (m) { origin = m[0].replace(m[2], ""); path = m[2] || "/"; }
    }
    var html = "";
    if (origin) {
      var host = origin.replace(/^(\w+:)?\/\//, "");
      html += '<span class="url-host">' + escapeHtml(host) + "</span>";
    }
    var qi = path.indexOf("?");
    var query = "";
    if (qi >= 0) { query = path.substring(qi); path = path.substring(0, qi); }
    var segs = path.split("/");
    for (var i = 0; i < segs.length; i++) {
      if (i > 0) html += "/";
      if (!segs[i]) continue;
      if (isDynamicSegment(segs[i])) html += '<span class="url-dyn">' + escapeHtml(segs[i]) + "</span>";
      else html += escapeHtml(segs[i]);
    }
    if (query) html += '<span class="url-query">' + escapeHtml(query) + "</span>";
    return html;
  }
  function highlightJson(str) {
    var s = str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return s.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (m) {
      var c = "json-num";
      if (/^"/.test(m)) c = /:$/.test(m) ? "json-key" : "json-str";
      else if (/true|false/.test(m)) c = "json-bool";
      else if (/null/.test(m)) c = "json-null";
      return '<span class="' + c + '">' + m + '</span>';
    });
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
    var rl = pretty.split("\n"), ol = origPretty.split("\n"), h = "";
    for (var i = 0; i < rl.length; i++) {
      var ch = i >= ol.length || rl[i] !== ol[i];
      h += '<div class="' + (ch ? "json-line-changed" : "json-line") + '">' + highlightJson(rl[i]) + '</div>';
    }
    return '<pre class="json-body">' + h + '</pre>';
  }
  function formatHeaders(hdrs) {
    if (!hdrs || !Object.keys(hdrs).length) return '<span class="empty">— нет заголовков —</span>';
    var h = '<table class="hdr-table">', k = Object.keys(hdrs).sort();
    for (var i = 0; i < k.length; i++) h += '<tr><td class="hdr-key">' + escapeHtml(k[i]) + '</td><td>' + escapeHtml(hdrs[k[i]]) + '</td></tr>';
    return h + '</table>';
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
    if (sortCol) list = list.slice().sort(function (a, b) { return compareEntries(a, b, sortCol) * sortDir; });
    return list;
  }
  function updateSortIndicators() {
    var ths = document.querySelectorAll("#interceptionTable th");
    Array.prototype.forEach.call(ths, function (th) { th.classList.remove("sort-asc", "sort-desc"); });
    if (sortCol) { var a = document.querySelector("#interceptionTable th.col-" + sortCol); if (a) a.classList.add(sortDir > 0 ? "sort-asc" : "sort-desc"); }
  }

  function render() {
    var list = getSortedList(), html = "", mc2 = 0;
    for (var i = list.length - 1; i >= 0; i--) {
      var e = list[i];
      if (e.matched) mc2++;
      var sc = e.status >= 400 ? "status-error" : e.status >= 300 ? "status-redirect" : e.status >= 200 ? "status-ok" : "";
      var al = e.actionType === "mockResponse" ? "MOCK" : e.actionType === "modifyResponse" ? "MOD-RESP" : (e.actionType === "modifyRequest" || e.actionType === "modifyBody") ? "MOD-REQ" : e.matched ? "matched" : "—";
      var rc = (e.matched ? "row-matched" : "row-passthrough") + (e.id === selectedId ? " row-selected" : "");
      var mc = methodClass(e.method);
      html += '<tr class="' + rc + '" data-id="' + escapeHtml(e.id) + '"><td>' + escapeHtml(formatTime(e.timestamp)) + '</td><td' + (mc ? ' class="' + mc + '"' : '') + '>' + escapeHtml(e.method || "") + '</td><td class="col-url" title="' + escapeHtml(e.url) + '">' + renderUrl(e.url) + '</td><td class="' + sc + '">' + (e.status != null ? e.status : "-") + '</td><td>' + formatSize(e.body, e.headers) + '</td><td class="col-action">' + al + '</td><td>' + escapeHtml(e.ruleName || "-") + '</td></tr>';
    }
    if (countLabel) countLabel.textContent = list.length + " зап." + (mc2 > 0 ? " · " + mc2 + " перехв." : "");
    tbody.innerHTML = html || '<tr><td colspan="7" class="empty-state">Нет запросов</td></tr>';
    updateSortIndicators();
    autoSizeColumns();
  }

  // --- Auto-size columns to widest content ---
  var manualCols = {};
  function autoSizeColumns() {
    var ths = document.querySelectorAll("#interceptionTable th");
    var rows = tbody.querySelectorAll("tr");
    // Skip if only empty-state row
    if (rows.length === 0) return;
    var first = rows[0];
    if (first && first.querySelector(".empty-state")) return;
    // Calibrate average char width once (re-calibrate on resize)
    if (!autoSizeColumns._cw || autoSizeColumns._lastW !== window.innerWidth) {
      var m = document.createElement("span");
      var cs = getComputedStyle(tbody);
      m.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;font:" + cs.fontSize + "/1 " + cs.fontFamily;
      m.textContent = "АБВГД0123456789abcdeWMMIij";
      document.body.appendChild(m);
      autoSizeColumns._cw = m.offsetWidth / 24;
      autoSizeColumns._lastW = window.innerWidth;
      document.body.removeChild(m);
    }
    var cw = autoSizeColumns._cw;
    for (var ci = 0; ci < ths.length; ci++) {
      if (ths[ci].classList.contains("col-url") || manualCols[ci]) continue;
      var maxLen = ths[ci].textContent.length;
      for (var ri = 0; ri < rows.length; ri++) {
        var cell = rows[ri].children[ci];
        if (cell) {
          var t = cell.textContent;
          if (t.length > maxLen) maxLen = t.length;
        }
      }
      ths[ci].style.width = Math.max(maxLen * cw + 18, 40) + "px";
    }
  }

  function applyFilter() {
    filterText = filterInput.value.toLowerCase();
    if (!filterText) { render(); return; }
    filtered = entries.filter(function (e) {
      return (e.url && e.url.toLowerCase().indexOf(filterText) !== -1) || (e.ruleName && e.ruleName.toLowerCase().indexOf(filterText) !== -1) || (e.method && e.method.toLowerCase().indexOf(filterText) !== -1) || (e.actionType && e.actionType.toLowerCase().indexOf(filterText) !== -1);
    });
    render();
  }

  function showDetail(entry) {
    selectedId = entry.id;
    render();
    detailPanel.classList.remove("hidden");
    hSplitHandle.classList.add("visible");
    detailTitle.textContent = (entry.method || "GET") + " " + shortUrl(entry.url);

    // Left: General
    var g = '<table class="hdr-table">';
    g += '<tr><td class="hdr-key">URL</td><td style="word-break:break-all">' + escapeHtml(entry.url) + '</td></tr>';
    g += '<tr><td class="hdr-key">Метод</td><td>' + escapeHtml(entry.method) + '</td></tr>';
    g += '<tr><td class="hdr-key">Статус</td><td>' + (entry.status || "-") + '</td></tr>';
    g += '<tr><td class="hdr-key">Размер</td><td>' + formatSize(entry.body, entry.headers) + '</td></tr>';
    g += '<tr><td class="hdr-key">Перехвачен</td><td>' + (entry.matched ? "да" : "нет") + '</td></tr>';
    if (entry.ruleName) g += '<tr><td class="hdr-key">Правило</td><td>' + escapeHtml(entry.ruleName) + '</td></tr>';
    if (entry.actionType) g += '<tr><td class="hdr-key">Действие</td><td>' + escapeHtml(entry.actionType) + '</td></tr>';
    if (entry.delay) g += '<tr><td class="hdr-key">Задержка</td><td>' + entry.delay + 'ms</td></tr>';
    g += '</table>';
    if (entry.reqBody) {
      g += '<div class="section-label">Тело запроса</div>';
      g += prettyBody(entry.reqBody);
    }
    g += '<div class="detail-actions"><button class="dt-btn" id="btnCopyUrl">URL</button><button class="dt-btn" id="btnCopyCurl">cURL</button>';
    if (entry.body) g += '<button class="dt-btn" id="btnCopyBody">Тело</button>';
    g += '<button class="dt-btn" id="btnMockReq">Замокать</button></div>';
    document.getElementById("tab-general").innerHTML = g;

    // Left: Headers — request + response combined
    var h = "";
    if (entry.reqHeaders && Object.keys(entry.reqHeaders).length) {
      h += '<div class="section-label">Запрос</div>';
      h += formatHeaders(entry.reqHeaders);
    }
    h += '<div class="section-label">Ответ</div>';
    h += formatHeaders(entry.headers);
    document.getElementById("tab-headers").innerHTML = h;

    // Left: Original (only if modified)
    var origTab = document.querySelector('.dt-tab-orig');
    if (entry.originalBody != null) { origTab.classList.remove("hidden"); document.getElementById("tab-original").innerHTML = prettyBody(entry.originalBody); }
    else { origTab.classList.add("hidden"); }

    // Right: Response (ALWAYS visible)
    responseView.innerHTML = prettyBody(entry.body, entry.originalBody);

    // Buttons
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
    if (e.headers) { for (var k in e.headers) cmd += " -H '" + k + ": " + e.headers[k] + "'"; }
    return cmd + " '" + e.url + "'";
  }
  function copyText(text) { navigator.clipboard.writeText(text).then(function () { filterInput.placeholder = "Скопировано!"; setTimeout(function () { filterInput.placeholder = "Фильтр..."; }, 1500); }); }
  function switchTab(name) {
    document.querySelectorAll(".dt-tab").forEach(function (t) { t.classList.remove("active"); });
    document.querySelectorAll(".dt-pane").forEach(function (p) { p.classList.remove("active"); });
    var tab = document.querySelector('.dt-tab[data-tab="' + name + '"]'), pane = document.getElementById("tab-" + name);
    if (tab) tab.classList.add("active"); if (pane) pane.classList.add("active");
  }

  // --- Column resize ---
  function initColumnResize() {
    var ths = document.querySelectorAll("#interceptionTable th");
    Array.prototype.forEach.call(ths, function (th, idx) {
      if (idx >= ths.length - 1) return;
      var nextTh = ths[idx + 1], grip = document.createElement("div");
      grip.className = "col-resizer"; th.appendChild(grip);
      grip.addEventListener("mousedown", function (e) {
        e.preventDefault(); e.stopPropagation();
        var sX = e.clientX, sW = th.getBoundingClientRect().width, sNW = nextTh.getBoundingClientRect().width;
        function onMove(ev) {
          var d = ev.clientX - sX, nW = sW + d, nNW = sNW - d;
          if (nW < 30) { nW = 30; nNW = sW + sNW - 30; }
          if (nNW < 30) { nNW = 30; nW = sW + sNW - 30; }
          th.style.width = nW + "px"; nextTh.style.width = nNW + "px";
        }
        function onUp() { manualCols[idx] = true; manualCols[idx + 1] = true; document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); document.body.style.cursor = ""; document.body.style.userSelect = ""; }
        document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
        document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
      });
    });
  }

  // --- Horizontal split (table height ↔ detail height) ---
  function initHSplit() {
    hSplitHandle.addEventListener("mousedown", function (e) {
      e.preventDefault();
      var sY = e.clientY, sH = detailPanel.getBoundingClientRect().height;
      function onMove(ev) { var nH = Math.max(80, Math.min(window.innerHeight - 120, sH + (sY - ev.clientY))); detailPanel.style.height = nH + "px"; }
      function onUp() { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); document.body.style.cursor = ""; document.body.style.userSelect = ""; }
      document.addEventListener("mousemove", onMove); document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "ns-resize"; document.body.style.userSelect = "none";
    });
  }

  // --- Column sort ---
  function initColumnSort() {
    var ths = document.querySelectorAll("#interceptionTable th");
    Array.prototype.forEach.call(ths, function (th) {
      th.addEventListener("click", function (e) {
        if (e.target.classList.contains("col-resizer")) return;
        var col = th.className.replace(/^col-/, "").split(" ")[0];
        if (sortCol === col) sortDir = -sortDir; else { sortCol = col; sortDir = 1; }
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
    ctxMenu.style.left = e.clientX + "px"; ctxMenu.style.top = e.clientY + "px";
    ctxMenu.classList.remove("hidden"); ctxMenu.dataset.url = entry.url || ""; ctxMenu.dataset.method = entry.method || "GET";
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
      btn.classList.add("active"); statusFilter = btn.dataset.filter; render();
    });
  });
  document.querySelectorAll(".dt-tab").forEach(function (tab) {
    tab.addEventListener("click", function () { switchTab(tab.dataset.tab); });
  });
  closeDetail.addEventListener("click", function () {
    detailPanel.classList.add("hidden"); hSplitHandle.classList.remove("visible");
    selectedId = null; render(); responseView.innerHTML = '<span class="empty">— выберите запрос —</span>';
  });
  filterInput.addEventListener("input", applyFilter);
  clearBtn.addEventListener("click", function () {
    entries = []; filtered = []; render(); selectedId = null;
    detailPanel.classList.add("hidden"); hSplitHandle.classList.remove("visible");
    responseView.innerHTML = '<span class="empty">— выберите запрос —</span>';
  });
  port.onMessage.addListener(function (msg) {
    if (msg.type === "backlog") { if (msg.data[inspectedTabId]) entries = entries.concat(msg.data[inspectedTabId]); applyFilter(); }
    else if (msg.type === "interception") { if (msg.tabId === inspectedTabId) { entries.push(msg.data); applyFilter(); } }
  });

  initColumnResize(); initHSplit(); initColumnSort();
})();
