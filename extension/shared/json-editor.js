function highlightJSON(str) {
  if (!str) return "\n";
  var s = str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (str.length > 1000000) return s + "\n";
  return s.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    function (m) {
      var c = "json-number";
      if (/^"/.test(m)) {
        c = /:$/.test(m) ? "json-key" : "json-string";
      } else if (/true|false/.test(m)) {
        c = "json-boolean";
      } else if (/null/.test(m)) {
        c = "json-null";
      }
      return '<span class="' + c + '">' + m + "</span>";
    }
  ) + "\n";
}

function applySearchHighlight(html, query) {
  if (!query) return html;
  var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var re = new RegExp(escaped, "gi");
  // Single forward pass: mark every position as "inside markup" or not, so we
  // skip matches that fall inside <span>/<mark> tags without re-scanning per
  // match (the old per-match substring + lastIndexOf made this O(n^2)).
  var inTag = new Uint8Array(html.length);
  var inTagNow = 0;
  for (var i = 0; i < html.length; i++) {
    var c = html.charCodeAt(i);
    if (c === 60) inTagNow = 1;        // '<'
    else if (c === 62) inTagNow = 0;   // '>'
    inTag[i] = inTagNow;
  }
  var out = [];
  var last = 0;
  var m;
  while ((m = re.exec(html)) !== null) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    if (inTag[m.index]) continue;      // match is inside markup — skip
    out.push(html.substring(last, m.index));
    out.push('<mark class="search-match">' + m[0] + "</mark>");
    last = m.index + m[0].length;
  }
  out.push(html.substring(last));
  return out.join("");
}

// Tokenized (syntax-highlighted) HTML is expensive to rebuild and depends only
// on the textarea value — cache it so typing in the search box never retokenizes.
var _hlCache = {};

function getHighlightedHTML(textareaId, ta) {
  var cached = _hlCache[textareaId];
  if (cached && cached.value === ta.value) return cached.html;
  var html = highlightJSON(ta.value);
  _hlCache[textareaId] = { value: ta.value, html: html };
  return html;
}

function updateBodyHighlight(textareaId, highlightId) {
  var ta = $(textareaId);
  var code = $(highlightId);
  if (!ta || !code) return;
  var html = getHighlightedHTML(textareaId, ta);
  var query = ta.dataset.searchQuery || "";
  if (query) {
    html = applySearchHighlight(html, query);
  }
  code.innerHTML = html;
  if (query) {
    var idx = parseInt(ta.dataset.searchCurrentIdx, 10);
    if (!isNaN(idx) && idx >= 0) {
      var marks = code.querySelectorAll(".search-match");
      if (marks[idx]) marks[idx].classList.add("current");
    }
  }
}

function validateJSONBody(textareaId, msgId) {
  var ta = $(textareaId);
  var msg = $(msgId);
  if (!ta || !msg) return;
  var val = ta.value.trim();
  if (!val) {
    msg.textContent = "";
    msg.className = "json-valid-msg empty";
    return;
  }
  try {
    JSON.parse(val);
    msg.textContent = "Valid JSON";
    msg.className = "json-valid-msg valid";
  } catch (e) {
    msg.textContent = e.message.replace(/^JSON\.parse:\s*/, "");
    msg.className = "json-valid-msg invalid";
  }
}

function syncBodyScroll(textareaId, highlightId) {
  var ta = $(textareaId);
  var code = $(highlightId);
  if (!ta || !code) return;
  var pre = code.parentElement;
  pre.scrollTop = ta.scrollTop;
  pre.scrollLeft = ta.scrollLeft;
}

