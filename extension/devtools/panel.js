(function () {
  var inspectedTabId = chrome.devtools.inspectedWindow.tabId;
  // The MV3 service worker is idle-killed (Chrome 114+) even with this port
  // open. On SW restart the old port is dead and broadcasts go nowhere —
  // reconnect with backoff; the background re-sends the backlog on every
  // connect, so nothing is lost. A periodic ping additionally keeps the SW
  // alive while DevTools is open.
  var port = null;
  var portDead = false;
  var portRetry = 0;
  var portRetryTimer = null;
  var panelClosing = false;
  function connectPanel() {
    var p = chrome.runtime.connect({ name: "devtools:" + inspectedTabId });
    p.onMessage.addListener(function (msg) {
      if (msg.type === "backlog") {
        var known = {};
        entries.forEach(function (e) { known[e.id] = true; });
        (msg.data || []).forEach(function (e) { if (!known[e.id]) { known[e.id] = true; entries.push(e); } });
        applyFilter();
      }
      else if (msg.type === "interception") { if (msg.tabId === inspectedTabId) { var ex = null; for (var ei = 0; ei < entries.length; ei++) { if (entries[ei].id === msg.data.id) { ex = entries[ei]; break; } } if (ex) { for (var dk in msg.data) ex[dk] = msg.data[dk]; } else { entries.push(msg.data); } applyFilter(); } }
      else if (msg.type === "clearLog" && msg.tabId === inspectedTabId) { entries = []; filtered = []; selectedId = null; render(); }
      else if (msg.type === "breakpoint" && msg.tabId === inspectedTabId) { queueBreakpointHit(msg.bpMsgId, msg.data); }
      else if (msg.type === "bpPing") {
        // Echo the keepalive: the inbound reply resets the SW idle timer so
        // pendings survive pauses longer than 30s (Chrome 114+ kills idle SWs).
        chrome.runtime.sendMessage({ type: "bpKeepalive" }, function () { void chrome.runtime.lastError; });
      }
    });
    p.onDisconnect.addListener(function () {
      if (panelClosing) return; // DevTools window closing — never resurrect
      portDead = true;
      // SW died (MV3 idle kill) or extension reloaded. Wake it via any message
      // and reconnect; the background answers with a fresh backlog.
      chrome.runtime.sendMessage({ type: "bpKeepalive" }, function () { void chrome.runtime.lastError; });
      clearTimeout(portRetryTimer);
      portRetryTimer = setTimeout(function () {
        if (panelClosing) return;
        connectPanel();
      }, Math.min(1000 * Math.pow(2, Math.min(portRetry, 5)), 15000));
      portRetry++;
    });
    port = p;
    portDead = false;
  }
  connectPanel();
  window.addEventListener("pagehide", function () { panelClosing = true; });
  // Keep the SW alive while DevTools is open so live updates and breakpoint
  // pauses survive idle periods (an open port alone does not).
  setInterval(function () {
    if (!portDead) chrome.runtime.sendMessage({ type: "bpKeepalive" }, function () { void chrome.runtime.lastError; });
  }, 20000);
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
      var isPending = e.pending === true;
      var sc = isPending ? "status-pending" : e.status >= 400 ? "status-error" : e.status >= 300 ? "status-redirect" : e.status >= 200 ? "status-ok" : "";
      var al = isPending ? "..." : e.actionType === "mockResponse" ? "MOCK" : e.actionType === "modifyResponse" ? "MOD-RESP" : (e.actionType === "modifyRequest" || e.actionType === "modifyBody") ? "MOD-REQ" : e.matched ? "matched" : "—";
      var bpCell = "—";
      if (e.bp) {
        var bpLabels = { paused: "BP ⏸", edited: "BP ✏", aborted: "BP ⛔", passed: "BP ✓" };
        var bpTitles = { paused: "Остановлен, ждёт Продолжить", edited: "Изменён через точку останова", aborted: "Отменён через точку останова", passed: "Прошёл точку останова без правок" };
        var bpFieldNames = { url: "url", method: "метод", body: "тело", status: "статус" };
        bpCell = '<span class="bp-badge bp-' + e.bp.outcome + '" title="' + (e.bp.phase === "request" ? "Запрос" : "Ответ") + ": " + (bpTitles[e.bp.outcome] || "") + '">' + (bpLabels[e.bp.outcome] || "BP") + "</span>";
        if (e.bp.changes && e.bp.changes.length) {
          for (var ci = 0; ci < e.bp.changes.length; ci++) {
            var chg = e.bp.changes[ci];
            var fname = bpFieldNames[chg.f] || chg.f;
            function clipTip(s) { s = s == null ? "" : String(s); return s.length > 160 ? s.slice(0, 160) + "…" : s; }
            bpCell += '<span class="bp-chip" title="' + escapeHtml(fname + ":\n" + clipTip(chg.from) + "\n→\n" + clipTip(chg.to)) + '">✏ ' + escapeHtml(fname) + "</span>";
          }
        }
      }
      var rc = (isPending ? "row-pending" : e.matched ? "row-matched" : "row-passthrough") + (e.bp && e.bp.outcome === "edited" ? " row-bp-edited" : "") + (e.id === selectedId ? " row-selected" : "");
      var mc = methodClass(e.method);
      html += '<tr class="' + rc + '" data-id="' + escapeHtml(e.id) + '"><td>' + escapeHtml(formatTime(e.timestamp)) + '</td><td' + (mc ? ' class="' + mc + '"' : '') + '>' + escapeHtml(e.method || "") + '</td><td class="col-url" title="' + escapeHtml(e.url) + '">' + renderUrl(e.url) + '</td><td class="' + sc + '">' + (isPending ? "..." : e.status != null ? e.status : "-") + '</td><td>' + (isPending ? "..." : formatSize(e.body, e.headers)) + '</td><td class="col-action">' + al + '</td><td>' + escapeHtml(e.ruleName || "-") + '</td><td class="col-bp">' + bpCell + '</td></tr>';
    }
    if (countLabel) countLabel.textContent = list.length + " зап." + (mc2 > 0 ? " · " + mc2 + " перехв." : "");
    tbody.innerHTML = html || '<tr><td colspan="8" class="empty-state">Нет запросов</td></tr>';
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
    if (entry.bp && entry.bp.changes && entry.bp.changes.length) {
      g += '<div class="section-label">Изменения точки останова</div>';
      for (var ci = 0; ci < entry.bp.changes.length; ci++) {
        var chg = entry.bp.changes[ci];
        if (chg.f === "body") {
          g += '<div class="bp-change-label">✏ тело <span class="bp-diff-hint">(было → стало, изменённые строки подсвечены)</span></div>';
          g += prettyBody(chg.to, chg.from);
        } else {
          g += '<div class="bp-change-line"><span class="bp-change-field">✏ ' + escapeHtml(chg.f) + '</span> <span class="bp-from">' + escapeHtml(chg.from || "") + '</span> <span class="bp-arrow">→</span> <span class="bp-to">' + escapeHtml(chg.to || "") + '</span></div>';
        }
      }
    }
    if (entry.reqBody) {
      g += '<div class="section-label">Тело запроса</div>';
      g += prettyBody(entry.reqBody);
    }
    g += '<div class="detail-actions"><button class="dt-btn" id="btnCopyUrl">URL</button><button class="dt-btn" id="btnCopyCurl">cURL</button>';
    if (entry.body) g += '<button class="dt-btn" id="btnCopyBody">Тело</button>';
    g += '<button class="dt-btn" id="btnMockReq">Замокать</button><button class="dt-btn" id="btnBpReq" title="Создать точку останова из этого запроса">Точка</button></div>';
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
    if (entry.originalBody != null) { origTab.classList.remove("hidden"); document.getElementById("origContent").innerHTML = prettyBody(entry.originalBody); if (document.getElementById("origSearchInput").value) origSearcher.run(document.getElementById("origSearchInput").value); }
    else { origTab.classList.add("hidden"); }

    // Right: Response (ALWAYS visible)
    responseView.innerHTML = prettyBody(entry.body, entry.originalBody);
    if (document.getElementById("respSearchInput").value) respSearcher.run(document.getElementById("respSearchInput").value);

    // Buttons
    document.getElementById("btnCopyUrl").onclick = function () { copyText(entry.url); };
    document.getElementById("btnCopyCurl").onclick = function () { copyText(buildCurl(entry)); };
    if (entry.body) document.getElementById("btnCopyBody").onclick = function () { copyText(entry.body); };
    document.getElementById("btnMockReq").onclick = function () {
      chrome.tabs.create({ url: chrome.runtime.getURL("panel/panel.html") + "?mockUrl=" + encodeURIComponent(entry.url) + "&mockMethod=" + encodeURIComponent(entry.method) });
    };
    document.getElementById("btnBpReq").onclick = function () {
      openBpConfig(entry.url, entry.method, "request");
    };
    switchTab("general");
  }

  // --- Content search factory (response + original tabs) ---
  function createContentSearcher(container, input, countEl) {
    var marks = [];
    var markIdx = -1;
    var timer = null;
    var prevBtn = document.getElementById(input.id.replace("Input", "Prev"));
    var nextBtn = document.getElementById(input.id.replace("Input", "Next"));

    function clear() {
      var old = container.querySelectorAll("mark.search-hit");
      for (var i = old.length - 1; i >= 0; i--) old[i].parentNode.replaceChild(document.createTextNode(old[i].textContent), old[i]);
      container.normalize();
      marks = []; markIdx = -1; countEl.textContent = "";
    }
    function run(q) {
      clear();
      if (!q) return;
      var ql = q.toLowerCase();
      var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
      var nodes = [], node;
      while (node = walker.nextNode()) nodes.push(node);
      for (var ni = 0; ni < nodes.length; ni++) {
        var tn = nodes[ni], text = tn.textContent, lower = text.toLowerCase();
        var pos = 0, idx, frag = null;
        while ((idx = lower.indexOf(ql, pos)) !== -1) {
          if (!frag) frag = document.createDocumentFragment();
          if (idx > pos) frag.appendChild(document.createTextNode(text.substring(pos, idx)));
          var mark = document.createElement("mark");
          mark.className = "search-hit";
          mark.textContent = text.substring(idx, idx + ql.length);
          frag.appendChild(mark);
          marks.push(mark);
          pos = idx + ql.length;
        }
        if (frag) { if (pos < text.length) frag.appendChild(document.createTextNode(text.substring(pos))); tn.parentNode.replaceChild(frag, tn); }
      }
      if (marks.length > 0) { markIdx = 0; updateCurrent(); }
      else countEl.textContent = "0/0";
    }
    function updateCurrent() {
      marks.forEach(function(m) { m.classList.remove("current"); });
      if (markIdx >= 0 && marks[markIdx]) {
        marks[markIdx].classList.add("current");
        marks[markIdx].scrollIntoView({ block: "center", behavior: "smooth" });
      }
      countEl.textContent = marks.length > 0 ? (markIdx + 1) + "/" + marks.length : "0/0";
    }
    function next() { if (marks.length) { markIdx = (markIdx + 1) % marks.length; updateCurrent(); } }
    function prev() { if (marks.length) { markIdx = (markIdx - 1 + marks.length) % marks.length; updateCurrent(); } }

    input.addEventListener("input", function () {
      clearTimeout(timer);
      var v = input.value;
      timer = setTimeout(function () { run(v); }, 200);
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? prev() : next(); }
      else if (e.key === "Escape") { input.value = ""; run(""); input.blur(); }
    });
    if (prevBtn) prevBtn.addEventListener("click", prev);
    if (nextBtn) nextBtn.addEventListener("click", next);

    return { run: run, clear: clear };
  }

  var respSearcher = createContentSearcher(responseView, document.getElementById("respSearchInput"), document.getElementById("respSearchCount"));
  var origSearcher = createContentSearcher(document.getElementById("origContent"), document.getElementById("origSearchInput"), document.getElementById("origSearchCount"));

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
    var action = e.target.dataset.action;
    ctxMenu.classList.add("hidden");
    if (!url || !action) return;
    if (action === "mock") {
      chrome.tabs.create({ url: chrome.runtime.getURL("panel/panel.html") + "?mockUrl=" + encodeURIComponent(url) + "&mockMethod=" + encodeURIComponent(method) });
    } else if (action === "bpReq" || action === "bpResp") {
      openBpConfig(url, method, action === "bpReq" ? "request" : "response");
    }
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
  var chkClearLog = document.getElementById("chkClearLog");
  if (chkClearLog) {
    chrome.storage.local.get({ clearLogOnReload: false }, function (d) { chkClearLog.checked = !!d.clearLogOnReload; });
    chkClearLog.addEventListener("change", function () {
      chrome.storage.local.set({ clearLogOnReload: chkClearLog.checked });
    });
  }
  clearBtn.addEventListener("click", function () {
    entries = []; filtered = []; render(); selectedId = null;
    detailPanel.classList.add("hidden"); hSplitHandle.classList.remove("visible");
    responseView.innerHTML = '<span class="empty">— выберите запрос —</span>';
  });
  // --- Breakpoints ---
  var bpStore = [];
  var bpBtn = document.getElementById("bpBtn");
  var bpOverlay = document.getElementById("bpOverlay");
  var bpListOverlay = document.getElementById("bpListOverlay");
  var bpConfigOverlay = document.getElementById("bpConfigOverlay");
  var bpModalTitle = document.getElementById("bpModalTitle");
  var bpModalBody = document.getElementById("bpModalBody");
  var bpListBody = document.getElementById("bpListBody");
  var currentBpMsgId = null;
  var bpExtractedVars = {};
  var bpConfigEditIdx = -1;

  chrome.runtime.sendMessage({ type: "getRules" }, function (res) {
    if (res && res.rules) bpStore = res.rules.filter(function (r) { return r.type === "breakpoint"; });
    updateBpButton();
  });

  function saveBpStore() {
    // MUST go through the background: it owns the in-memory rules and pushes
    // RULES_UPDATED to all tabs, making the breakpoint active immediately.
    // (Direct chrome.storage writes left the page without the new rule.)
    chrome.runtime.sendMessage({ type: "saveBreakpoints", breakpoints: bpStore });
  }

  function updateBpButton() {
    var activeCount = bpStore.filter(function(b) { return b.enabled; }).length;
    bpBtn.textContent = activeCount > 0 ? "⛔ " + activeCount : "⛔";
    bpBtn.classList.toggle("has-bp", activeCount > 0);
  }

  // --- Config Dialog ---
  function openBpConfig(url, method, phase, editIdx) {
    bpConfigEditIdx = editIdx != null ? editIdx : -1;
    document.getElementById("bpCfgUrl").value = url || "";
    document.getElementById("bpCfgPhase").value = phase || "response";
    document.getElementById("bpCfgMethod").value = method || "ANY";
    var extractsEl = document.getElementById("bpCfgExtracts");
    extractsEl.innerHTML = "";
    if (editIdx != null && bpStore[editIdx] && bpStore[editIdx].breakpoint.extracts) {
      bpStore[editIdx].breakpoint.extracts.forEach(function(ex) { addExtractRow(ex.name, ex.path); });
    }
    bpConfigOverlay.classList.remove("hidden");
  }

  function addExtractRow(name, path) {
    var row = document.createElement("div");
    row.className = "bp-extract-row";
    row.innerHTML = '<input type="text" class="bp-extract-name bp-url-input" placeholder="$varName" style="max-width:130px" value="' + escapeHtml(name || "") + '">' +
      '<input type="text" class="bp-extract-path bp-url-input" placeholder="$.data.token" value="' + escapeHtml(path || "") + '">' +
      '<button class="dt-btn bp-extract-del" style="font-size:14px;padding:2px 8px">×</button>';
    row.querySelector(".bp-extract-del").addEventListener("click", function() { row.remove(); });
    document.getElementById("bpCfgExtracts").appendChild(row);
  }

  document.getElementById("bpCfgAddExtract").addEventListener("click", function() { addExtractRow(); });
  document.getElementById("bpCfgCancel").addEventListener("click", function() { bpConfigOverlay.classList.add("hidden"); });
  document.getElementById("bpCfgSave").addEventListener("click", function() {
    var url = document.getElementById("bpCfgUrl").value.trim() || "*/api/*";
    var phase = document.getElementById("bpCfgPhase").value;
    var method = document.getElementById("bpCfgMethod").value;
    var extracts = [];
    document.querySelectorAll("#bpCfgExtracts .bp-extract-row").forEach(function(row) {
      var n = row.querySelector(".bp-extract-name").value.trim();
      var p = row.querySelector(".bp-extract-path").value.trim();
      if (n && p) extracts.push({ name: n.startsWith("$") ? n : "$" + n, path: p });
    });
    if (bpConfigEditIdx >= 0 && bpStore[bpConfigEditIdx]) {
      var bp = bpStore[bpConfigEditIdx];
      bp.match.urlPattern = url;
      bp.match.method = method;
      bp.breakpoint.phase = phase;
      bp.breakpoint.extracts = extracts;
    } else {
      bpStore.push({
        id: "bp_" + Date.now().toString(36), type: "breakpoint", name: "BP: " + shortUrl(url), enabled: true,
        match: { urlPattern: url, method: method },
        breakpoint: { phase: phase, autoResume: 0, extracts: extracts }
      });
    }
    saveBpStore(); updateBpButton(); renderBpList();
    bpConfigOverlay.classList.add("hidden");
  });
  bpConfigOverlay.addEventListener("click", function(e) {
    if (e.target === bpConfigOverlay) bpConfigOverlay.classList.add("hidden");
  });

  // --- Hit Overlay (queue: multiple pauses stack, one shown at a time) ---
  var bpQueue = [];

  function queueBreakpointHit(bpMsgId, data) {
    bpQueue.push({ bpMsgId: bpMsgId, data: data });
    if (bpOverlay.classList.contains("hidden")) showCurrentBpHit();
    else {
      var shown = bpQueue[0];
      updateBpQueueTitle(shown.data, bpQueue.length - 1);
    }
  }

  function updateBpQueueTitle(data, queued) {
    var suffix = queued > 0 ? ' <span style="color:var(--ctp-yellow)">+' + queued + ' в очереди</span>' : "";
    bpModalTitle.innerHTML = "⛔ " + (data.phase === "request" ? "Запрос" : "Ответ") + ": " + escapeHtml((data.method || "") + " " + shortUrl(data.url)) + suffix;
  }

  function prettyText(body) {
    if (body == null) return "";
    var s = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    try { return JSON.stringify(JSON.parse(s), null, 2); } catch (e) { return s; }
  }

  // Renders bpQueue[0] without dequeuing it; resumeBreakpoint() pops it.
  function showCurrentBpHit() {
    var hit = bpQueue[0];
    if (!hit) { bpOverlay.classList.add("hidden"); return; }
    var data = hit.data;
    currentBpMsgId = hit.bpMsgId;
    bpExtractedVars = {};
    for (var i = 0; i < bpStore.length; i++) {
      var bp = bpStore[i];
      if (!bp.enabled || bp.breakpoint.phase !== data.phase) continue;
      if (!bp.breakpoint.extracts || bp.breakpoint.extracts.length === 0) continue;
      if (data.body) {
        for (var j = 0; j < bp.breakpoint.extracts.length; j++) {
          var ex = bp.breakpoint.extracts[j];
          var val = extractJsonPath(data.body, ex.path);
          if (val != null) bpExtractedVars[ex.name] = val;
        }
      }
    }
    updateBpQueueTitle(data, bpQueue.length - 1);
    var isReq = data.phase === "request";
    var html = "";
    if (isReq) {
      html += '<div class="bp-cfg-row"><div class="bp-field" style="flex:0 0 90px"><label>Метод</label>' +
        '<input type="text" id="bpEditMethod" value="' + escapeHtml(data.method || "GET") + '"></div>' +
        '<div class="bp-field" style="flex:1"><label>URL</label>' +
        '<input type="text" id="bpEditUrl" value="' + escapeHtml(data.url || "") + '"></div></div>';
    } else {
      html += '<div class="bp-field" style="max-width:120px"><label>Статус</label>' +
        '<input type="text" id="bpEditStatus" value="' + escapeHtml(String(data.status != null ? data.status : "")) + '"></div>';
    }
    if (data.headers) {
      html += '<div class="bp-field"><label>Заголовки</label><pre class="json-body" style="max-height:120px;overflow:auto">';
      var hk = Object.keys(data.headers).sort();
      for (var h = 0; h < hk.length; h++) html += '<span class="json-key">' + escapeHtml(hk[h]) + "</span>: " + escapeHtml(data.headers[hk[h]]) + "\n";
      html += '</pre></div>';
    }
    if (data.body != null) {
      html += '<div class="bp-field"><label>Тело ' + (isReq ? "запроса" : "ответа") +
        ' <span style="text-transform:none">(правки применяются при «Продолжить», поддерживаются $переменные)</span></label>';
      html += '<textarea id="bpEditBody" rows="10" spellcheck="false">' + escapeHtml(prettyText(data.body)) + '</textarea>';
      html += '</div>';
    }
    var vk = Object.keys(bpExtractedVars);
    if (vk.length > 0) {
      html += '<div class="bp-extract"><label>Извлечённые переменные</label>';
      for (var v = 0; v < vk.length; v++) {
        html += '<div class="bp-var-item"><span class="json-key">' + escapeHtml(vk[v]) + '</span> = <span class="json-str">' + escapeHtml(String(bpExtractedVars[vk[v]]).substring(0, 200)) + '</span></div>';
      }
      html += '</div>';
    }
    bpModalBody.innerHTML = html;
    bpOverlay.classList.remove("hidden");
  }

  function extractJsonPath(body, path) {
    try {
      var obj = JSON.parse(body);
      var parts = path.replace(/^\$\./, "").split(".");
      for (var i = 0; i < parts.length; i++) obj = obj[parts[i]];
      return obj;
    } catch (e) { return null; }
  }

  function collectMods(data) {
    // Report only fields the user actually changed.
    var mods = {};
    var urlEl = document.getElementById("bpEditUrl");
    var methodEl = document.getElementById("bpEditMethod");
    var statusEl = document.getElementById("bpEditStatus");
    var bodyEl = document.getElementById("bpEditBody");
    if (urlEl && urlEl.value.trim() !== (data.url || "")) mods.url = urlEl.value.trim();
    if (methodEl && methodEl.value.trim().toUpperCase() !== (data.method || "GET")) mods.method = methodEl.value.trim().toUpperCase();
    if (statusEl && String(statusEl.value).trim() !== String(data.status != null ? data.status : "")) mods.status = String(statusEl.value).trim();
    if (bodyEl && bodyEl.value !== prettyText(data.body)) mods.body = bodyEl.value;
    return mods;
  }

  function resumeBreakpoint(action) {
    if (!currentBpMsgId) return;
    var hit = bpQueue.shift(); // the currently shown hit
    var result = { action: action, vars: bpExtractedVars };
    if (action !== "abort" && hit) {
      var mods = collectMods(hit.data);
      if (Object.keys(mods).length > 0) result.mods = mods;
    }
    port.postMessage({ type: "breakpointResume", bpMsgId: currentBpMsgId, result: result });
    currentBpMsgId = null;
    if (bpQueue.length > 0) showCurrentBpHit();
    else bpOverlay.classList.add("hidden");
  }

  // --- Breakpoint List ---
  function renderBpList() {
    if (bpStore.length === 0) {
      bpListBody.innerHTML = '<div class="empty">Нет точек останова</div>';
      return;
    }
    var html = "";
    for (var i = 0; i < bpStore.length; i++) {
      var bp = bpStore[i];
      var extractCount = (bp.breakpoint.extracts || []).length;
      html += '<div class="bp-item">';
      html += '<input type="checkbox" class="bp-toggle" data-idx="' + i + '"' + (bp.enabled ? " checked" : "") + ">";
      html += '<span class="bp-item-phase">' + (bp.breakpoint.phase === "request" ? "REQ" : "RESP") + "</span>";
      html += '<span class="bp-item-url">' + escapeHtml(bp.match.urlPattern) + "</span>";
      if (extractCount > 0) html += '<span class="bp-extract-badge">' + extractCount + " var</span>";
      html += '<button class="dt-btn bp-edit" data-idx="' + i + '" style="font-size:11px;padding:2px 8px">&#9998;</button>';
      html += '<button class="dt-btn bp-del" data-idx="' + i + '" style="font-size:14px;padding:2px 8px">&times;</button>';
      html += "</div>";
    }
    bpListBody.innerHTML = html;
    bpListBody.querySelectorAll(".bp-toggle").forEach(function(cb) {
      cb.addEventListener("change", function() {
        bpStore[parseInt(this.dataset.idx)].enabled = this.checked;
        saveBpStore(); updateBpButton();
      });
    });
    bpListBody.querySelectorAll(".bp-edit").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var idx = parseInt(this.dataset.idx);
        var bp = bpStore[idx];
        bpListOverlay.classList.add("hidden");
        openBpConfig(bp.match.urlPattern, bp.match.method, bp.breakpoint.phase, idx);
      });
    });
    bpListBody.querySelectorAll(".bp-del").forEach(function(btn) {
      btn.addEventListener("click", function() {
        bpStore.splice(parseInt(this.dataset.idx), 1);
        saveBpStore(); renderBpList(); updateBpButton();
      });
    });
  }

  function resumeBreakpoint(action) {
    if (!currentBpMsgId) return;
    var hit = bpQueue.shift(); // the currently shown hit
    var result = { action: action, vars: bpExtractedVars };
    if (action !== "abort" && hit) {
      var mods = collectMods(hit.data);
      if (Object.keys(mods).length > 0) result.mods = mods;
    }
    if (portDead) {
      // Port died with the SW; pendings were auto-resumed on its restart.
      chrome.runtime.sendMessage({ type: "breakpointResume", bpMsgId: currentBpMsgId, result: result }, function () { void chrome.runtime.lastError; });
    } else {
      try { port.postMessage({ type: "breakpointResume", bpMsgId: currentBpMsgId, result: result }); }
      catch (e) {
        portDead = true;
        chrome.runtime.sendMessage({ type: "breakpointResume", bpMsgId: currentBpMsgId, result: result }, function () { void chrome.runtime.lastError; });
      }
    }
    currentBpMsgId = null;
    if (bpQueue.length > 0) showCurrentBpHit();
    else bpOverlay.classList.add("hidden");
  }
  document.getElementById("bpAddBtn").addEventListener("click", function() {
    bpListOverlay.classList.add("hidden");
    openBpConfig("", "ANY", "response");
  });
  bpBtn.addEventListener("click", function() {
    renderBpList();
    bpListOverlay.classList.remove("hidden");
  });
  bpListOverlay.addEventListener("click", function(e) {
    if (e.target === bpListOverlay) bpListOverlay.classList.add("hidden");
  });
  document.getElementById("bpResume").addEventListener("click", function() { resumeBreakpoint("resume"); });
  document.getElementById("bpAbort").addEventListener("click", function() { resumeBreakpoint("abort"); });

  initColumnResize(); initHSplit(); initColumnSort();
})();
