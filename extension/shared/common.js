var ACTION_TYPES = {
  MOCK_RESPONSE: "mockResponse",
  MODIFY_REQUEST: "modifyRequest",
  MODIFY_RESPONSE: "modifyResponse",
  MODIFY_BODY: "modifyBody"
};

var $ = function (id) { return document.getElementById(id); };

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function createDefaultRule() {
  return {
    id: generateId(),
    name: "",
    enabled: true,
    match: { urlPattern: "", method: "ANY", resourceType: "", bodyConditions: [] },
    action: {
      type: ACTION_TYPES.MOCK_RESPONSE,
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: "{}",
      delay: 0,
      removeHeaders: [],
      setHeaders: {},
      removeResponseHeaders: [],
      setResponseHeaders: {},
      transforms: []
    }
  };
}

function validateRule(rule) {
  if (!rule || !rule.id) return { valid: false, error: "Нет ID правила" };
  if (!rule.match || !rule.match.urlPattern) return { valid: false, error: "Укажите URL-паттерн" };
  if (!rule.action || !rule.action.type) return { valid: false, error: "Укажите тип действия" };
  if (rule.action.type === ACTION_TYPES.MOCK_RESPONSE && typeof rule.action.status !== "number") {
    return { valid: false, error: "Укажите статус-код" };
  }
  return { valid: true };
}

function findRuleById(list, id) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i];
  }
  return null;
}