function setupBodyEditor(textareaId, highlightId, msgId) {
  var ta = $(textareaId);
  if (!ta || ta.dataset.editorInit) return;
  ta.dataset.editorInit = "1";
  var wrap = ta.closest(".json-editor-wrap");
  var lineNums = null;
  if (wrap) {
    lineNums = document.createElement("div");
    lineNums.className = "line-numbers";
    wrap.insertBefore(lineNums, wrap.firstChild);
  }

  var lastLineCount = -1;
  function updateLineNumbers() {
    if (!lineNums) return;
    var lines = ta.value.split("\n").length;
    if (lines === lastLineCount) return;
    lastLineCount = lines;
    var html = "";
    for (var i = 1; i <= lines; i++) {
      html += "<span>" + i + "</span>";
    }
    lineNums.innerHTML = html;
  }

  function update() {
    updateBodyHighlight(textareaId, highlightId);
    validateJSONBody(textareaId, msgId);
    syncEditorHeight();
    updateLineNumbers();
  }

  function syncEditorHeight() {
    var code = $(highlightId);
    if (!code) return;
    code.style.height = ta.offsetHeight + "px";
    if (lineNums) lineNums.style.height = ta.offsetHeight + "px";
  }

  ta.addEventListener("input", update);
  ta.addEventListener("scroll", function () {
    syncBodyScroll(textareaId, highlightId);
    if (lineNums) lineNums.scrollTop = ta.scrollTop;
  });
  ta.addEventListener("focus", function () { if (wrap) wrap.classList.add("focused"); });
  ta.addEventListener("blur", function () { if (wrap) wrap.classList.remove("focused"); });

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(syncEditorHeight).observe(ta);
  } else {
    ta.addEventListener("mouseup", syncEditorHeight);
  }

  ta.addEventListener("paste", function (e) {
    var pasted = (e.clipboardData || window.clipboardData).getData("text");
    try {
      var parsed = JSON.parse(pasted);
      e.preventDefault();
      ta.value = JSON.stringify(parsed, null, 2);
      update();
    } catch (err) {}
  });

  ta.addEventListener("keydown", function (e) {
    if (e.key === "Tab") {
      e.preventDefault();
      var start = ta.selectionStart;
      var end = ta.selectionEnd;
      ta.value = ta.value.substring(0, start) + "  " + ta.value.substring(end);
      ta.selectionStart = ta.selectionEnd = start + 2;
      update();
    }
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      formatBodyIn(textareaId, highlightId, msgId);
    }
  });

  update();
}

function setupCodeEditor(textareaId, highlightId) {
  var ta = $(textareaId);
  if (!ta || ta.dataset.editorInit) return;
  ta.dataset.editorInit = "1";
  var wrap = ta.closest(".json-editor-wrap");
  var lineNums = null;
  if (wrap) {
    lineNums = document.createElement("div");
    lineNums.className = "line-numbers";
    wrap.insertBefore(lineNums, wrap.firstChild);
  }

  var lastLineCount = -1;
  function updateLineNumbers() {
    if (!lineNums) return;
    var lines = ta.value.split("\n").length;
    if (lines === lastLineCount) return;
    lastLineCount = lines;
    var html = "";
    for (var i = 1; i <= lines; i++) {
      html += "<span>" + i + "</span>";
    }
    lineNums.innerHTML = html;
  }

  function update() {
    updateBodyHighlight(textareaId, highlightId);
    syncEditorHeight();
    updateLineNumbers();
  }

  function syncEditorHeight() {
    var code = $(highlightId);
    if (!code) return;
    code.style.height = ta.offsetHeight + "px";
    if (lineNums) lineNums.style.height = ta.offsetHeight + "px";
  }

  ta.addEventListener("input", update);
  ta.addEventListener("scroll", function () {
    syncBodyScroll(textareaId, highlightId);
    if (lineNums) lineNums.scrollTop = ta.scrollTop;
  });
  ta.addEventListener("focus", function () { if (wrap) wrap.classList.add("focused"); });
  ta.addEventListener("blur", function () { if (wrap) wrap.classList.remove("focused"); });

  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(syncEditorHeight).observe(ta);
  } else {
    ta.addEventListener("mouseup", syncEditorHeight);
  }

  ta.addEventListener("keydown", function (e) {
    if (e.key === "Tab") {
      e.preventDefault();
      var start = ta.selectionStart;
      var end = ta.selectionEnd;
      ta.value = ta.value.substring(0, start) + "  " + ta.value.substring(end);
      ta.selectionStart = ta.selectionEnd = start + 2;
      update();
    }
  });

  update();
}

