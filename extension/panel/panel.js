var rules = [];
var masterEnabled = true;
var editingRuleId = null;

function init() {
  var manifest = chrome.runtime.getManifest();
  var ver = $("headerVersion");
  if (ver && manifest.version) ver.textContent = "v" + manifest.version;
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

function updateToggleStatus() {
  var el = $("toggleStatus");
  if (masterEnabled) { el.textContent = "ВКЛ"; el.className = "toggle-status on"; }
  else { el.textContent = "ВЫКЛ"; el.className = "toggle-status off"; }
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
    rules.forEach(function (rule) { html += renderRuleItem(rule, counters, lastTime); });
    list.innerHTML = html;
  });
}

function bindEvents() {
  $("masterToggle").addEventListener("change", function () { masterEnabled = this.checked; updateToggleStatus(); saveState(); });
  $("btnAdd").addEventListener("click", function () { openEditor(null); });
  $("btnHelp").addEventListener("click", function () { $("helpModal").classList.remove("hidden"); });
  $("btnCloseHelp").addEventListener("click", function () { $("helpModal").classList.add("hidden"); });
  document.querySelector(".help-backdrop").addEventListener("click", function () { $("helpModal").classList.add("hidden"); });

  document.querySelectorAll(".preset-card").forEach(function (card) {
    card.addEventListener("click", function () {
      var factory = presetFactories[this.getAttribute("data-preset")];
      if (factory) { var rule = factory(""); rules.push(rule); saveState(); renderRules(); openEditor(rule.id); }
    });
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

  $("btnAddBc").addEventListener("click", function () { addBodyConditionRow("bodyConditionsEditor", { path: "", operator: "equals", value: "" }); });
  $("btnAddTransform").addEventListener("click", function () { addTransformRow("transformsEditor", { path: "", value: "" }); });

  $("inputRemoveHeader").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); var v = this.value.trim(); if (v) { addRemoveHeaderTag(v); this.value = ""; } }
  });
  $("inputRemoveRespHeader").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); var v = this.value.trim(); if (v) { addRemoveHeaderTag(v, "removeRespHeadersTags"); this.value = ""; } }
  });

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
      rules = imported;
      saveState();
      renderRules();
    } catch (err) { alert("Ошибка импорта: " + err.message); }
  };
  reader.readAsText(file);
  $("importFile").value = "";
}

document.addEventListener("DOMContentLoaded", init);