var presetFactories = {
  error500: function (p) {
    return { id: generateId(), name: "500 Internal Server Error", enabled: true,
      match: { urlPattern: p, method: "ANY", resourceType: "" },
      action: { type: ACTION_TYPES.MOCK_RESPONSE, status: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Internal Server Error", code: 500, message: "Something went wrong" }) } };
  },
  forbidden403: function (p) {
    return { id: generateId(), name: "403 Forbidden", enabled: true,
      match: { urlPattern: p, method: "ANY", resourceType: "" },
      action: { type: ACTION_TYPES.MOCK_RESPONSE, status: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Forbidden", code: 403, message: "Access denied" }) } };
  },
  mock401: function (p) {
    return { id: generateId(), name: "401 Unauthorized", enabled: true,
      match: { urlPattern: p, method: "ANY", resourceType: "" },
      action: { type: ACTION_TYPES.MOCK_RESPONSE, status: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized", code: 401, message: "Invalid or missing token" }) } };
  },
  partialData: function (p) {
    return { id: generateId(), name: "Частичные данные", enabled: true,
      match: { urlPattern: p, method: "GET", resourceType: "" },
      action: { type: ACTION_TYPES.MOCK_RESPONSE, status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 1, name: "John Doe" }, null, 2) + "\n\n// Удалите поля для теста: email, phone, address" } };
  },
  removeAuth: function (p) {
    return { id: generateId(), name: "Убрать Authorization", enabled: true,
      match: { urlPattern: p, method: "ANY", resourceType: "" },
      action: { type: ACTION_TYPES.MODIFY_REQUEST, removeHeaders: ["Authorization"], setHeaders: {} } };
  },

  noContent204: function (p) {
    return { id: generateId(), name: "204 No Content", enabled: true,
      match: { urlPattern: p, method: "ANY", resourceType: "" },
      action: { type: ACTION_TYPES.MOCK_RESPONSE, status: 204, headers: {}, body: "", delay: 0 } };
  },
  removeCors: function (p) {
    return { id: generateId(), name: "Убрать CORS", enabled: true,
      match: { urlPattern: p, method: "ANY", resourceType: "" },
      action: { type: ACTION_TYPES.MODIFY_RESPONSE,
        removeResponseHeaders: ["Access-Control-Allow-Origin", "Access-Control-Allow-Methods", "Access-Control-Allow-Headers", "Access-Control-Allow-Credentials"],
        setResponseHeaders: {} } };
  },
  modifyBodyValue: function (p) {
    return { id: generateId(), name: "Заменить значение в теле", enabled: true,
      match: { urlPattern: p, method: "POST", resourceType: "", bodyConditions: [
        { path: "signal", operator: "equals", value: "protect" }
      ] },
      action: { type: ACTION_TYPES.MODIFY_BODY,
        transforms: [
          { path: "signal", value: "unprotect" }
        ] } };
  }
};

function formatTime(ts) {
  if (!ts) return "-";
  var d = new Date(ts);
  return d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function escapeHtml(str) {
  var div = document.createElement("div");
  div.appendChild(document.createTextNode(str || ""));
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function addKvRow(containerId, key, value) {
  var row = document.createElement("div");
  row.className = "kv-row";
  row.innerHTML = '<input type="text" class="kv-key" placeholder="Ключ" value="' + escapeAttr(key || "") + '">' +
    '<input type="text" class="kv-value" placeholder="Значение" value="' + escapeAttr(value || "") + '">' +
    '<button type="button" class="kv-remove">&times;</button>';
  row.querySelector(".kv-remove").addEventListener("click", function () { row.remove(); });
  $(containerId).appendChild(row);
}

function collectKvPairs(containerId) {
  var result = {};
  $(containerId).querySelectorAll(".kv-row").forEach(function (row) {
    var k = row.querySelector(".kv-key").value.trim();
    var v = row.querySelector(".kv-value").value.trim();
    if (k) result[k] = v;
  });
  return result;
}

function addRemoveHeaderTag(header, containerId) {
  var tag = document.createElement("span");
  tag.className = "tag";
  tag.setAttribute("data-header", header);
  tag.innerHTML = escapeHtml(header) + '<button type="button">&times;</button>';
  tag.querySelector("button").addEventListener("click", function () { tag.remove(); });
  $(containerId || "removeHeadersTags").appendChild(tag);
}

function collectRemoveHeaderTags(containerId) {
  var result = [];
  $(containerId || "removeHeadersTags").querySelectorAll(".tag").forEach(function (tag) {
    var h = tag.getAttribute("data-header");
    if (h) result.push(h);
  });
  return result;
}

function addBodyConditionRow(containerId, cond) {
  var row = document.createElement("div");
  row.className = "bc-row";
  row.innerHTML = '<input type="text" class="bc-path" placeholder="items[0].name" value="' + escapeAttr(cond.path || "") + '">' +
    '<select class="bc-op">' +
    '<option value="equals"' + (cond.operator === "equals" ? " selected" : "") + '>равно</option>' +
    '<option value="notEquals"' + (cond.operator === "notEquals" ? " selected" : "") + '>не равно</option>' +
    '<option value="contains"' + (cond.operator === "contains" ? " selected" : "") + '>содержит</option>' +
    '<option value="exists"' + (cond.operator === "exists" ? " selected" : "") + '>существует</option>' +
    '</select>' +
    '<input type="text" class="bc-value" placeholder="Значение" value="' + escapeAttr(cond.value || "") + '">' +
    '<button type="button" class="bc-remove">&times;</button>';
  row.querySelector(".bc-op").addEventListener("change", function () {
    row.querySelector(".bc-value").style.display = this.value === "exists" ? "none" : "";
  });
  if (cond.operator === "exists") row.querySelector(".bc-value").style.display = "none";
  row.querySelector(".bc-remove").addEventListener("click", function () { row.remove(); });
  $(containerId).appendChild(row);
}

function collectBodyConditions(containerId) {
  var result = [];
  $(containerId).querySelectorAll(".bc-row").forEach(function (row) {
    var p = row.querySelector(".bc-path").value.trim();
    var op = row.querySelector(".bc-op").value;
    var v = row.querySelector(".bc-value").value.trim();
    if (p) result.push({ path: p, operator: op, value: v });
  });
  return result;
}

function addTransformRow(containerId, t) {
  var row = document.createElement("div");
  row.className = "kv-row";
  row.innerHTML = '<input type="text" class="kv-key" placeholder="items[0].name" value="' + escapeAttr(t.path || "") + '">' +
    '<input type="text" class="kv-value" placeholder="Новое значение" value="' + escapeAttr(t.value || "") + '">' +
    '<button type="button" class="kv-remove">&times;</button>';
  row.querySelector(".kv-remove").addEventListener("click", function () { row.remove(); });
  $(containerId).appendChild(row);
}

function collectTransformRows(containerId) {
  var result = [];
  $(containerId).querySelectorAll(".kv-row").forEach(function (row) {
    var p = row.querySelector(".kv-key").value.trim();
    var v = row.querySelector(".kv-value").value.trim();
    if (p) result.push({ path: p, value: v });
  });
  return result;
}

function toggleActionFields(type) {
  $("mockResponseFields").classList.toggle("hidden", type !== "mockResponse");
  $("modifyRequestFields").classList.toggle("hidden", type !== "modifyRequest");
  $("modifyResponseFields").classList.toggle("hidden", type !== "modifyResponse");
  $("modifyBodyFields").classList.toggle("hidden", type !== "modifyBody");
}

function highlightJSON(str) {
  if (!str) return "\n";
  var s = str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return s.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    function (m) {
      var c = "json-number";
      if (/^"/.test(m)) {
        c = /:$/.test(m) ? "json-key" : "json-string";
      } else if (/true|false/.test(m)) {
        c = "json-boolean";
      } else if (/null/.test(m)) {
        c = "json-null";
      }
      return '<span class="' + c + '">' + m + "</span>";
    }
  ) + "\n";
}

function applySearchHighlight(html, query) {
  if (!query) return html;
  var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var re = new RegExp("(" + escaped + ")", "gi");
  return html.replace(re, function(match, p1, offset, string) {
    var before = string.substring(0, offset);
    var lastOpen = before.lastIndexOf("<");
    var lastClose = before.lastIndexOf(">");
    if (lastOpen > lastClose) return match;
    return '<mark class="search-match">' + match + "</mark>";
  });
}

function updateBodyHighlight(textareaId, highlightId) {
  var ta = $(textareaId);
  var code = $(highlightId);
  if (!ta || !code) return;
  var html = highlightJSON(ta.value);
  var query = ta.dataset.searchQuery || "";
  if (query) {
    html = applySearchHighlight(html, query);
  }
  code.innerHTML = html;
  if (query) {
    var idx = parseInt(ta.dataset.searchCurrentIdx, 10);
    if (!isNaN(idx) && idx >= 0) {
      var marks = code.querySelectorAll(".search-match");
      if (marks[idx]) marks[idx].classList.add("current");
    }
  }
}

function validateJSONBody(textareaId, msgId) {
  var ta = $(textareaId);
  var msg = $(msgId);
  if (!ta || !msg) return;
  var val = ta.value.trim();
  if (!val) {
    msg.textContent = "";
    msg.className = "json-valid-msg empty";
    return;
  }
  try {
    JSON.parse(val);
    msg.textContent = "Valid JSON";
    msg.className = "json-valid-msg valid";
  } catch (e) {
    msg.textContent = e.message.replace(/^JSON\.parse:\s*/, "");
    msg.className = "json-valid-msg invalid";
  }
}

function syncBodyScroll(textareaId, highlightId) {
  var ta = $(textareaId);
  var code = $(highlightId);
  if (!ta || !code) return;
  var pre = code.parentElement;
  pre.scrollTop = ta.scrollTop;
  pre.scrollLeft = ta.scrollLeft;
}

function setupBodyEditor(textareaId, highlightId, msgId) {
  var ta = $(textareaId);
  if (!ta || ta.dataset.editorInit) return;
  ta.dataset.editorInit = "1";
  var wrap = ta.closest(".json-editor-wrap");

  function update() {
    updateBodyHighlight(textareaId, highlightId);
    validateJSONBody(textareaId, msgId);
  }

  ta.addEventListener("input", update);
  ta.addEventListener("scroll", function () { syncBodyScroll(textareaId, highlightId); });
  ta.addEventListener("focus", function () { if (wrap) wrap.classList.add("focused"); });
  ta.addEventListener("blur", function () { if (wrap) wrap.classList.remove("focused"); });

  ta.addEventListener("paste", function (e) {
    var pasted = (e.clipboardData || window.clipboardData).getData("text");
    try {
      var parsed = JSON.parse(pasted);
      e.preventDefault();
      ta.value = JSON.stringify(parsed, null, 2);
      update();
    } catch (err) {}
  });

  ta.addEventListener("keydown", function (e) {
    if (e.key === "Tab") {
      e.preventDefault();
      var start = ta.selectionStart;
      var end = ta.selectionEnd;
      ta.value = ta.value.substring(0, start) + "  " + ta.value.substring(end);
      ta.selectionStart = ta.selectionEnd = start + 2;
      update();
    }
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      formatBodyIn(textareaId, highlightId, msgId);
    }
  });

  update();
}

function formatBodyIn(textareaId, highlightId, msgId) {
  var ta = $(textareaId);
  if (!ta) return;
  var val = ta.value.trim();
  if (!val) return;
  try {
    ta.value = JSON.stringify(JSON.parse(val), null, 2);
  } catch (e) {}
  ta.scrollTop = 0;
  ta.scrollLeft = 0;
  updateBodyHighlight(textareaId, highlightId);
  syncBodyScroll(textareaId, highlightId);
  validateJSONBody(textareaId, msgId);
}

function setupSearch(textareaId, highlightId, inputId, countId, prevId, nextId) {
  var ta = $(textareaId);
  var input = $(inputId);
  if (!ta || !input || input.dataset.searchInit) return;
  input.dataset.searchInit = "1";

  var countEl = $(countId);
  var matches = [];
  var currentIdx = -1;

  function findMatches() {
    matches = [];
    currentIdx = -1;
    var q = input.value;
    if (!q) {
      countEl.textContent = "";
      ta.dataset.searchQuery = "";
      ta.dataset.searchCurrentIdx = "-1";
      updateBodyHighlight(textareaId, highlightId);
      return;
    }
    var text = ta.value.toLowerCase();
    var ql = q.toLowerCase();
    var pos = 0;
    while (true) {
      pos = text.indexOf(ql, pos);
      if (pos === -1) break;
      matches.push(pos);
      pos++;
    }
    if (matches.length > 0) currentIdx = 0;
    countEl.textContent = matches.length > 0 ? (currentIdx + 1) + "/" + matches.length : "0/0";
    ta.dataset.searchQuery = q;
    ta.dataset.searchCurrentIdx = String(currentIdx);
    updateBodyHighlight(textareaId, highlightId);
    scrollToMatch();
  }

  function scrollToMatch() {
    if (currentIdx < 0 || currentIdx >= matches.length) return;
    var start = matches[currentIdx];
    var before = ta.value.substring(0, start);
    var lines = before.split("\n").length;
    var lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    ta.scrollTop = Math.max(0, (lines - 3) * lh);
    syncBodyScroll(textareaId, highlightId);
  }

  function selectAndScroll() {
    if (currentIdx < 0 || currentIdx >= matches.length) return;
    var start = matches[currentIdx];
    var end = start + input.value.length;
    ta.focus();
    ta.setSelectionRange(start, end);
    scrollToMatch();
  }

  function next() {
    if (!matches.length) return;
    currentIdx = (currentIdx + 1) % matches.length;
    countEl.textContent = (currentIdx + 1) + "/" + matches.length;
    ta.dataset.searchCurrentIdx = String(currentIdx);
    updateBodyHighlight(textareaId, highlightId);
    selectAndScroll();
  }

  function prev() {
    if (!matches.length) return;
    currentIdx = (currentIdx - 1 + matches.length) % matches.length;
    countEl.textContent = (currentIdx + 1) + "/" + matches.length;
    ta.dataset.searchCurrentIdx = String(currentIdx);
    updateBodyHighlight(textareaId, highlightId);
    selectAndScroll();
  }

  input.addEventListener("input", findMatches);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? prev() : next(); }
  });
  $(nextId).addEventListener("click", next);
  $(prevId).addEventListener("click", prev);
}

function openBodyFullscreen() {
  var src = $("editBody");
  var dst = $("editBodyFS");
  if (!src || !dst) return;
  dst.value = src.value;
  updateBodyHighlight("editBodyFS", "editBodyHighlightFS");
  validateJSONBody("editBodyFS", "jsonValidMsgFS");
  $("bodyFullscreenModal").classList.remove("hidden");
  dst.focus();
}

function closeBodyFullscreen() {
  var src = $("editBodyFS");
  var dst = $("editBody");
  if (!src || !dst) return;
  dst.value = src.value;
  updateBodyHighlight("editBody", "editBodyHighlight");
  validateJSONBody("editBody", "jsonValidMsg");
  $("bodyFullscreenModal").classList.add("hidden");
}

function showEditorError(msg) {
  var existing = document.querySelector(".editor-error");
  if (existing) existing.remove();
  var div = document.createElement("div");
  div.className = "editor-error";
  div.textContent = msg;
  $("editor").appendChild(div);
  setTimeout(function () { if (div.parentNode) div.remove(); }, 4000);
}

function saveState() {
  chrome.storage.local.set({ rules: rules, masterEnabled: masterEnabled });
  chrome.runtime.sendMessage({ type: "saveRules", rules: rules, masterEnabled: masterEnabled });
}

function toggleRule(id, enabled) {
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].id === id) { rules[i].enabled = enabled; break; }
  }
  saveState();
  renderRules();
}

