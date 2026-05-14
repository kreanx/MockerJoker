var ACTION_TYPES = CONST.ACTION_TYPES;

function addKvRow(containerId, key, value) {
  var row = document.createElement("div");
  row.className = "kv-row";
  row.innerHTML = '<input type="text" class="kv-key" placeholder="Ключ" value="' + escapeAttr(key || "") + '">' +
    '<input type="text" class="kv-value" placeholder="Значение или $varName" value="' + escapeAttr(value || "") + '">' +
    '<button type="button" class="kv-remove">&times;</button>';
  row.querySelector(".kv-remove").addEventListener("click", function () { row.remove(); });
  var valInput = row.querySelector(".kv-value");
  valInput.addEventListener("input", function () { showVarDropdown(this); });
  valInput.addEventListener("blur", function () { hideVarDropdown(this); });
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
    '<input type="text" class="bc-value" placeholder="Значение или $var" value="' + escapeAttr(cond.value || "") + '">' +
    '<button type="button" class="bc-remove">&times;</button>';
  row.querySelector(".bc-op").addEventListener("change", function () {
    row.querySelector(".bc-value").style.display = this.value === "exists" ? "none" : "";
  });
  if (cond.operator === "exists") row.querySelector(".bc-value").style.display = "none";
  row.querySelector(".bc-remove").addEventListener("click", function () { row.remove(); });
  var bcValInput = row.querySelector(".bc-value");
  bcValInput.addEventListener("input", function () { showVarDropdown(this); });
  bcValInput.addEventListener("blur", function () { hideVarDropdown(this); });
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

function getVarNames() {
  var names = [];
  if (typeof varSavers !== "undefined" && varSavers) {
    varSavers.forEach(function (vs) {
      if (vs.varName && vs.enabled) names.push(vs.varName);
    });
  }
  return names;
}

function showVarDropdown(input) {
  var existing = input.parentElement.querySelector(".var-dropdown");
  if (existing) existing.remove();
  var val = input.value;
  var dollarPos = val.lastIndexOf("$");
  if (dollarPos === -1) return;
  var partial = val.substring(dollarPos);
  var names = getVarNames();
  var matches = names.filter(function (n) { return n.indexOf(partial) === 0; });
  if (matches.length === 0) return;
  if (matches.length === 1 && matches[0] === partial) return;
  var dd = document.createElement("div");
  dd.className = "var-dropdown";
  matches.forEach(function (name) {
    var item = document.createElement("div");
    item.className = "var-dropdown-item";
    item.textContent = name;
    item.addEventListener("mousedown", function (e) {
      e.preventDefault();
      input.value = val.substring(0, dollarPos) + name;
      dd.remove();
    });
    dd.appendChild(item);
  });
  input.parentElement.style.position = "relative";
  input.parentElement.appendChild(dd);
}

function hideVarDropdown(input) {
  var dd = input.parentElement.querySelector(".var-dropdown");
  if (dd) dd.remove();
}

function addTransformRow(containerId, t) {
  var row = document.createElement("div");
  row.className = "kv-row";
  row.innerHTML = '<input type="text" class="kv-key" placeholder="items[0].name" value="' + escapeAttr(t.path || "") + '">' +
    '<input type="text" class="kv-value" placeholder="Новое значение или $varName" value="' + escapeAttr(t.value || "") + '">' +
    '<button type="button" class="kv-remove">&times;</button>';
  row.querySelector(".kv-remove").addEventListener("click", function () { row.remove(); });
  var valInput = row.querySelector(".kv-value");
  valInput.addEventListener("input", function () { showVarDropdown(this); });
  valInput.addEventListener("blur", function () { hideVarDropdown(this); });
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

function addSaveVarRow(containerId, sv) {
  var varVal = (sv.var || "").replace(/^\$/, "");
  var row = document.createElement("div");
  row.className = "sv-row";
  row.innerHTML = '<select class="sv-source">' +
    '<option value="body"' + (sv.source === "body" ? " selected" : "") + '>Body</option>' +
    '<option value="header"' + (sv.source === "header" ? " selected" : "") + '>Header</option>' +
    '<option value="status"' + (sv.source === "status" ? " selected" : "") + '>Status</option>' +
    '</select>' +
    '<input type="text" class="sv-path" placeholder="data.user.id" value="' + escapeAttr(sv.path || "") + '">' +
    '<div class="sv-var-wrap"><span class="sv-var-prefix">$</span><input type="text" class="sv-var" placeholder="varName" value="' + escapeAttr(varVal) + '"></div>' +
    '<button type="button" class="sv-remove">&times;</button>';
  var pathInput = row.querySelector(".sv-path");
  var sourceSelect = row.querySelector(".sv-source");
  sourceSelect.addEventListener("change", function () {
    pathInput.style.display = this.value === "status" ? "none" : "";
  });
  if (sv.source === "status") pathInput.style.display = "none";
  row.querySelector(".sv-remove").addEventListener("click", function () { row.remove(); });
  $(containerId).appendChild(row);
}

function collectSaveVars(containerId) {
  var result = [];
  $(containerId).querySelectorAll(".sv-row").forEach(function (row) {
    var source = row.querySelector(".sv-source").value;
    var path = row.querySelector(".sv-path").value.trim();
    var v = row.querySelector(".sv-var").value.trim();
    if (v) result.push({ source: source, path: path, var: "$" + v });
  });
  return result;
}

function showVarDropdownSimple(input) {
  var existing = input.closest(".vc-var-wrap, .sv-var-wrap, .kv-row, .vs-var-name-wrap");
  if (existing) {
    var old = existing.querySelector(".var-dropdown");
    if (old) old.remove();
  }
  var names = getVarNames();
  if (names.length === 0) return;
  var partial = input.value.replace(/^\$/, "");
  var matches = names.filter(function (n) { return n.replace(/^\$/, "").indexOf(partial) === 0; });
  if (matches.length === 0) return;
  var dd = document.createElement("div");
  dd.className = "var-dropdown";
  matches.forEach(function (name) {
    var item = document.createElement("div");
    item.className = "var-dropdown-item";
    item.textContent = name;
    item.addEventListener("mousedown", function (e) {
      e.preventDefault();
      input.value = name.replace(/^\$/, "");
      dd.remove();
    });
    dd.appendChild(item);
  });
  var wrap = input.closest(".vc-var-wrap, .sv-var-wrap, .vs-var-name-wrap");
  if (wrap) {
    wrap.style.position = "relative";
    wrap.appendChild(dd);
  }
}

function addVarConditionRow(containerId, vc) {
  var varVal = (vc.var || "").replace(/^\$/, "");
  var row = document.createElement("div");
  row.className = "vc-row";
  row.innerHTML = '<div class="vc-var-wrap"><span class="vc-var-prefix">$</span><input type="text" class="vc-var" placeholder="varName" value="' + escapeAttr(varVal) + '"></div>' +
    '<select class="vc-op">' +
    '<option value="equals"' + (vc.operator === "equals" ? " selected" : "") + '>равно</option>' +
    '<option value="notEquals"' + (vc.operator === "notEquals" ? " selected" : "") + '>не равно</option>' +
    '<option value="contains"' + (vc.operator === "contains" ? " selected" : "") + '>содержит</option>' +
    '<option value="exists"' + (vc.operator === "exists" ? " selected" : "") + '>существует</option>' +
    '</select>' +
    '<input type="text" class="vc-value" placeholder="Значение" value="' + escapeAttr(vc.value || "") + '">' +
    '<button type="button" class="vc-remove">&times;</button>';
  row.querySelector(".vc-op").addEventListener("change", function () {
    row.querySelector(".vc-value").style.display = this.value === "exists" ? "none" : "";
  });
  if (vc.operator === "exists") row.querySelector(".vc-value").style.display = "none";
  row.querySelector(".vc-remove").addEventListener("click", function () { row.remove(); });
  var vcVarInput = row.querySelector(".vc-var");
  vcVarInput.addEventListener("focus", function () { showVarDropdownSimple(this); });
  vcVarInput.addEventListener("input", function () { showVarDropdownSimple(this); });
  vcVarInput.addEventListener("blur", function () { var dd = this.closest(".vc-var-wrap"); if (dd) { var d = dd.querySelector(".var-dropdown"); if (d) d.remove(); } });
  var vcValInput = row.querySelector(".vc-value");
  vcValInput.addEventListener("input", function () { showVarDropdown(this); });
  vcValInput.addEventListener("blur", function () { hideVarDropdown(this); });
  $(containerId).appendChild(row);
}

function collectVarConditions(containerId) {
  var result = [];
  $(containerId).querySelectorAll(".vc-row").forEach(function (row) {
    var v = row.querySelector(".vc-var").value.trim();
    var op = row.querySelector(".vc-op").value;
    var val = row.querySelector(".vc-value").value.trim();
    if (v) result.push({ var: "$" + v, operator: op, value: val });
  });
  return result;
}

function toggleActionFields(type) {
  $("mockResponseFields").classList.toggle("hidden", type !== ACTION_TYPES.MOCK_RESPONSE);
  $("modifyRequestFields").classList.toggle("hidden", type !== ACTION_TYPES.MODIFY_REQUEST && type !== ACTION_TYPES.MODIFY_BODY);
  $("modifyResponseFields").classList.toggle("hidden", type !== ACTION_TYPES.MODIFY_RESPONSE);
  var mbFields = $("modifyBodyFields");
  if (mbFields) mbFields.classList.add("hidden");
  updateGraphqlStatusHint();
}

function switchProtoTab(tab) {
  var tabRest = $("tabRest");
  var tabGraphql = $("tabGraphql");
  var restFields = $("restFields");
  var graphqlFields = $("graphqlFields");
  if (!tabRest || !tabGraphql || !restFields || !graphqlFields) return;

  if (tab === "graphql") {
    tabRest.classList.remove("active");
    tabGraphql.classList.add("active");
    restFields.classList.add("hidden");
    graphqlFields.classList.remove("hidden");
    var methodEl = $("editMethod");
    if (methodEl && methodEl.value === "ANY") methodEl.value = "POST";
    var statusEl = $("editStatus");
    if (statusEl) statusEl.value = CONST.GRAPHQL_STATUS;
  } else {
    tabGraphql.classList.remove("active");
    tabRest.classList.add("active");
    graphqlFields.classList.add("hidden");
    restFields.classList.remove("hidden");
  }
  updateGraphqlStatusHint();
}

function updateGraphqlStatusHint() {
  var hint = $("graphqlStatusHint");
  var statusInput = $("editStatus");
  if (!hint || !statusInput) return;
  var isGraphql = $("tabGraphql") && $("tabGraphql").classList.contains("active");
  var isMock = $("editActionType") && $("editActionType").value === ACTION_TYPES.MOCK_RESPONSE;
  if (isGraphql && isMock) {
    hint.classList.remove("hidden");
    statusInput.disabled = true;
    statusInput.value = CONST.GRAPHQL_STATUS;
  } else {
    hint.classList.add("hidden");
    statusInput.disabled = false;
  }
}

function isGraphqlTabActive() {
  var tabGraphql = $("tabGraphql");
  return tabGraphql && tabGraphql.classList.contains("active");
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

function openEditor(ruleId) {
  editingRuleId = ruleId;
  var rule = ruleId ? findRuleById(rules, ruleId) : createDefaultRule();
  $("editorTitle").textContent = ruleId ? "Редактирование" : "Новое правило";
  $("editName").value = rule.name;
  $("editUrlPattern").value = rule.match.urlPattern;
  $("editMethod").value = rule.match.method || "ANY";
  $("editActionType").value = rule.action.type === ACTION_TYPES.MODIFY_BODY ? ACTION_TYPES.MODIFY_REQUEST : rule.action.type;
  $("editStatus").value = rule.action.status || CONST.DEFAULT_STATUS;
  $("editDelay").value = rule.action.delay || CONST.DEFAULT_DELAY;
  $("editBody").value = rule.action.body || CONST.DEFAULT_BODY;

  var graphqlEl = $("editGraphqlOperation");
  if (graphqlEl) graphqlEl.value = rule.match.graphqlOperation || "";

  var graphqlUrlEl = $("editGraphqlUrl");
  if (graphqlUrlEl) graphqlUrlEl.value = rule.match.graphqlUrl || rule.match.urlPattern || "";

  var hasGraphql = !!(rule.match.graphqlOperation || rule.match.graphqlUrl);
  if (hasGraphql && $("tabGraphql")) {
    switchProtoTab("graphql");
  } else if ($("tabRest")) {
    switchProtoTab("rest");
  }

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
  if (rule.action.transforms && (rule.action.type === ACTION_TYPES.MODIFY_BODY || rule.action.type === ACTION_TYPES.MODIFY_REQUEST)) {
    rule.action.transforms.forEach(function (t) { addTransformRow("transformsEditor", t); });
  }

  var respTransEl = $("respTransformsEditor");
  if (respTransEl) {
    respTransEl.innerHTML = "";
    if (rule.action.transforms) {
      rule.action.transforms.forEach(function (t) { addTransformRow("respTransformsEditor", t); });
    }
  }

  var methodEl = $("editRequestMethod");
  if (methodEl) methodEl.value = rule.action.method || "";

  var removeParamsEl = $("removeQueryParamsTags");
  if (removeParamsEl) {
    removeParamsEl.innerHTML = "";
    if (rule.action.removeQueryParams) {
      rule.action.removeQueryParams.forEach(function (p) { addRemoveHeaderTag(p, "removeQueryParamsTags"); });
    }
  }
  var setParamsEl = $("setQueryParamsEditor");
  if (setParamsEl) {
    setParamsEl.innerHTML = "";
    if (rule.action.setQueryParams) {
      Object.keys(rule.action.setQueryParams).forEach(function (k) { addKvRow("setQueryParamsEditor", k, rule.action.setQueryParams[k]); });
    }
  }

  toggleActionFields(rule.action.type);
  updateGraphqlStatusHint();

  var varCondEl = $("varConditionsEditor");
  if (varCondEl) {
    varCondEl.innerHTML = "";
    if (rule.match.varConditions) {
      rule.match.varConditions.forEach(function (vc) { addVarConditionRow("varConditionsEditor", vc); });
    }
  }

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

  var graphqlActive = isGraphqlTabActive();
  if (graphqlActive) {
    var graphqlUrlEl = $("editGraphqlUrl");
    rule.match.urlPattern = graphqlUrlEl ? graphqlUrlEl.value : $("editUrlPattern").value;
  } else {
    rule.match.urlPattern = $("editUrlPattern").value;
  }
  rule.match.method = $("editMethod").value;
  rule.match.bodyConditions = collectBodyConditions("bodyConditionsEditor");
  var varCondEl = $("varConditionsEditor");
  if (varCondEl) rule.match.varConditions = collectVarConditions("varConditionsEditor");
  var graphqlEl = $("editGraphqlOperation");
  if (graphqlActive && graphqlEl) {
    rule.match.graphqlOperation = graphqlEl.value.trim();
    var gUrlEl = $("editGraphqlUrl");
    rule.match.graphqlUrl = gUrlEl ? gUrlEl.value : "";
  } else {
    rule.match.graphqlOperation = "";
    rule.match.graphqlUrl = "";
  }
  rule.action.type = actionType;
  if (actionType === ACTION_TYPES.MOCK_RESPONSE) {
    rule.action.status = parseInt($("editStatus").value, 10) || CONST.DEFAULT_STATUS;
    rule.action.headers = collectKvPairs("headersEditor");
    rule.action.body = $("editBody").value;
    rule.action.delay = parseInt($("editDelay").value, 10) || CONST.DEFAULT_DELAY;
  } else if (actionType === ACTION_TYPES.MODIFY_REQUEST) {
    rule.action.removeHeaders = collectRemoveHeaderTags();
    rule.action.setHeaders = collectKvPairs("setHeadersEditor");
    rule.action.transforms = collectTransformRows("transformsEditor");
    var methodEl = $("editRequestMethod");
    if (methodEl) rule.action.method = methodEl.value;
    var removeParamsEl = $("removeQueryParamsTags");
    if (removeParamsEl) rule.action.removeQueryParams = collectRemoveHeaderTags("removeQueryParamsTags");
    var setParamsEl = $("setQueryParamsEditor");
    if (setParamsEl) rule.action.setQueryParams = collectKvPairs("setQueryParamsEditor");
  } else if (actionType === ACTION_TYPES.MODIFY_RESPONSE) {
    rule.action.removeResponseHeaders = collectRemoveHeaderTags("removeRespHeadersTags");
    rule.action.setResponseHeaders = collectKvPairs("setRespHeadersEditor");
    rule.action.transforms = $("respTransformsEditor") ? collectTransformRows("respTransformsEditor") : [];
  }
  var v = validateRule(rule);
  if (!v.valid) { showEditorError(v.error); return; }
  saveState();
  renderRules();
  closeEditor();
}

function bindEditorEvents() {
  $("btnCloseEditor").addEventListener("click", closeEditor);
  $("btnCancel").addEventListener("click", closeEditor);
  $("btnSave").addEventListener("click", saveEditor);

  $("editUrlPattern").addEventListener("input", function () { showUrlDropdown(this.value); });
  $("editUrlPattern").addEventListener("focus", function () { showUrlDropdown(this.value); });
  $("editUrlPattern").addEventListener("blur", function () { $("urlDropdown").classList.add("hidden"); });
  $("editActionType").addEventListener("change", function () { toggleActionFields(this.value); });

  $("tabRest").addEventListener("click", function () { switchProtoTab("rest"); });
  $("tabGraphql").addEventListener("click", function () { switchProtoTab("graphql"); });

  var graphqlUrlEl = $("editGraphqlUrl");
  if (graphqlUrlEl) {
    graphqlUrlEl.addEventListener("input", function () { showGraphqlUrlDropdown(this.value); });
    graphqlUrlEl.addEventListener("focus", function () { showGraphqlUrlDropdown(this.value); });
    graphqlUrlEl.addEventListener("blur", function () { var dd = $("graphqlUrlDropdown"); if (dd) dd.classList.add("hidden"); });
  }

  $("btnAddHeader").addEventListener("click", function () { addKvRow("headersEditor", "", ""); });
  $("btnAddSetHeader").addEventListener("click", function () { addKvRow("setHeadersEditor", "", ""); });
  $("btnAddSetRespHeader").addEventListener("click", function () { addKvRow("setRespHeadersEditor", "", ""); });
  $("btnAddRespTransform").addEventListener("click", function () { addTransformRow("respTransformsEditor", { path: "", value: "" }); });

  $("btnAddBc").addEventListener("click", function () { addBodyConditionRow("bodyConditionsEditor", { path: "", operator: "equals", value: "" }); });
  $("btnAddVc").addEventListener("click", function () { addVarConditionRow("varConditionsEditor", { var: "", operator: "equals", value: "" }); });
  $("btnAddTransform").addEventListener("click", function () { addTransformRow("transformsEditor", { path: "", value: "" }); });

  $("inputRemoveHeader").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); var v = this.value.trim(); if (v) { addRemoveHeaderTag(v); this.value = ""; } }
  });
  $("btnAddRemoveHeader").addEventListener("click", function () { var v = $("inputRemoveHeader").value.trim(); if (v) { addRemoveHeaderTag(v); $("inputRemoveHeader").value = ""; } });
  $("inputRemoveRespHeader").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); var v = this.value.trim(); if (v) { addRemoveHeaderTag(v, "removeRespHeadersTags"); this.value = ""; } }
  });
  $("btnAddRemoveRespHeader").addEventListener("click", function () { var v = $("inputRemoveRespHeader").value.trim(); if (v) { addRemoveHeaderTag(v, "removeRespHeadersTags"); $("inputRemoveRespHeader").value = ""; } });

  $("inputRemoveQueryParam").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); var v = this.value.trim(); if (v) { addRemoveHeaderTag(v, "removeQueryParamsTags"); this.value = ""; } }
  });
  $("btnAddRemoveQueryParam").addEventListener("click", function () { var v = $("inputRemoveQueryParam").value.trim(); if (v) { addRemoveHeaderTag(v, "removeQueryParamsTags"); $("inputRemoveQueryParam").value = ""; } });
  $("btnAddSetQueryParam").addEventListener("click", function () { addKvRow("setQueryParamsEditor", "", ""); });

  $("btnFormatBody").addEventListener("click", function () { formatBodyIn("editBody", "editBodyHighlight", "jsonValidMsg"); });
  $("btnFullscreenBody").addEventListener("click", openBodyFullscreen);
  $("btnFormatBodyFS").addEventListener("click", function () { formatBodyIn("editBodyFS", "editBodyHighlightFS", "jsonValidMsgFS"); });
  $("btnCloseFullscreen").addEventListener("click", closeBodyFullscreen);
  $("btnApplyFullscreen").addEventListener("click", closeBodyFullscreen);
  $("editBodyFS").addEventListener("input", function () { updateBodyHighlight("editBodyFS", "editBodyHighlightFS"); validateJSONBody("editBodyFS", "jsonValidMsgFS"); });
  $("editBodyFS").addEventListener("scroll", function () { syncBodyScroll("editBodyFS", "editBodyHighlightFS"); });

  $("btnExport").addEventListener("click", exportRules);
  $("btnImport").addEventListener("click", function () { $("importFile").click(); });
  $("importFile").addEventListener("change", importRules);

  setupBodyEditor("editBodyFS", "editBodyHighlightFS", "jsonValidMsgFS");
  setupSearch("editBody", "editBodyHighlight", "searchBody", "searchBodyCount", "searchBodyPrev", "searchBodyNext");
  setupSearch("editBodyFS", "editBodyHighlightFS", "searchBodyFS", "searchBodyCountFS", "searchBodyPrevFS", "searchBodyNextFS");
}

