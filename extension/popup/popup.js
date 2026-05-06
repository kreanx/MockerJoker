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
  error500: function (urlPattern) {
    return {
      id: generateId(), name: "500 Internal Server Error", enabled: true,
      match: { urlPattern: urlPattern, method: "ANY", resourceType: "" },
      action: {
        type: ACTION_TYPES.MOCK_RESPONSE, status: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Internal Server Error", code: 500, message: "Something went wrong" })
      }
    };
  },
  forbidden403: function (urlPattern) {
    return {
      id: generateId(), name: "403 Forbidden", enabled: true,
      match: { urlPattern: urlPattern, method: "ANY", resourceType: "" },
      action: {
        type: ACTION_TYPES.MOCK_RESPONSE, status: 403,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Forbidden", code: 403, message: "Access denied" })
      }
    };
  },
  partialData: function (urlPattern) {
    return {
      id: generateId(), name: "Частичные данные", enabled: true,
      match: { urlPattern: urlPattern, method: "GET", resourceType: "" },
      action: {
        type: ACTION_TYPES.MOCK_RESPONSE, status: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: 1, name: "John Doe" }, null, 2) +
          "\n\n// Удалите поля для теста: email, phone, address и т.д."
      }
    };
  },
  removeAuth: function (urlPattern) {
    return {
      id: generateId(), name: "Убрать Authorization", enabled: true,
      match: { urlPattern: urlPattern, method: "ANY", resourceType: "" },
      action: { type: ACTION_TYPES.MODIFY_REQUEST, removeHeaders: ["Authorization"], setHeaders: {} }
    };
  },
  mock401: function (urlPattern) {
    return {
      id: generateId(), name: "401 Unauthorized", enabled: true,
      match: { urlPattern: urlPattern, method: "ANY", resourceType: "" },
      action: {
        type: ACTION_TYPES.MOCK_RESPONSE, status: 401,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Unauthorized", code: 401, message: "Invalid or missing token" })
      }
    };
  },
  removeCookies: function (urlPattern) {
    return {
      id: generateId(), name: "Убрать Cookie", enabled: true,
      match: { urlPattern: urlPattern, method: "ANY", resourceType: "" },
      action: { type: ACTION_TYPES.MODIFY_REQUEST, removeHeaders: ["Cookie"], setHeaders: {} }
    };
  },
  noContent204: function (urlPattern) {
    return {
      id: generateId(), name: "204 No Content", enabled: true,
      match: { urlPattern: urlPattern, method: "ANY", resourceType: "" },
      action: {
        type: ACTION_TYPES.MOCK_RESPONSE, status: 204,
        headers: {},
        body: "",
        delay: 0
      }
    };
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
    renderRules();
  });
}

function saveState() {
  chrome.storage.local.set({ rules: rules, masterEnabled: masterEnabled });
  chrome.runtime.sendMessage({
    type: "saveRules",
    rules: rules,
    masterEnabled: masterEnabled
  });
}

function renderRules() {
  var list = $("rulesList");
  if (rules.length === 0) {
    list.innerHTML = '<div class="empty-state">' +
      '<p class="empty-title">Правил нет</p>' +
      '<p>Нажмите <b>+ Добавить</b> или выберите <b>Пресет</b></p></div>';
    return;
  }
  chrome.runtime.sendMessage({ type: "getHitCounters" }, function (res) {
    var counters = (res && res.counters) || {};
    var lastTime = (res && res.lastHitTime) || {};
    var html = "";
    rules.forEach(function (rule) {
      var actionLabel = rule.action.type === "mockResponse"
        ? "Mock " + rule.action.status
        : "Modify";
      var badgeClass = rule.action.type === "mockResponse" ? "badge-mock" : "badge-modify";
      var statusColor = "";
      if (rule.action.type === "mockResponse") {
        var s = rule.action.status;
        if (s >= 400) statusColor = "badge-error";
        else if (s >= 300) statusColor = "badge-redirect";
        else statusColor = "badge-success";
      }
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
      html += '</div>';
      html += '</div>';
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
    saveState();
  });

  $("btnOpenTab").addEventListener("click", function () {
    chrome.runtime.sendMessage({ type: "openPanel" });
  });

  $("btnHelp").addEventListener("click", function () {
    $("helpOverlay").classList.remove("hidden");
  });
  $("btnCloseHelp").addEventListener("click", function () {
    $("helpOverlay").classList.add("hidden");
  });
  $("helpOverlay").addEventListener("click", function (e) {
    if (e.target === $("helpOverlay")) $("helpOverlay").classList.add("hidden");
  });

  $("btnAdd").addEventListener("click", function () {
    openEditor(null);
  });

  $("btnPresets").addEventListener("click", function (e) {
    e.stopPropagation();
    $("presetsMenu").classList.toggle("hidden");
  });

  document.addEventListener("click", function () {
    $("presetsMenu").classList.add("hidden");
  });

  $("presetsMenu").addEventListener("click", function (e) {
    if (!e.target.classList.contains("preset-btn")) return;
    var presetName = e.target.getAttribute("data-preset");
    $("presetsMenu").classList.add("hidden");
    var factory = presetFactories[presetName];
    if (factory) {
      var rule = factory("");
      rules.push(rule);
      saveState();
      renderRules();
      openEditor(rule.id);
    }
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

  $("btnAddHeader").addEventListener("click", function () {
    addKvRow("headersEditor", "", "");
  });

  $("btnAddSetHeader").addEventListener("click", function () {
    addKvRow("setHeadersEditor", "", "");
  });

  $("btnFormatBody").addEventListener("click", function () {
    var body = $("editBody").value.trim();
    if (!body) return;
    try {
      var parsed = JSON.parse(body);
      $("editBody").value = JSON.stringify(parsed, null, 2);
    } catch (e) {
      alert("Невалидный JSON: " + e.message);
    }
  });

  $("inputRemoveHeader").addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      var val = this.value.trim();
      if (val) {
        addRemoveHeaderTag(val);
        this.value = "";
      }
    }
  });

  $("btnExport").addEventListener("click", function () {
    chrome.runtime.sendMessage({ type: "openPanel" });
  });
  $("btnImport").addEventListener("click", function () {
    chrome.runtime.sendMessage({ type: "openPanel" });
  });
  $("importFile").addEventListener("change", importRules);
}

function toggleRule(id, enabled) {
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].id === id) {
      rules[i].enabled = enabled;
      break;
    }
  }
  saveState();
  renderRules();
}