function deleteRuleById(id) {
  var btn = document.querySelector('.btn-delete[data-id="' + id + '"]');
  if (btn && btn.dataset.confirm === "1") {
    rules = rules.filter(function (r) { return r.id !== id; });
    saveState();
    renderRules();
    return;
  }
  if (btn) {
    btn.dataset.confirm = "1";
    btn.textContent = "?";
    btn.title = "Нажмите ещё раз для удаления";
    setTimeout(function () {
      if (btn) { btn.dataset.confirm = ""; btn.textContent = "\u00d7"; btn.title = "Удалить"; }
    }, 3000);
  }
}

function openEditor(ruleId) {
  editingRuleId = ruleId;
  var rule = ruleId ? findRuleById(rules, ruleId) : createDefaultRule();
  $("editorTitle").textContent = ruleId ? "Редактирование" : "Новое правило";
  $("editName").value = rule.name;
  $("editUrlPattern").value = rule.match.urlPattern;
  $("editMethod").value = rule.match.method || "ANY";
  $("editActionType").value = rule.action.type;
  $("editStatus").value = rule.action.status || 200;
  $("editDelay").value = rule.action.delay || 0;
  $("editBody").value = rule.action.body || "{}";

  $("headersEditor").innerHTML = "";
  if (rule.action.headers) {
    Object.keys(rule.action.headers).forEach(function (k) { addKvRow("headersEditor", k, rule.action.headers[k]); });
  }
  $("setHeadersEditor").innerHTML = "";
  if (rule.action.setHeaders) {
    Object.keys(rule.action.setHeaders).forEach(function (k) { addKvRow("setHeadersEditor", k, rule.action.setHeaders[k]); });
  }
  $("removeHeadersTags").innerHTML = "";
  if (rule.action.removeHeaders) {
    rule.action.removeHeaders.forEach(function (h) { addRemoveHeaderTag(h); });
  }
  $("removeRespHeadersTags").innerHTML = "";
  if (rule.action.removeResponseHeaders) {
    rule.action.removeResponseHeaders.forEach(function (h) { addRemoveHeaderTag(h, "removeRespHeadersTags"); });
  }
  $("setRespHeadersEditor").innerHTML = "";
  if (rule.action.setResponseHeaders) {
    Object.keys(rule.action.setResponseHeaders).forEach(function (k) { addKvRow("setRespHeadersEditor", k, rule.action.setResponseHeaders[k]); });
  }

  $("bodyConditionsEditor").innerHTML = "";
  if (rule.match.bodyConditions) {
    rule.match.bodyConditions.forEach(function (c) { addBodyConditionRow("bodyConditionsEditor", c); });
  }
  $("transformsEditor").innerHTML = "";
  if (rule.action.transforms) {
    rule.action.transforms.forEach(function (t) { addTransformRow("transformsEditor", t); });
  }

  toggleActionFields(rule.action.type);
  loadSeenUrls();
  $("editor").classList.remove("hidden");
  setupBodyEditor("editBody", "editBodyHighlight", "jsonValidMsg");
  $("editUrlPattern").focus();
}

