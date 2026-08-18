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
  var manifest = chrome.runtime.getManifest();
  var ver = $("headerVersion");
  if (ver && manifest.version) ver.textContent = "v" + manifest.version;
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
    updateToggleStatus();
    renderRules();
    renderVarSavers();

    // Check for mockUrl param (from devtools "mock this request" context menu)
    var params = new URLSearchParams(window.location.search);
    var mockUrl = params.get("mockUrl");
    if (mockUrl) {
      var rule = createDefaultRule();
      try {
        // Exact full URL (query included, no wildcard stars): the user asked
        // for the copied URL verbatim; globToRegex escapes it safely.
        var u = new URL(mockUrl);
        rule.match.urlPattern = u.origin + u.pathname + u.search;
      } catch (e) {
        rule.match.urlPattern = mockUrl;
      }
      var mockMethod = params.get("mockMethod");
      rule.match.method = mockMethod || "ANY";
      rule.name = "Mock " + (mockMethod || "GET");
      rules.push(rule);
      saveState();
      renderRules();
      openEditor(rule.id);
      window.history.replaceState({}, "", window.location.pathname);
    }
  });
}

function updateToggleStatus() {
  var el = $("toggleStatus");
  if (masterEnabled) { el.textContent = "ВКЛ"; el.className = "toggle-status on"; }
  else { el.textContent = "ВЫКЛ"; el.className = "toggle-status off"; }
}


function bindEvents() {
  $("masterToggle").addEventListener("change", function () { masterEnabled = this.checked; updateToggleStatus(); saveState(); });
  $("btnTheme").addEventListener("click", toggleTheme);
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