function deleteRuleById(id) {
  var rule = findRuleById(rules, id);
  var name = rule ? (rule.name || "Без названия") : "правило";
  if (!confirm("Удалить правило \"" + name + "\"?")) return;
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
    Object.keys(rule.action.headers).forEach(function (k) {
      addKvRow("headersEditor", k, rule.action.headers[k]);
    });
  }

  $("setHeadersEditor").innerHTML = "";
  if (rule.action.setHeaders) {
    Object.keys(rule.action.setHeaders).forEach(function (k) {
      addKvRow("setHeadersEditor", k, rule.action.setHeaders[k]);
    });
  }

  $("removeHeadersTags").innerHTML = "";
  if (rule.action.removeHeaders) {
    rule.action.removeHeaders.forEach(function (h) {
      addRemoveHeaderTag(h);
    });
  }

  toggleActionFields(rule.action.type);
  updateUrlDatalist();
  $("editor").classList.remove("hidden");
}

function updateUrlDatalist() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    var tabId = tabs && tabs[0] ? tabs[0].id : null;
    chrome.runtime.sendMessage({ type: "getSeenRequests", tabId: tabId }, function (res) {
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
  });
}

function closeEditor() {
  $("editor").classList.add("hidden");
  editingRuleId = null;
}

function saveEditor() {
  var actionType = $("editActionType").value;
  var rule = editingRuleId ? findRuleById(rules, editingRuleId) : createDefaultRule();

  if (!editingRuleId) {
    rules.push(rule);
  }

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

  var validation = validateRule(rule);
  if (!validation.valid) {
    alert("Ошибка: " + validation.error);
    return;
  }

  saveState();
  renderRules();
  closeEditor();
}

function toggleActionFields(type) {
  if (type === "mockResponse") {
    $("mockResponseFields").classList.remove("hidden");
    $("modifyRequestFields").classList.add("hidden");
  } else {
    $("mockResponseFields").classList.add("hidden");
    $("modifyRequestFields").classList.remove("hidden");
  }
}

function addKvRow(containerId, key, value) {
  var container = $(containerId);
  var row = document.createElement("div");
  row.className = "kv-row";
  row.innerHTML = '<input type="text" class="kv-key" placeholder="Ключ" value="' + escapeAttr(key || "") + '">' +
    '<input type="text" class="kv-value" placeholder="Значение" value="' + escapeAttr(value || "") + '">' +
    '<button type="button" class="kv-remove">&times;</button>';
  row.querySelector(".kv-remove").addEventListener("click", function () {
    row.remove();
  });
  container.appendChild(row);
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function collectKvPairs(containerId) {
  var result = {};
  var rows = $(containerId).querySelectorAll(".kv-row");
  rows.forEach(function (row) {
    var key = row.querySelector(".kv-key").value.trim();
    var value = row.querySelector(".kv-value").value.trim();
    if (key) result[key] = value;
  });
  return result;
}

function addRemoveHeaderTag(header) {
  var tags = $("removeHeadersTags");
  var tag = document.createElement("span");
  tag.className = "tag";
  tag.setAttribute("data-header", header);
  tag.innerHTML = escapeHtml(header) + '<button type="button">&times;</button>';
  tag.querySelector("button").addEventListener("click", function () {
    tag.remove();
  });
  tags.appendChild(tag);
}

function collectRemoveHeaderTags() {
  var tags = $("removeHeadersTags").querySelectorAll(".tag");
  var result = [];
  tags.forEach(function (tag) {
    var h = tag.getAttribute("data-header");
    if (h) result.push(h);
  });
  return result;
}

function exportRules() {
  var blob = new Blob([JSON.stringify(rules, null, 2)], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "request-mocker-rules.json";
  a.click();
  URL.revokeObjectURL(url);
}

function importRules() {
  var file = $("importFile").files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      var imported = JSON.parse(e.target.result);
      if (!Array.isArray(imported)) throw new Error("Ожидается массив");
      var invalid = imported.some(function (r) {
        return !validateRule(r).valid;
      });
      if (invalid) throw new Error("Некоторые правила невалидны");
      rules = imported;
      saveState();
      renderRules();
    } catch (err) {
      alert("Ошибка импорта: " + err.message);
    }
  };
  reader.readAsText(file);
  $("importFile").value = "";
}

document.addEventListener("DOMContentLoaded", init);
