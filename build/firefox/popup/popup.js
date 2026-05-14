var rules = [];
var masterEnabled = true;
var editingRuleId = null;
var currentTheme = "dark";

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  var btn = $("btnTheme");
  if (btn) btn.textContent = theme === "dark" ? "\u263E" : "\u2600";
}

function loadTheme() {
  chrome.storage.local.get({ theme: "dark" }, function (data) {
    applyTheme(data.theme);
  });
}

function toggleTheme() {
  var next = currentTheme === "dark" ? "light" : "dark";
  applyTheme(next);
  chrome.storage.local.set({ theme: next });
}

function init() {
  loadTheme();
  loadState();
  bindEvents();
}

function loadState() {
  chrome.storage.local.get({ rules: [], varSavers: [], masterEnabled: true }, function (data) {
    rules = data.rules || [];
    varSavers = data.varSavers || [];
    masterEnabled = data.masterEnabled !== false;
    $("masterToggle").checked = masterEnabled;
    renderRules();
    renderVarSavers();
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
  chrome.runtime.sendMessage({ type: CONST.MSG_GET_HIT_COUNTERS }, function (res) {
    var counters = (res && res.counters) || {};
    var lastTime = (res && res.lastHitTime) || {};
    var html = "";
    rules.forEach(function (rule) { html += renderRuleItem(rule, counters, lastTime); });
    list.innerHTML = html;
  });
}

function bindEvents() {
  $("masterToggle").addEventListener("change", function () { masterEnabled = this.checked; saveState(); });
  $("btnTheme").addEventListener("click", toggleTheme);
  $("btnOpenTab").addEventListener("click", function () { chrome.runtime.sendMessage({ type: CONST.MSG_OPEN_PANEL }); });
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

  bindEditorEvents();
  bindVarSaversEvents();
}

document.addEventListener("DOMContentLoaded", init);