document.addEventListener("mouseenter", function (e) {
  if (!e.target || !(e.target instanceof Element)) return;
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
  if (!e.target || !(e.target instanceof Element)) return;
  var tip = e.target.closest(".help-tip");
  if (tip) tip.classList.remove("active");
}, true);

function renderVarSavers() {
  var list = $("varSaversList");
  if (!list) return;
  var countEl = $("varsCount");
  if (countEl) countEl.textContent = varSavers.length > 0 ? varSavers.length : "";
  if (varSavers.length === 0) {
    list.innerHTML = '<div class="var-savers-empty">Нет сохранённых переменных</div>';
    return;
  }
  var html = "";
  varSavers.forEach(function (vs) {
    var disabledClass = vs.enabled ? "" : " disabled";
    var sourceLabel = vs.source === "body" ? "Body" : vs.source === "header" ? "Header" : "Status";
    html += '<div class="var-saver-item' + disabledClass + '" data-id="' + vs.id + '">';
    html += '<input type="checkbox" class="vs-toggle" data-id="' + vs.id + '"' + (vs.enabled ? " checked" : "") + '>';
    html += '<div class="vs-info">';
    html += '<span class="vs-name">' + escapeHtml(vs.varName) + '</span>';
    html += '<span class="vs-detail">' + escapeHtml(vs.urlPattern || "*") + ' &middot; ' + sourceLabel + (vs.path ? ': ' + escapeHtml(vs.path) : '') + '</span>';
    html += '</div>';
    html += '<div class="vs-actions">';
    html += '<button class="vs-edit" data-id="' + vs.id + '" title="Редактировать">&#9998;</button>';
    html += '<button class="vs-delete" data-id="' + vs.id + '" title="Удалить">&times;</button>';
    html += '</div></div>';
  });
  list.innerHTML = html;
}