function closeEditor() {
  $("editor").classList.add("hidden");
  editingRuleId = null;
}

function saveEditor() {
  var actionType = $("editActionType").value;
  var rule = editingRuleId ? findRuleById(rules, editingRuleId) : createDefaultRule();
  if (!editingRuleId) rules.push(rule);
  rule.name = $("editName").value || "Без названия";
  rule.match.urlPattern = $("editUrlPattern").value;
  rule.match.method = $("editMethod").value;
  rule.match.bodyConditions = collectBodyConditions("bodyConditionsEditor");
  rule.action.type = actionType;
  if (actionType === "mockResponse") {
    rule.action.status = parseInt($("editStatus").value, 10) || 200;
    rule.action.headers = collectKvPairs("headersEditor");
    rule.action.body = $("editBody").value;
    rule.action.delay = parseInt($("editDelay").value, 10) || 0;
  } else if (actionType === "modifyRequest") {
    rule.action.removeHeaders = collectRemoveHeaderTags();
    rule.action.setHeaders = collectKvPairs("setHeadersEditor");
  } else if (actionType === "modifyResponse") {
    rule.action.removeResponseHeaders = collectRemoveHeaderTags("removeRespHeadersTags");
    rule.action.setResponseHeaders = collectKvPairs("setRespHeadersEditor");
  } else if (actionType === "modifyBody") {
    rule.action.transforms = collectTransformRows("transformsEditor");
  }
  var v = validateRule(rule);
  if (!v.valid) { showEditorError(v.error); return; }
  saveState();
  renderRules();
  closeEditor();
}

