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

  $("rulesList").addEventListener("click", function (e) { handleRulesListClick(e); });
  var searchInput = $("rulesSearch");
  if (searchInput) {
    var searchTimer = null;
    searchInput.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { setRulesSearchQuery(searchInput.value); }, 150);
    });
  }

  bindEditorEvents();
  bindVarSaversEvents();
  initRulesListDnD();
}

document.addEventListener("DOMContentLoaded", init);