function openVarSaverEditor(id) {
  var vs = id ? varSavers.filter(function (v) { return v.id === id; })[0] : createDefaultVarSaver();
  if (!vs) return;
  if (typeof loadSeenUrls === "function") loadSeenUrls();
  var modal = $("varSaverModal");
  if (!modal) return;
  $("editVsUrl").value = vs.urlPattern || "";
  $("editVsSource").value = vs.source || "body";
  $("editVsPath").value = vs.source === "status" ? "" : (vs.path || "");
  $("editVsVarName").value = (vs.varName || "").replace(/^\$/, "");
  var pathGroup = $("editVsPathGroup");
  if (pathGroup) pathGroup.style.display = vs.source === "status" ? "none" : "";
  modal.dataset.editId = id || "";
  modal.classList.remove("hidden");
}

function closeVarSaverEditor() {
  var modal = $("varSaverModal");
  if (modal) modal.classList.add("hidden");
}

function saveVarSaver() {
  var modal = $("varSaverModal");
  var id = modal.dataset.editId;
  var vs = id ? varSavers.filter(function (v) { return v.id === id; })[0] : createDefaultVarSaver();
  if (!vs) return;
  vs.urlPattern = $("editVsUrl").value.trim();
  vs.source = $("editVsSource").value;
  vs.path = vs.source === "status" ? "" : $("editVsPath").value.trim();
  vs.varName = "$" + $("editVsVarName").value.trim().replace(/^\$/, "");
  if (!vs.varName || vs.varName === "$") {
    alert("Укажите имя переменной");
    return;
  }
  if (!vs.urlPattern) {
    alert("Укажите URL-паттерн");
    return;
  }
  if (!id) varSavers.push(vs);
  saveVarSaversState();
  renderVarSavers();
  closeVarSaverEditor();
}

