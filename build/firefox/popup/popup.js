var rules = [];
var masterEnabled = true;
var editingRuleId = null;

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
    rules.forEach(function (rule) { html += renderRuleItem(rule, counters, lastTime); });
    list.innerHTML = html;
  });
}

function bindEvents() {
  $("masterToggle").addEventListener("change", function () { masterEnabled = this.checked; saveState(); });
  $("btnOpenTab").addEventListener("click", function () { chrome.runtime.sendMessage({ type: "openPanel" }); });
  $("btnHelp").addEventListener("click", function () { $("helpOverlay").classList.remove("hidden"); });
  $("btnCloseHelp").addEventListener("click", function () { $("helpOverlay").classList.add("hidden"); });
  $("helpOverlay").addEventListener("click", function (e) { if (e.target === $("helpOverlay")) $("helpOverlay").classList.add("hidden"); });

  $("btnAdd").addEventListener("click", function () { openEditor(null); });
  $("btnPresets").addEventListener("click", function (e) { e.stopPropagation(); $("presetsMenu").classList.toggle("hidden"); });
  document.addEventListener("click", function () { $("presetsMenu").classList.add("hidden"); });
  $("presetsMenu").addEventListener("click", function (e) {
    if (!e.target.classList.contains("preset-btn")) return;
    var presetName = e.target.getAttribute("data-preset");
    $("presetsMenu").classList.add("hidden");
    var factory = presetFactories[presetName];
    if (factory) { var rule = factory(""); rules.push(rule); saveState(); renderRules(); openEditor(rule.id); }
  });

  $("rulesList").addEventListener("click", function (e) {
    var t = e.target;
    if (t.classList.contains("rule-toggle")) { toggleRule(t.getAttribute("data-id"), t.checked); return; }
    if (t.classList.contains("btn-edit")) { openEditor(t.getAttribute("data-id")); return; }
    if (t.classList.contains("btn-delete")) { deleteRuleById(t.getAttribute("data-id")); return; }
  });

  $("btnCloseEditor").addEventListener("click", closeEditor);
  $("btnCancel").addEventListener("click", closeEditor);
  $("btnSave").addEventListener("click", saveEditor);

  $("editUrlPattern").addEventListener("input", function () { showUrlDropdown(this.value); });
  $("editUrlPattern").addEventListener("focus", function () { showUrlDropdown(this.value); });
  $("editUrlPattern").addEventListener("blur", function () { $("urlDropdown").classList.add("hidden"); });
  $("editActionType").addEventListener("change", function () { toggleActionFields(this.value); });

  $("btnAddHeader").addEventListener("click", function () { addKvRow("headersEditor", "", ""); });
  $("btnAddSetHeader").addEventListener("click", function () { addKvRow("setHeadersEditor", "", ""); });
  $("btnAddSetRespHeader").addEventListener("click", function () { addKvRow("setRespHeadersEditor", "", ""); });
  $("btnAddRespTransform").addEventListener("click", function () { addTransformRow("respTransformsEditor", { path: "", value: "" }); });

  $("btnAddBc").addEventListener("click", function () { addBodyConditionRow("bodyConditionsEditor", { path: "", operator: "equals", value: "" }); });
  $("btnAddTransform").addEventListener("click", function () { addTransformRow("transformsEditor", { path: "", value: "" }); });

  $("inputRemoveHeader").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); var v = this.value.trim(); if (v) { addRemoveHeaderTag(v); this.value = ""; } }
  });
  $("btnAddRemoveHeader").addEventListener("click", function () { var v = $("inputRemoveHeader").value.trim(); if (v) { addRemoveHeaderTag(v); $("inputRemoveHeader").value = ""; } });
  $("inputRemoveRespHeader").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); var v = this.value.trim(); if (v) { addRemoveHeaderTag(v, "removeRespHeadersTags"); this.value = ""; } }
  });
  $("btnAddRemoveRespHeader").addEventListener("click", function () { var v = $("inputRemoveRespHeader").value.trim(); if (v) { addRemoveHeaderTag(v, "removeRespHeadersTags"); $("inputRemoveRespHeader").value = ""; } });

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

document.addEventListener("DOMContentLoaded", init);
