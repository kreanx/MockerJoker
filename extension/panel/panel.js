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
  chrome.storage.local.get({ rules: [], varSavers: [], masterEnabled: true }, function (data) {
    rules = data.rules || [];
    varSavers = data.varSavers || [];
    masterEnabled = data.masterEnabled !== false;
    $("masterToggle").checked = masterEnabled;
    updateToggleStatus();
    renderRules();
    renderVarSavers();
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
  chrome.runtime.sendMessage({ type: CONST.MSG_GET_HIT_COUNTERS }, function (res) {
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

  bindEditorEvents();
  bindVarSaversEvents();
}

document.addEventListener("DOMContentLoaded", init);