var seenUrls = [];

function loadSeenUrls() {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
    var tabId = tabs && tabs[0] ? tabs[0].id : null;
    chrome.runtime.sendMessage({ type: "getSeenRequests", tabId: tabId }, function (res) {
      seenUrls = [];
      var seen = {};
      if (res && res.requests) {
        res.requests.forEach(function (r) {
          if (!seen[r.url]) { seen[r.url] = true; seenUrls.push({ url: r.url, method: r.method }); }
        });
      }
      rules.forEach(function (r) {
        var p = r.match.urlPattern;
        if (p && !seen[p]) { seen[p] = true; seenUrls.push({ url: p, method: "" }); }
      });
    });
  });
}

function showUrlDropdown(filter) {
  var dd = $("urlDropdown");
  if (!dd) return;
  dd.innerHTML = "";
  var items = seenUrls;
  if (filter) {
    var lower = filter.toLowerCase();
    items = items.filter(function (u) { return u.url.toLowerCase().indexOf(lower) !== -1; });
  }
  if (items.length === 0) { dd.classList.add("hidden"); return; }
  items.slice(0, 20).forEach(function (item) {
    var div = document.createElement("div");
    div.className = "autocomplete-item";
    div.innerHTML = (item.method ? '<span class="ac-method">' + escapeHtml(item.method) + '</span>' : '') + escapeHtml(item.url);
    div.addEventListener("mousedown", function (e) {
      e.preventDefault();
      $("editUrlPattern").value = item.url;
      dd.classList.add("hidden");
    });
    dd.appendChild(div);
  });
  dd.classList.remove("hidden");
}

