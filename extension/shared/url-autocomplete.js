var seenUrls = [];

function loadSeenUrls() {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, function (tabs) {
    var tabId = tabs && tabs[0] ? tabs[0].id : null;
    chrome.runtime.sendMessage({ type: CONST.MSG_GET_SEEN_REQUESTS, tabId: tabId }, function (res) {
      seenUrls = [];
      var seen = {};
      if (res && res.requests) {
        res.requests.forEach(function (r) {
          if (!seen[r.url]) { seen[r.url] = true; seenUrls.push({ url: r.url, method: r.method }); }
        });
      }
      rules.forEach(function (r) {
        var p = r.match.urlPattern;
        if (p && !seen[p]) { seen[p] = true; seenUrls.push({ url: p, method: "" }); }
      });
    });
  });
}

function showUrlDropdown(filter) {
  var dd = $("urlDropdown");
  if (!dd) return;
  _fillUrlDropdown(dd, filter, "editUrlPattern");
}

function showGraphqlUrlDropdown(filter) {
  var dd = $("graphqlUrlDropdown");
  if (!dd) return;
  _fillUrlDropdown(dd, filter, "editGraphqlUrl");
}

function showVsUrlDropdown(filter) {
  var dd = $("vsUrlDropdown");
  if (!dd) return;
  _fillUrlDropdown(dd, filter, "editVsUrl");
}

function _fillUrlDropdown(dd, filter, targetId) {
  dd.innerHTML = "";
  var items = seenUrls;
  if (filter) {
    var lower = filter.toLowerCase();
    items = items.filter(function (u) { return u.url.toLowerCase().indexOf(lower) !== -1; });
  }
  if (items.length === 0) { dd.classList.add("hidden"); return; }
  items.slice(0, 20).forEach(function (item) {
    var div = document.createElement("div");
    div.className = "autocomplete-item";
    div.innerHTML = (item.method ? '<span class="ac-method">' + escapeHtml(item.method) + '</span>' : '') + escapeHtml(item.url);
    div.addEventListener("mousedown", function (e) {
      e.preventDefault();
      $(targetId).value = item.url;
      dd.classList.add("hidden");
    });
    dd.appendChild(div);
  });
  dd.classList.remove("hidden");
}