function formatBodyIn(textareaId, highlightId, msgId) {
  var ta = $(textareaId);
  if (!ta) return;
  var val = ta.value.trim();
  if (!val) return;
  try {
    ta.value = JSON.stringify(JSON.parse(val), null, 2);
  } catch (e) {}
  ta.scrollTop = 0;
  ta.scrollLeft = 0;
  updateBodyHighlight(textareaId, highlightId);
  syncBodyScroll(textareaId, highlightId);
  validateJSONBody(textareaId, msgId);
}

function setupSearch(textareaId, highlightId, inputId, countId, prevId, nextId) {
  var ta = $(textareaId);
  var input = $(inputId);
  if (!ta || !input || input.dataset.searchInit) return;
  input.dataset.searchInit = "1";

  var countEl = $(countId);
  var matches = [];
  var currentIdx = -1;

  function findMatches() {
    matches = [];
    currentIdx = -1;
    var q = input.value;
    if (!q) {
      countEl.textContent = "";
      ta.dataset.searchQuery = "";
      ta.dataset.searchCurrentIdx = "-1";
      updateBodyHighlight(textareaId, highlightId);
      return;
    }
    var text = ta.value.toLowerCase();
    var ql = q.toLowerCase();
    var pos = 0;
    while (true) {
      pos = text.indexOf(ql, pos);
      if (pos === -1) break;
      matches.push(pos);
      pos++;
    }
    if (matches.length > 0) currentIdx = 0;
    countEl.textContent = matches.length > 0 ? (currentIdx + 1) + "/" + matches.length : "0/0";
    ta.dataset.searchQuery = q;
    ta.dataset.searchCurrentIdx = String(currentIdx);
    updateBodyHighlight(textareaId, highlightId);
    scrollToMatch();
  }

  function scrollToMatch() {
    if (currentIdx < 0 || currentIdx >= matches.length) return;
    var start = matches[currentIdx];
    var before = ta.value.substring(0, start);
    var lines = before.split("\n").length;
    var lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    ta.scrollTop = Math.max(0, (lines - 3) * lh);
    syncBodyScroll(textareaId, highlightId);
  }

  function selectAndScroll() {
    if (currentIdx < 0 || currentIdx >= matches.length) return;
    var start = matches[currentIdx];
    var end = start + input.value.length;
    ta.focus();
    ta.setSelectionRange(start, end);
    scrollToMatch();
  }

  function next() {
    if (!matches.length) return;
    currentIdx = (currentIdx + 1) % matches.length;
    countEl.textContent = (currentIdx + 1) + "/" + matches.length;
    ta.dataset.searchCurrentIdx = String(currentIdx);
    updateBodyHighlight(textareaId, highlightId);
    selectAndScroll();
  }

  function prev() {
    if (!matches.length) return;
    currentIdx = (currentIdx - 1 + matches.length) % matches.length;
    countEl.textContent = (currentIdx + 1) + "/" + matches.length;
    ta.dataset.searchCurrentIdx = String(currentIdx);
    updateBodyHighlight(textareaId, highlightId);
    selectAndScroll();
  }

  var searchTimer = null;
  input.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(findMatches, 120);
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? prev() : next(); }
  });
  $(nextId).addEventListener("click", next);
  $(prevId).addEventListener("click", prev);
}

function openBodyFullscreen() {
  var src = $("editBody");
  var dst = $("editBodyFS");
  if (!src || !dst) return;
  dst.value = src.value;
  updateBodyHighlight("editBodyFS", "editBodyHighlightFS");
  validateJSONBody("editBodyFS", "jsonValidMsgFS");
  $("bodyFullscreenModal").classList.remove("hidden");
  dst.focus();
}

function closeBodyFullscreen() {
  var src = $("editBodyFS");
  var dst = $("editBody");
  if (!src || !dst) return;
  dst.value = src.value;
  updateBodyHighlight("editBody", "editBodyHighlight");
  validateJSONBody("editBody", "jsonValidMsg");
  $("bodyFullscreenModal").classList.add("hidden");
}