function exportRules() {
  var blob = new Blob([JSON.stringify(rules, null, 2)], { type: "application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "request-mocker-rules.json";
  a.click();
}

function renderRuleItem(rule, counters, lastTime) {
  var actionLabel, statusColor = "";
  if (rule.action.type === "mockResponse") {
    actionLabel = "Mock " + rule.action.status;
    var s = rule.action.status;
    if (s >= 400) statusColor = "badge-error";
    else if (s >= 300) statusColor = "badge-redirect";
    else statusColor = "badge-success";
  } else if (rule.action.type === "modifyResponse") {
    actionLabel = "RespHdr";
  } else if (rule.action.type === "modifyBody") {
    actionLabel = "Body";
  } else {
    actionLabel = "ReqHdr";
  }
  var badgeClass = rule.action.type === "mockResponse" ? "badge-mock"
    : rule.action.type === "modifyResponse" ? "badge-modify-resp"
    : rule.action.type === "modifyBody" ? "badge-modify-body"
    : "badge-modify";
  var disabledClass = rule.enabled ? "" : " disabled";
  var hits = counters[rule.id] || 0;
  var hitClass = hits > 0 ? "has-hits" : "";
  var hitTitle = hits > 0 ? "Перехвачено: " + hits + " (последний: " + formatTime(lastTime[rule.id]) + ")" : "Нет перехватов";
  var html = '<div class="rule-item' + disabledClass + '" data-id="' + rule.id + '">';
  html += '<input type="checkbox" class="rule-toggle" data-id="' + rule.id + '"' + (rule.enabled ? " checked" : "") + '>';
  html += '<div class="rule-info">';
  html += '<div class="rule-name">' + escapeHtml(rule.name || "Без названия") + '</div>';
  html += '<div class="rule-detail">' + escapeHtml(rule.match.urlPattern) + " &middot; " + rule.match.method + '</div>';
  html += '</div>';
  html += '<span class="hit-counter ' + hitClass + '" title="' + hitTitle + '">' + hits + '</span>';
  html += '<span class="rule-badge ' + badgeClass + " " + statusColor + '">' + actionLabel + '</span>';
  html += '<div class="rule-actions">';
  html += '<button class="btn-edit" data-id="' + rule.id + '" title="Редактировать">&#9998;</button>';
  html += '<button class="btn-delete" data-id="' + rule.id + '" title="Удалить">&times;</button>';
  html += '</div></div>';
  return html;
}

document.addEventListener("mouseenter", function (e) {
  if (!e.target || typeof e.target.closest !== "function") return;
  var tip = e.target.closest(".help-tip");
  if (!tip) return;
  var text = tip.querySelector(".help-tip-text");
  if (!text) return;
  tip.classList.add("active");
  var box = tip.getBoundingClientRect();
  var tipW = text.offsetWidth;
  var left = box.left + box.width / 2 - tipW / 2;
  if (left < 4) left = 4;
  if (left + tipW > window.innerWidth - 4) left = window.innerWidth - tipW - 4;
  text.style.left = left + "px";
  var top = box.top - text.offsetHeight - 8;
  if (top < 4) top = box.bottom + 8;
  text.style.top = top + "px";
}, true);

document.addEventListener("mouseleave", function (e) {
  if (!e.target || typeof e.target.closest !== "function") return;
  var tip = e.target.closest(".help-tip");
  if (tip) tip.classList.remove("active");
}, true);
