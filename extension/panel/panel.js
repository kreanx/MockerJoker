var rules = [];
var masterEnabled = true;
var editingRuleId = null;

var ACTION_TYPES = {
  MOCK_RESPONSE: "mockResponse",
  MODIFY_REQUEST: "modifyRequest"
};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function createDefaultRule() {
  return {
    id: generateId(),
    name: "",
    enabled: true,
    match: { urlPattern: "", method: "ANY", resourceType: "" },
    action: {
      type: ACTION_TYPES.MOCK_RESPONSE,
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: "{}",
      delay: 0,
      removeHeaders: [],
      setHeaders: {}
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
  removeCookies: function (p) {
    return { id: generateId(), name: "Убрать Cookie", enabled: true,
      match: { urlPattern: p, method: "ANY", resourceType: "" },
      action: { type: ACTION_TYPES.MODIFY_REQUEST, removeHeaders: ["Cookie"], setHeaders: {} } };
  },
  noContent204: function (p) {
    return { id: generateId(), name: "204 No Content", enabled: true,
      match: { urlPattern: p, method: "ANY", resourceType: "" },
      action: { type: ACTION_TYPES.MOCK_RESPONSE, status: 204, headers: {}, body: "", delay: 0 } };
  }
};

var $ = function (id) { return document.getElementById(id); };

function init() {
  loadState();
  bindEvents();
}

function loadState() {
  chrome.storage.local.get({ rules: [], masterEnabled: true }, function (data) {
    rules = data.rules || [];
    masterEnabled = data.masterEnabled !== false;
    $("masterToggle").checked = masterEnabled;
    updateToggleStatus();
    renderRules();
  });
}

function saveState() {
  chrome.storage.local.set({ rules: rules, masterEnabled: masterEnabled });
  chrome.runtime.sendMessage({ type: "saveRules", rules: rules, masterEnabled: masterEnabled });
}

function updateToggleStatus() {
  var el = $("toggleStatus");
  if (masterEnabled) {
    el.textContent = "ВКЛ";
    el.className = "toggle-status on";
  } else {
    el.textContent = "ВЫКЛ";
    el.className = "toggle-status off";
  }
}

function renderRules() {
  var list = $("rulesList");
  if (rules.length === 0) {
    list.innerHTML = '<div class="empty-state">' +
      '<p class="empty-title">Правил пока нет</p>' +
      '<p>Выберите пресет слева или нажмите "Добавить правило"</p></div>';
    return;
  }
  chrome.runtime.sendMessage({ type: "getHitCounters" }, function (res) {
    var counters = (res && res.counters) || {};
    var lastTime = (res && res.lastHitTime) || {};
    var html = "";
    rules.forEach(function (rule) {
      var actionLabel, statusColor = "";
      if (rule.action.type === "mockResponse") {
        actionLabel = "Mock " + rule.action.status;
        var s = rule.action.status;
        if (s >= 400) statusColor = "badge-error";
        else if (s >= 300) statusColor = "badge-redirect";
        else statusColor = "badge-success";
      } else {
        actionLabel = "Modify";
      }
      var badgeClass = rule.action.type === "mockResponse" ? "badge-mock" : "badge-modify";
      var disabledClass = rule.enabled ? "" : " disabled";
      var hits = counters[rule.id] || 0;
      var hitClass = hits > 0 ? "has-hits" : "";
      var hitTitle = hits > 0 ? "Перехвачено: " + hits + " (последний: " + formatTime(lastTime[rule.id]) + ")" : "Нет перехватов";
      html += '<div class="rule-item' + disabledClass + '" data-id="' + rule.id + '">';
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
    });
    list.innerHTML = html;
  });
}

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

function bindEvents() {
  $("masterToggle").addEventListener("change", function () {
    masterEnabled = this.checked;
    updateToggleStatus();
    saveState();
  });

  $("btnAdd").addEventListener("click", function () { openEditor(null); });

  $("btnHelp").addEventListener("click", function () {
    $("helpModal").classList.remove("hidden");
  });
  $("btnCloseHelp").addEventListener("click", function () {
    $("helpModal").classList.add("hidden");
  });
  document.querySelector(".help-backdrop").addEventListener("click", function () {
    $("helpModal").classList.add("hidden");
  });

  document.querySelectorAll(".preset-card").forEach(function (card) {
    card.addEventListener("click", function () {
      var presetName = this.getAttribute("data-preset");
      var factory = presetFactories[presetName];
      if (factory) {
        var rule = factory("");
        rules.push(rule);
        saveState();
        renderRules();
        openEditor(rule.id);
      }
    });
  });

  $("rulesList").addEventListener("click", function (e) {
    var target = e.target;
    if (target.classList.contains("rule-toggle")) {
      toggleRule(target.getAttribute("data-id"), target.checked);
      return;
    }
    if (target.classList.contains("btn-edit")) {
      openEditor(target.getAttribute("data-id"));
      return;
    }
    if (target.classList.contains("btn-delete")) {
      deleteRuleById(target.getAttribute("data-id"));
      return;
    }
  });

  $("btnCloseEditor").addEventListener("click", closeEditor);
  $("btnCancel").addEventListener("click", closeEditor);
  $("btnSave").addEventListener("click", saveEditor);

  $("editActionType").addEventListener("change", function () {
    toggleActionFields(this.value);
  });

  $("btnAddHeader").addEventListener("click", function () { addKvRow("headersEditor", "", ""); });
  $("btnAddSetHeader").addEventListener("click", function () { addKvRow("setHeadersEditor", "", ""); });

  $("btnFormatBody").addEventListener("click", function () {
    var body = $("editBody").value.trim();
    if (!body) return;
    try {
      $("editBody").value = JSON.stringify(JSON.parse(body), null, 2);
    } catch (e) { alert("Невалидный JSON: " + e.message); }
  });

  $("inputRemoveHeader").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      var val = this.value.trim();
      if (val) { addRemoveHeaderTag(val); this.value = ""; }
    }
  });

  $("btnExport").addEventListener("click", exportRules);
  $("btnImport").addEventListener("click", function () { $("importFile").click(); });
  $("importFile").addEventListener("change", importRules);
}

