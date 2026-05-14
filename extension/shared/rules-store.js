var ACTION_TYPES = CONST.ACTION_TYPES;

function createDefaultRule() {
  return {
    id: generateId(),
    name: "",
    enabled: true,
    match: { urlPattern: "", method: "ANY", resourceType: "", bodyConditions: [], graphqlOperation: "", graphqlUrl: "", varConditions: [] },
    action: {
      type: ACTION_TYPES.MOCK_RESPONSE,
      status: CONST.DEFAULT_STATUS,
      headers: { "Content-Type": "application/json" },
      body: CONST.DEFAULT_BODY,
      delay: CONST.DEFAULT_DELAY,
      removeHeaders: [],
      setHeaders: {},
      removeResponseHeaders: [],
      setResponseHeaders: {},
      transforms: [],
      method: "",
      removeQueryParams: [],
      setQueryParams: {},
      saveVars: []
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
      action: { type: ACTION_TYPES.MOCK_RESPONSE, status: CONST.DEFAULT_STATUS,
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
    return { id: generateId(), name: "Заменить значение в ответе", enabled: true,
      match: { urlPattern: p, method: "ANY", resourceType: "", bodyConditions: [], graphqlOperation: "" },
      action: { type: ACTION_TYPES.MODIFY_RESPONSE,
        removeResponseHeaders: [],
        setResponseHeaders: {},
        transforms: [
          { path: "id", value: "999" }
        ] } };
  },
  graphqlMock: function (p) {
    return { id: generateId(), name: "GraphQL Mock", enabled: true,
      match: { urlPattern: p || "*graphql*", method: CONST.METHOD_POST, resourceType: "", bodyConditions: [], graphqlOperation: "*" },
      action: { type: ACTION_TYPES.MOCK_RESPONSE, status: CONST.GRAPHQL_STATUS,
        headers: { "Content-Type": "application/json" },
        body: '{"data": {}}' } };
  },
};

function saveState() {
  chrome.storage.local.set({ rules: rules, masterEnabled: masterEnabled });
  chrome.runtime.sendMessage({ type: CONST.MSG_SAVE_RULES, rules: rules, masterEnabled: masterEnabled });
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
      var invalid = imported.some(function (r) { return !validateRule(r).valid; });
      if (invalid) throw new Error("Некоторые правила невалидны");
      rules = imported;
      saveState();
      renderRules();
    } catch (err) { alert("Ошибка импорта: " + err.message); }
  };
  reader.readAsText(file);
  $("importFile").value = "";
}

function renderRuleItem(rule, counters, lastTime) {
  var actionLabel, statusColor = "";
  if (rule.action.type === ACTION_TYPES.MOCK_RESPONSE) {
    actionLabel = "Mock " + rule.action.status;
    var s = rule.action.status;
    if (s >= 400) statusColor = "badge-error";
    else if (s >= 300) statusColor = "badge-redirect";
    else statusColor = "badge-success";
  } else if (rule.action.type === ACTION_TYPES.MODIFY_RESPONSE) {
    actionLabel = "ModResp";
  } else if (rule.action.type === ACTION_TYPES.MODIFY_BODY || rule.action.type === ACTION_TYPES.MODIFY_REQUEST) {
    actionLabel = "ModReq";
  }
  var badgeClass = rule.action.type === ACTION_TYPES.MOCK_RESPONSE ? "badge-mock"
    : rule.action.type === ACTION_TYPES.MODIFY_RESPONSE ? "badge-modify-resp"
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