function deleteVarSaver(id) {
  varSavers = varSavers.filter(function (v) { return v.id !== id; });
  saveVarSaversState();
  renderVarSavers();
}

function toggleVarSaver(id, enabled) {
  for (var i = 0; i < varSavers.length; i++) {
    if (varSavers[i].id === id) { varSavers[i].enabled = enabled; break; }
  }
  saveVarSaversState();
  renderVarSavers();
}

function bindVarSaversEvents() {
  var varsHeader = $("varsHeader");
  if (varsHeader) {
    varsHeader.addEventListener("click", function () {
      var body = $("varsBody");
      var toggle = $("varsToggle");
      if (body.classList.contains("collapsed")) {
        body.classList.remove("collapsed");
        toggle.innerHTML = "&#9662;";
      } else {
        body.classList.add("collapsed");
        toggle.innerHTML = "&#9656;";
      }
    });
  }

  var btnAdd = $("btnAddVarSaver");
  if (btnAdd) btnAdd.addEventListener("click", function () { openVarSaverEditor(null); });

  var list = $("varSaversList");
  if (list) {
    list.addEventListener("click", function (e) {
      var t = e.target;
      if (t.classList.contains("vs-toggle")) { toggleVarSaver(t.getAttribute("data-id"), t.checked); return; }
      if (t.classList.contains("vs-edit")) { openVarSaverEditor(t.getAttribute("data-id")); return; }
      if (t.classList.contains("vs-delete")) { deleteVarSaver(t.getAttribute("data-id")); return; }
    });
  }

  var btnSaveVs = $("btnSaveVs");
  if (btnSaveVs) btnSaveVs.addEventListener("click", saveVarSaver);

  var btnCancelVs = $("btnCancelVs");
  if (btnCancelVs) btnCancelVs.addEventListener("click", closeVarSaverEditor);

  var btnCancelVsBtn = $("btnCancelVsBtn");
  if (btnCancelVsBtn) btnCancelVsBtn.addEventListener("click", closeVarSaverEditor);

  var editVsSource = $("editVsSource");
  if (editVsSource) {
    editVsSource.addEventListener("change", function () {
      var pathGroup = $("editVsPathGroup");
      if (pathGroup) pathGroup.style.display = this.value === "status" ? "none" : "";
      if (this.value === "status") $("editVsPath").value = "";
    });
  }

  var editVsUrlEl = $("editVsUrl");
  if (editVsUrlEl) {
    editVsUrlEl.addEventListener("input", function () { showVsUrlDropdown(this.value); });
    editVsUrlEl.addEventListener("focus", function () { showVsUrlDropdown(this.value); });
    editVsUrlEl.addEventListener("blur", function () { var dd = $("vsUrlDropdown"); if (dd) dd.classList.add("hidden"); });
  }

  var editVsVarNameEl = $("editVsVarName");
  if (editVsVarNameEl) {
    editVsVarNameEl.addEventListener("input", function () { showVarDropdownSimple(this); });
    editVsVarNameEl.addEventListener("focus", function () { showVarDropdownSimple(this); });
    editVsVarNameEl.addEventListener("blur", function () { var wrap = this.closest(".vs-var-name-wrap"); if (wrap) { var d = wrap.querySelector(".var-dropdown"); if (d) d.remove(); } });
  }
}