function toggleRule(id, enabled) {
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].id === id) { rules[i].enabled = enabled; break; }
  }
  saveState();
  renderRules();
}

function deleteRuleById(id) {
  var rule = findRuleById(rules, id);
  if (!confirm("Удалить правило \"" + (rule ? rule.name || "Без названия" : "") + "\"?")) return;
  rules = rules.filter(function (r) { return r.id !== id; });
  saveState();
  renderRules();
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
  toggleActionFields(rule.action.type);
  updateUrlDatalist();
  $("editor").classList.remove("hidden");
  $("editUrlPattern").focus();
}

function updateUrlDatalist() {
  chrome.runtime.sendMessage({ type: "getSeenRequests" }, function (res) {
    var dl = $("urlSuggestions");
    if (!dl) return;
    var items = {};
    dl.innerHTML = "";
    if (res && res.requests) {
      res.requests.forEach(function (r) {
        if (!items[r.url]) {
          items[r.url] = true;
          var opt = document.createElement("option");
          opt.value = r.url;
          opt.label = r.method;
          dl.appendChild(opt);
        }
      });
    }
    rules.forEach(function (r) {
      var p = r.match.urlPattern;
      if (p && !items[p]) {
        items[p] = true;
        var opt = document.createElement("option");
        opt.value = p;
        dl.appendChild(opt);
      }
    });
  });
}

function closeEditor() { $("editor").classList.add("hidden"); editingRuleId = null; }

function saveEditor() {
  var actionType = $("editActionType").value;
  var rule = editingRuleId ? findRuleById(rules, editingRuleId) : createDefaultRule();
  if (!editingRuleId) rules.push(rule);
  rule.name = $("editName").value || "Без названия";
  rule.match.urlPattern = $("editUrlPattern").value;
  rule.match.method = $("editMethod").value;
  rule.action.type = actionType;
  if (actionType === "mockResponse") {
    rule.action.status = parseInt($("editStatus").value, 10) || 200;
    rule.action.headers = collectKvPairs("headersEditor");
    rule.action.body = $("editBody").value;
    rule.action.delay = parseInt($("editDelay").value, 10) || 0;
  } else {
    rule.action.removeHeaders = collectRemoveHeaderTags();
    rule.action.setHeaders = collectKvPairs("setHeadersEditor");
  }
  var v = validateRule(rule);
  if (!v.valid) { alert("Ошибка: " + v.error); return; }
  saveState();
  renderRules();
  closeEditor();
}

function toggleActionFields(type) {
  $("mockResponseFields").classList.toggle("hidden", type !== "mockResponse");
  $("modifyRequestFields").classList.toggle("hidden", type !== "modifyRequest");
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

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

function addRemoveHeaderTag(header) {
  var tag = document.createElement("span");
  tag.className = "tag";
  tag.setAttribute("data-header", header);
  tag.innerHTML = escapeHtml(header) + '<button type="button">&times;</button>';
  tag.querySelector("button").addEventListener("click", function () { tag.remove(); });
  $("removeHeadersTags").appendChild(tag);
}

function collectRemoveHeaderTags() {
  var result = [];
  $("removeHeadersTags").querySelectorAll(".tag").forEach(function (tag) {
    var h = tag.getAttribute("data-header");
    if (h) result.push(h);
  });
  return result;
}

function exportRules() {
  var blob = new Blob([JSON.stringify(rules, null, 2)], { type: "application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "request-mocker-rules.json";
  a.click();
}

function importRules() {
  var file = $("importFile").files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      var imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error("Ожидается массив");
      rules = imported;
      saveState();
      renderRules();
    } catch (err) { alert("Ошибка импорта: " + err.message); }
  };
  reader.readAsText(file);
  $("importFile").value = "";
}

document.addEventListener("DOMContentLoaded", init);
