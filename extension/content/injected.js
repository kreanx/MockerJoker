(function () {
  // Constants defined locally — no dependency on shared/constants.js or
  // window globals. The page (e.g. Jira) may define its own window.CONST
  // which caused name collisions. This is the only reliable approach for
  // page-context scripts. Keep in sync with extension/shared/constants.js.
  var CONST = {
    ACTION_TYPES: { MOCK_RESPONSE: "mockResponse", MODIFY_REQUEST: "modifyRequest", MODIFY_RESPONSE: "modifyResponse", MODIFY_BODY: "modifyBody" },
    DEFAULT_STATUS: 200, DEFAULT_DELAY: 0, DEFAULT_BODY: "{}",
    HEADER_CONTENT_TYPE: "Content-Type", CONTENT_TYPE_JSON: "application/json",
    SEEN_MAX: 100, INTERCEPTION_LIMIT: 500,
    MSG: {
      GET_RULES: "getRules", SAVE_RULES: "saveRules", OPEN_PANEL: "openPanel",
      RULES_UPDATED: "rulesUpdated", HIT_COUNT: "hitCount", GET_HIT_COUNTERS: "getHitCounters",
      RESET_HIT_COUNTERS: "resetHitCounters", SEEN_REQUESTS: "seenRequests",
      GET_SEEN_REQUESTS: "getSeenRequests", TAB_VARS: "tabVars", INTERCEPTION: "interception"
    },
    PAGE_MSG: {
      RULES: "REQUEST_MOCKER_RULES", INIT: "REQUEST_MOCKER_INIT",
      HIT: "REQUEST_MOCKER_HIT", SEEN: "REQUEST_MOCKER_SEEN",
      TAB_VARS: "REQUEST_MOCKER_TAB_VARS", INTERCEPTION: "REQUEST_MOCKER_INTERCEPTION",
      BREAKPOINT_HIT: "REQUEST_MOCKER_BP_HIT",
      BREAKPOINT_RESUME: "REQUEST_MOCKER_BP_RESUME"
    }
  };

  var rules = [];
  var varSavers = [];
  var masterEnabled = true;
  var seenRequests = [];
  var tabVars = {};
  var _currentReq = {};
  var _bpSkip = false;
  var _bpReqId = null; // re-entry after a request-phase bp resume reuses the log entry
  var origFetch = window.fetch;
  var OrigXHR = window.XMLHttpRequest;
  var origXhrOpen = OrigXHR.prototype.open;
  var origXhrSend = OrigXHR.prototype.send;
  var origXhrSetHeader = OrigXHR.prototype.setRequestHeader;
  var origXhrGetHeader = OrigXHR.prototype.getResponseHeader;
  var origXhrGetAllHeaders = OrigXHR.prototype.getAllResponseHeaders;

  function resolveUrl(url) {
    if (!url) return url;
    try { return new URL(url, window.location.href).href; } catch(e) { return url; }
  }

  var _globCache = {};
  var _globCacheSize = 0;
  var _GLOB_CACHE_MAX = 256;
  function globToRegex(pattern) {
    if (!pattern || pattern.length > 500) return /^(?!)/;
    var cached = _globCache[pattern];
    if (cached) return cached;
    var escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    escaped = escaped.replace(/\*+/g, ".*");
    var re = new RegExp("^" + escaped + "$", "i");
    if (_globCacheSize < _GLOB_CACHE_MAX) { _globCache[pattern] = re; _globCacheSize++; }
    return re;
  }

  function parseGraphQL(body) {
    if (!body) return null;
    try {
      var parsed = typeof body === "string" ? JSON.parse(body) : body;
      if (parsed && (parsed.query || parsed.operationName)) return parsed;
    } catch(e) {}
    return null;
  }

  function findAllRules(url, method, reqBody) {
    var result = [];
    if (!masterEnabled) return result;
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (!rule.enabled) continue;
      if (rule.type === "breakpoint") continue;
      if (!rule.match || !rule.match.urlPattern) continue;
      var regex = globToRegex(rule.match.urlPattern);
      var urlMatch = regex.test(url);
      if (!urlMatch) continue;
      if (rule.match.method && rule.match.method !== "ANY" && rule.match.method !== method) continue;
      if (rule.match.graphqlOperation) {
        var gql = parseGraphQL(reqBody);
        if (!gql) continue;
        if (gql.operationName) {
          var opRegex = globToRegex(rule.match.graphqlOperation);
          if (!opRegex.test(gql.operationName)) continue;
        } else if (rule.match.graphqlOperation !== "*") {
          continue;
        }
      }
      if (!matchVarConditions(rule.match.varConditions)) continue;
      var at = rule.action && rule.action.type;
      if (at === CONST.ACTION_TYPES.MODIFY_BODY || at === CONST.ACTION_TYPES.MODIFY_REQUEST) {
        if (!matchBodyConditions(reqBody, rule.match.bodyConditions)) continue;
      }
      result.push(rule);
    }
    return result;
  }

  function addSeenRequest(url, method) {
    if (!url || url.indexOf("blob:") === 0 || url.indexOf("data:") === 0) return;
    for (var i = 0; i < seenRequests.length; i++) {
      if (seenRequests[i].url === url && seenRequests[i].method === method) return;
    }
    seenRequests.push({ url: url, method: method });
    if (seenRequests.length > CONST.SEEN_MAX) seenRequests.shift();
  }

  var seenTimer = null;
  function flushSeenRequests() {
    if (seenTimer) return;
    seenTimer = setTimeout(function () {
      seenTimer = null;
      window.postMessage({ type: CONST.PAGE_MSG.SEEN, requests: seenRequests }, "*");
    }, 500);
  }

  function reportHit(ruleId, url, method) {
    window.postMessage({
      type: CONST.PAGE_MSG.HIT,
      ruleId: ruleId,
      url: url,
      method: method,
      timestamp: Date.now()
    }, "*");
  }

  function tryParseBody(str) {
    if (!str) return str;
    try { return JSON.parse(str); } catch(e) { return str; }
  }

  function safeRespText(xhr) {
    try {
      if (!xhr.responseType || xhr.responseType === "text") return xhr.responseText;
    } catch (e) {}
    return null;
  }

  // Value typing (transforms + body conditions), in order:
  // 1) Valid JSON literal -> its JSON type: bare 123 -> number, "123" ->
  // STRING (quotes stripped), true/false/null -> boolean/null, [1,2]/{...}
  // -> array/object. JSON wins over single quotes: "'123'" -> string '123'.
  // 2) Bare number incl. leading zeros (007 -> 7) — legacy coercion kept.
  // 3) 'Single-quoted' -> string, content verbatim.
  // 4) Anything else -> plain string as typed.
  function parseValue(str) {
    if (typeof str !== "string") return str;
    try { return JSON.parse(str); } catch (e) {}
    if (/^-?\d+(\.\d+)?$/.test(str)) return Number(str);
    var sq = /^'([\s\S]*)'$/.exec(str);
    if (sq) return sq[1];
    return str;
  }

  function splitPath(path) {
    return path.replace(/\[(\d+|\*)\]/g, ".$1").split(".").filter(function(p) { return p !== ""; });
  }

  function getByPath(obj, path) {
    var parts = splitPath(path);
    return _getByParts(obj, parts);
  }

  function _getByParts(obj, parts) {
    if (parts.length === 0) return obj;
    var key = parts[0];
    var rest = parts.slice(1);
    if (key === "*") {
      if (Array.isArray(obj)) {
        var results = [];
        for (var i = 0; i < obj.length; i++) {
          var v = _getByParts(obj[i], rest);
          if (v !== undefined) results.push(v);
        }
        return results.length ? results : undefined;
      }
      return undefined;
    }
    if (obj == null) return undefined;
    return _getByParts(obj[key], rest);
  }

  function setByPath(obj, path, value) {
    var parts = splitPath(path);
    _setByParts(obj, parts, value);
  }

  function _setByParts(obj, parts, value) {
    if (parts.length === 0) return;
    var key = parts[0];
    var rest = parts.slice(1);
    if (key === "__proto__" || key === "constructor" || key === "prototype") return;
    if (key === "*") {
      if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length; i++) {
          _setByParts(obj[i], rest, value);
        }
      }
      return;
    }
    if (rest.length === 0) {
      if (obj != null) obj[key] = value;
      return;
    }
    if (obj != null) {
      if (obj[key] == null) {
        obj[key] = /^\d+$/.test(rest[0]) ? [] : {};
      }
      _setByParts(obj[key], rest, value);
    }
  }

  function matchBodyConditions(body, conditions) {
    if (!conditions || !conditions.length) return true;
    if (typeof body !== "object" || body === null) return false;
    for (var i = 0; i < conditions.length; i++) {
      var c = conditions[i];
      var val = getByPath(body, c.path);
      if (Array.isArray(val)) {
        var anyMatch = false;
        for (var j = 0; j < val.length; j++) {
          if (_checkOp(val[j], c)) { anyMatch = true; break; }
        }
        if (!anyMatch) return false;
      } else {
        if (!_checkOp(val, c)) return false;
      }
    }
    return true;
  }

  function _checkOp(val, c) {
    var expected = resolveVarValue(c.value);
    if (c.operator === "exists") return val !== undefined;
    if (c.operator === "equals") return val === parseValue(expected);
    if (c.operator === "notEquals") return val !== parseValue(expected);
    if (c.operator === "contains") {
      if (typeof val === "string") return val.indexOf(expected) !== -1;
      if (Array.isArray(val)) return val.indexOf(parseValue(expected)) !== -1;
      return false;
    }
    return false;
  }

  function resolveVarValue(val) {
    if (typeof val === "string" && val.charAt(0) === "$") {
      var v = tabVars[val];
      return v !== undefined ? v : val;
    }
    return val;
  }

  function resolveVarsInString(str) {
    if (typeof str !== "string" || str.indexOf("$") === -1) return str;
    return str.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, function (match, name) {
      var v = tabVars["$" + name];
      if (v === undefined) return match;
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    });
  }

  function applyBodyTransforms(body, transforms) {
    if (!transforms || !transforms.length) return body;
    for (var i = 0; i < transforms.length; i++) {
      var t = transforms[i];
      var resolved = resolveVarValue(t.value);
      // A resolved $var keeps its saved type (a string "007" must not become 7,
      // and JSON-parse must not strip quotes inside the var's value); only
      // bare literals go through parseValue auto-typing.
      setByPath(body, t.path, resolved === t.value ? parseValue(t.value) : resolved);
    }
    return body;
  }

  function parseReqBody(body) {
    if (body && typeof body === "string") {
      try { return JSON.parse(body); } catch(e) {}
    }
    return null;
  }

  function hasRespBC(rule) {
    return rule.match.bodyConditions && rule.match.bodyConditions.length > 0 &&
      (rule.action.type === CONST.ACTION_TYPES.MOCK_RESPONSE || rule.action.type === CONST.ACTION_TYPES.MODIFY_RESPONSE);
  }

  function parseRespObj(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch(e) { return null; }
  }

  function matchVarConditions(varConditions) {
    if (!varConditions || !varConditions.length) return true;
    for (var i = 0; i < varConditions.length; i++) {
      var vc = varConditions[i];
      var val = tabVars[vc.var];
      if (vc.operator === "exists") {
        if (val === undefined) return false;
      } else if (vc.operator === "equals") {
        if (val === undefined || val !== parseValue(vc.value)) return false;
      } else if (vc.operator === "notEquals") {
        if (val !== undefined && val === parseValue(vc.value)) return false;
      } else if (vc.operator === "contains") {
        if (val === undefined) return false;
        if (typeof val === "string" && val.indexOf(vc.value) === -1) return false;
        if (typeof val === "number" && String(val).indexOf(vc.value) === -1) return false;
      }
    }
    return true;
  }

  function saveVariables(saveVars, sourceObj, headers, statusCode) {
    if (!saveVars || !saveVars.length) return;
    for (var i = 0; i < saveVars.length; i++) {
      var sv = saveVars[i];
      var val;
      if (sv.source === "status") {
        val = statusCode;
      } else if (sv.source === "header") {
        val = headers ? headers[sv.path] || headers[sv.path.toLowerCase()] : undefined;
      } else {
        if (sourceObj && typeof sourceObj === "object") {
          val = getByPath(sourceObj, sv.path);
        } else {
          val = undefined;
        }
      }
      if (val !== undefined) {
        tabVars[sv.var] = val;
      }
    }
  }

  function flushTabVars() {
    window.postMessage({ type: CONST.PAGE_MSG.TAB_VARS, tabVars: tabVars }, "*");
  }

  // Cheap pre-check: does any response-target varSaver care about this URL?
  // Avoids response.clone().text() (full body read) on every fetch/XHR when no
  // varSaver actually matches.
  function hasMatchingResponseVarSaver(url) {
    for (var i = 0; i < varSavers.length; i++) {
      var vs = varSavers[i];
      if (!vs.enabled || vs.target === "request") continue;
      if (globToRegex(vs.urlPattern).test(url)) return true;
    }
    return false;
  }

  // reqBody: the parsed body of the triggering REQUEST. Required for
  // GraphQL filtering (operationName lives in the request body, GraphQL
  // responses carry none). EVERY call site must pass it — a dropped arg
  // fails silently (parseGraphQL(null) → skip), which the test suite
  // cannot detect because it drives processVarSavers directly.
  function processVarSavers(url, body, headers, statusCode, target, reqBody) {
    if (!varSavers || !varSavers.length) return;
    for (var i = 0; i < varSavers.length; i++) {
      var vs = varSavers[i];
      if (!vs.enabled) continue;
      if (vs.target === "request" && target !== "request") continue;
      if (vs.target !== "request" && target === "request") continue;
      var regex = globToRegex(vs.urlPattern);
      if (!regex.test(url)) continue;
      // GraphQL-only filter: operationName lives in the request body, so for
      // response-target savers we match against the body of the triggering request.
      if (vs.graphql) {
        var gql = parseGraphQL(target === "request" ? body : reqBody);
        if (!gql) continue;
        if (vs.graphqlOperation && vs.graphqlOperation !== "*") {
          if (gql.operationName) {
            if (!globToRegex(vs.graphqlOperation).test(gql.operationName)) continue;
          } else {
            continue;
          }
        }
      }
      var val;
      if (vs.source === "status") {
        val = statusCode;
      } else if (vs.source === "header") {
        val = headers ? headers[vs.path] || headers[vs.path.toLowerCase()] : undefined;
      } else {
        if (body && typeof body === "object") {
          val = getByPath(body, vs.path);
        }
      }
      if (val !== undefined) {
        tabVars[vs.varName] = val;
      }
    }
    flushTabVars();
  }

  function reportInterception(data, id) {
    data.id = id || (Date.now().toString(36) + Math.random().toString(36).substr(2, 9));
    if (id) data.pending = false;
    data.timestamp = Date.now();
    data.reqHeaders = _currentReq.headers;
    data.reqBody = _currentReq.body;
    window.postMessage({ type: CONST.PAGE_MSG.INTERCEPTION, data: data }, "*");
  }

  function logAction(bg, label, method, url, rule, extra) {
    var obj = { rule: rule.name };
    if (extra) {
      var keys = Object.keys(extra);
      for (var i = 0; i < keys.length; i++) obj[keys[i]] = extra[keys[i]];
    }
    if (rule.action.type === CONST.ACTION_TYPES.MOCK_RESPONSE && rule.action.body !== undefined) obj.body = tryParseBody(rule.action.body);
    console.log(
      "%c[MockerJoker]%c " + label + ": " + method + " " + url,
      "background:" + bg + ";color:#fff;padding:2px 6px;border-radius:3px",
      "color:" + bg + ";font-weight:bold",
      obj
    );
  }

  function applyRequestModifications(init, rule, urlObj) {
    if (!init) init = {};
    var headers = new Headers(init.headers || {});

    if (rule.action.removeHeaders) {
      rule.action.removeHeaders.forEach(function (h) {
        headers.delete(h);
      });
    }
    if (rule.action.setHeaders) {
      Object.keys(rule.action.setHeaders).forEach(function (k) {
        headers.set(k, String(resolveVarValue(rule.action.setHeaders[k])));
      });
    }
    if (rule.action.method) {
      init.method = rule.action.method;
    }
    init.headers = headers;
    return init;
  }

  function applyUrlModifications(url, rule) {
    if (!rule.action.removeQueryParams && !rule.action.setQueryParams) return url;
    try {
      var urlObj = new URL(url);
      if (rule.action.removeQueryParams) {
        rule.action.removeQueryParams.forEach(function(p) { urlObj.searchParams.delete(p); });
      }
      if (rule.action.setQueryParams) {
        Object.keys(rule.action.setQueryParams).forEach(function(k) {
          urlObj.searchParams.set(k, String(resolveVarValue(rule.action.setQueryParams[k])));
        });
      }
      return urlObj.href;
    } catch(e) { return url; }
  }

  // === FETCH ===

  window.fetch = function (input, init) {
    var url, method, reqBody;
    if (typeof input === "string") {
      url = resolveUrl(input);
    } else if (input instanceof Request) {
      url = input.url;
      method = input.method;
    } else {
      url = input.url || "";
    }
    method = ((init && init.method) || method || "GET").toUpperCase();
    reqBody = parseReqBody(init && init.body);

    addSeenRequest(url, method);
    flushSeenRequests();

    var reqHeadersObj = {};
    if (init && init.headers) {
      if (typeof init.headers.forEach === "function") {
        init.headers.forEach(function (v, k) { reqHeadersObj[k] = v; });
      } else if (typeof init.headers === "object") {
        for (var hk in init.headers) { reqHeadersObj[hk] = init.headers[hk]; }
      }
    }
    _currentReq = { headers: reqHeadersObj, body: reqBody ? JSON.stringify(reqBody) : null };
    processVarSavers(url, reqBody, reqHeadersObj, null, "request", reqBody);
    var reqId = _bpReqId || (Date.now().toString(36) + Math.random().toString(36).substr(2, 9));
    if (_bpReqId) {
      _bpReqId = null; // re-entry after a request-phase bp resume: keep one log entry
    } else {
      reportInterception({ url: url, method: method, matched: false, pending: true }, reqId);
    }
    var bpRule = (!_bpSkip && masterEnabled) ? findBreakpointRule(url, method) : null;
    if (bpRule && bpRule.breakpoint && bpRule.breakpoint.phase === "request") {
      var bpPayload = bpRequestPayload(url, method, reqHeadersObj, reqBody);
      // fetch(new Request(...)) without init: the body is not synchronously
      // reachable, but clone() lets us read it before the original is sent.
      // The text is shown in the panel AND used to rebuild the Request on a
      // URL edit (Request-from-Request construction is broken in Chromium —
      // it disturbs the input and the clone fails to send).
      var bpBodyText = null;
      var bpBodyRead = null;
      if (!reqBody && typeof input === "object" && input !== null && typeof Request !== "undefined" && input instanceof Request) {
        try {
          bpBodyRead = input.clone().text();
        } catch (e) {}
      }
      var bpWait = bpBodyRead
        ? bpBodyRead.then(function (t) { bpPayload.body = t; return waitForBreakpoint(bpPayload); })
        : Promise.resolve().then(function () { return waitForBreakpoint(bpPayload); });
      return bpWait.then(function (result) {
        if (result.action === "abort") {
          reportInterception({ url: url, method: method, matched: false, status: 0, body: null }, reqId);
          throw new DOMException("Aborted", "AbortError");
        }
        var m = applyBpRequestMods(input, init, result.mods, bpPayload.body);
        _bpReqId = reqId;
        _bpSkip = true;
        return window.fetch(m.input, m.init);
      });
    }
    _bpSkip = false;

    var matched = findAllRules(url, method, reqBody);
    if (matched.length === 0) {
      // No rules matched: report, run response varSavers (gated), and pause on a
      // response-phase breakpoint. Reporting stays off the critical path unless
      // a breakpoint needs the body.
      var needBpResp = bpRule && bpRule.breakpoint && bpRule.breakpoint.phase === "response";
      var needRespVars = hasMatchingResponseVarSaver(url);
      return origFetch.apply(this, arguments).then(function (response) {
        var hdrs = {};
        response.headers.forEach(function(v,k) { hdrs[k] = v; });
        var textReady = response.clone().text().then(function(text) {
          if (needRespVars) processVarSavers(url, parseRespObj(text), hdrs, response.status, "response", reqBody);
          reportInterception({ url: url, method: method, matched: false, status: response.status, headers: hdrs, body: text }, reqId);
          return text;
        });
        if (!needBpResp) { textReady.catch(function(){}); return response; }
        return textReady.then(function(text) {
          return waitForBreakpoint({
            phase: "response", url: url, method: method, status: response.status, headers: hdrs, body: text
          }).then(function(result) {
            if (result.action === "abort") throw new DOMException("Aborted", "AbortError");
            var mod = buildBpResponse(response.status, hdrs, text, result.mods);
            return mod || response;
          });
        });
      });
    }

    // Phase 1: Request modifications (modifyBody + modifyRequest)
    var reqRules = matched.filter(function (r) { return r.action.type === CONST.ACTION_TYPES.MODIFY_BODY || r.action.type === CONST.ACTION_TYPES.MODIFY_REQUEST; });
    var bodyObj = reqBody;
    var urlChanged = false;
    for (var ri = 0; ri < reqRules.length; ri++) {
      var rr = reqRules[ri];
      if (rr.action.type === CONST.ACTION_TYPES.MODIFY_BODY) {
        if (!bodyObj && init && init.body) bodyObj = parseReqBody(init.body);
        if (bodyObj) {
          bodyObj = applyBodyTransforms(bodyObj, rr.action.transforms);
          reportHit(rr.id, url, method);
          logAction("#009688", "FETCH modifyBody", method, url, rr, { transforms: rr.action.transforms, resultBody: bodyObj });
        }
      } else if (rr.action.type === CONST.ACTION_TYPES.MODIFY_REQUEST) {
        var newUrl = applyUrlModifications(url, rr);
        if (newUrl !== url) { url = newUrl; urlChanged = true; }
        init = applyRequestModifications(init, rr);
        if (rr.action.graphqlQuery) {
          if (!bodyObj && init && init.body) bodyObj = parseReqBody(init.body);
          if (bodyObj && typeof bodyObj === "object") {
            bodyObj.query = rr.action.graphqlQuery;
          }
        }
        if (rr.action.bodyOverride) {
          bodyObj = parseReqBody(rr.action.bodyOverride);
        }
        if (rr.action.transforms && rr.action.transforms.length > 0) {
          if (!bodyObj && init && init.body) bodyObj = parseReqBody(init.body);
          if (bodyObj) {
            bodyObj = applyBodyTransforms(bodyObj, rr.action.transforms);
          }
        }
        method = ((init && init.method) || method).toUpperCase();
        var mh = {};
        if (init && init.headers) init.headers.forEach(function (v, k) { mh[k] = v; });
        reportHit(rr.id, url, method);
        logAction("#f39c12", "FETCH modifyRequest", method, url, rr, { removeHeaders: rr.action.removeHeaders, setHeaders: rr.action.setHeaders, setQueryParams: rr.action.setQueryParams, removeQueryParams: rr.action.removeQueryParams, method: rr.action.method, transforms: rr.action.transforms, graphqlQuery: rr.action.graphqlQuery || undefined, bodyOverride: rr.action.bodyOverride ? tryParseBody(rr.action.bodyOverride) : undefined, resultHeaders: mh });
      }
    }
    if (bodyObj) { init = init || {}; init.body = JSON.stringify(bodyObj); }

    if (urlChanged && typeof input === "string") {
      input = url;
    } else if (urlChanged && input instanceof Request) {
      var reqInit = { method: init.method, headers: init.headers, body: init.body };
      input = new Request(url, reqInit);
    }

    // Phase 2: Response rules
    var respRules = matched.filter(function (r) { return r.action.type === CONST.ACTION_TYPES.MOCK_RESPONSE || r.action.type === CONST.ACTION_TYPES.MODIFY_RESPONSE; });
    var mockRule = null;
    for (var mi = 0; mi < respRules.length; mi++) {
      if (respRules[mi].action.type === CONST.ACTION_TYPES.MOCK_RESPONSE) { mockRule = respRules[mi]; break; }
    }
    var modRespRules = respRules.filter(function (r) { return r.action.type === CONST.ACTION_TYPES.MODIFY_RESPONSE; });

    if (mockRule && !hasRespBC(mockRule)) {
      reportHit(mockRule.id, url, method);
      logAction("#e74c3c", "FETCH intercepted \u2192 " + mockRule.action.status, method, url, mockRule, { status: mockRule.action.status, delay: mockRule.action.delay + "ms", headers: mockRule.action.headers });
      if (mockRule.action.saveVars) {
        var mockBody = tryParseBody(mockRule.action.body || CONST.DEFAULT_BODY);
        var mockHeaders = mockRule.action.headers || {};
        saveVariables(mockRule.action.saveVars, mockBody, mockHeaders, mockRule.action.status || CONST.DEFAULT_STATUS);
      }
      processVarSavers(url, mockBody, mockHeaders, mockRule.action.status || CONST.DEFAULT_STATUS, "response", reqBody);
      var mockRespBody = resolveVarsInString(mockRule.action.body || "");
      if (mockRule.action.transforms && mockRule.action.transforms.length > 0) {
        var mockObj = parseRespObj(mockRespBody);
        if (mockObj) {
          mockObj = applyBodyTransforms(mockObj, mockRule.action.transforms);
          mockRespBody = JSON.stringify(mockObj);
        }
      }
      reportInterception({
        url: url, method: method, matched: true,
        ruleId: mockRule.id, ruleName: mockRule.name,
        actionType: CONST.ACTION_TYPES.MOCK_RESPONSE,
        status: mockRule.action.status || CONST.DEFAULT_STATUS,
        headers: mockRule.action.headers || {},
        body: mockRespBody,
        delay: mockRule.action.delay || CONST.DEFAULT_DELAY
      }, reqId);

      return new Promise(function (resolve) {
        setTimeout(function () {
          var defHeaders = {};
          defHeaders[CONST.HEADER_CONTENT_TYPE] = CONST.CONTENT_TYPE_JSON;
          resolve(new Response(mockRespBody, { status: mockRule.action.status || CONST.DEFAULT_STATUS, statusText: "", headers: new Headers(mockRule.action.headers || defHeaders) }));
        }, mockRule.action.delay || CONST.DEFAULT_DELAY);
      });
    }

    // Send real request
    var fetchPromise = (typeof input === "string") ? origFetch.call(this, input, init) : origFetch.apply(this, arguments);

    // Need to read body for conditions?
    var needBody = (mockRule && hasRespBC(mockRule)) || modRespRules.some(function (r) { return hasRespBC(r) || (r.action.transforms && r.action.transforms.length > 0); });

    if (needBody) {
      fetchPromise = fetchPromise.then(function (response) {
        return response.text().then(function (responseText) {
          var curText = responseText;
          var curHeaders = new Headers(response.headers);
          var curStatus = response.status;
          var curStatusText = response.statusText;
          var mocked = false;

          if (mockRule && hasRespBC(mockRule) && matchBodyConditions(parseRespObj(curText), mockRule.match.bodyConditions)) {
            reportHit(mockRule.id, url, method);
            logAction("#e74c3c", "FETCH conditional mock \u2192 " + mockRule.action.status, method, url, mockRule, { status: mockRule.action.status, headers: mockRule.action.headers, responseBody: tryParseBody(curText) });
            curText = resolveVarsInString(mockRule.action.body || "");
            curStatus = mockRule.action.status || CONST.DEFAULT_STATUS;
            curStatusText = "";
            var defMockHeaders = {};
            defMockHeaders[CONST.HEADER_CONTENT_TYPE] = CONST.CONTENT_TYPE_JSON;
            curHeaders = new Headers(mockRule.action.headers || defMockHeaders);
            if (mockRule.action.saveVars) {
              saveVariables(mockRule.action.saveVars, tryParseBody(mockRule.action.body || CONST.DEFAULT_BODY), mockRule.action.headers || {}, mockRule.action.status || CONST.DEFAULT_STATUS);
            }
            mocked = true;
            reportInterception({
              url: url, method: method, matched: true,
              ruleId: mockRule.id, ruleName: mockRule.name,
              actionType: CONST.ACTION_TYPES.MOCK_RESPONSE,
              status: curStatus,
              body: curText,
              headers: mockRule.action.headers || {},
              originalBody: responseText
            }, reqId);
          }

          if (!mocked) {
            for (var di = 0; di < modRespRules.length; di++) {
              var dr = modRespRules[di];
              var apply = !hasRespBC(dr) || matchBodyConditions(parseRespObj(curText), dr.match.bodyConditions);
              if (apply) {
                if (dr.action.removeResponseHeaders) dr.action.removeResponseHeaders.forEach(function (h) { curHeaders.delete(h); });
                if (dr.action.setResponseHeaders) Object.keys(dr.action.setResponseHeaders).forEach(function (k) { curHeaders.set(k, dr.action.setResponseHeaders[k]); });
                var respTrans = dr.action.transforms || [];
                if (respTrans.length > 0) {
                  var respObj = parseRespObj(curText);
                  if (respObj) {
                    respObj = applyBodyTransforms(respObj, respTrans);
                    curText = JSON.stringify(respObj);
                  }
                }
                reportHit(dr.id, url, method);
                logAction("#9b59b6", hasRespBC(dr) ? "FETCH conditional modifyResponse" : "FETCH modifyResponse", method, url, dr, { removeHeaders: dr.action.removeResponseHeaders, setHeaders: dr.action.setResponseHeaders, transforms: respTrans });
                 if (dr.action.saveVars) {
                   var respHeaderObj = {};
                   curHeaders.forEach(function(v, k) { respHeaderObj[k] = v; });
                   saveVariables(dr.action.saveVars, parseRespObj(curText), respHeaderObj, curStatus);
                 }
               }
             }
           }

           var hdrObjFinal = {};
          curHeaders.forEach(function(v, k) { hdrObjFinal[k] = v; });
          processVarSavers(url, parseRespObj(curText), hdrObjFinal, curStatus, "response", reqBody);
          reportInterception({
            url: url, method: method, matched: true,
            ruleId: modRespRules.length ? modRespRules[0].id : null,
            ruleName: modRespRules.length ? modRespRules[0].name : null,
            actionType: CONST.ACTION_TYPES.MODIFY_RESPONSE,
            status: curStatus,
            headers: hdrObjFinal,
            body: curText,
            originalBody: responseText
          }, reqId);
          return new Response(curText, { status: curStatus, statusText: curStatusText, headers: curHeaders });
        });
      });
    } else if (modRespRules.length > 0) {
      fetchPromise = fetchPromise.then(function (response) {
        var newHeaders = new Headers(response.headers);
        var hdrObj = {};
        response.headers.forEach(function (v, k) { hdrObj[k] = v; });
        for (var di = 0; di < modRespRules.length; di++) {
          var dr = modRespRules[di];
          if (dr.action.removeResponseHeaders) dr.action.removeResponseHeaders.forEach(function (h) { newHeaders.delete(h); });
          if (dr.action.setResponseHeaders) Object.keys(dr.action.setResponseHeaders).forEach(function (k) { newHeaders.set(k, dr.action.setResponseHeaders[k]); });
          reportHit(dr.id, url, method);
          logAction("#9b59b6", "FETCH modifyResponse", method, url, dr, { removeHeaders: dr.action.removeResponseHeaders, setHeaders: dr.action.setResponseHeaders });
        }
        processVarSavers(url, null, hdrObj, response.status, "response", reqBody);
        reportInterception({
          url: url, method: method, matched: true,
          ruleId: modRespRules.length ? modRespRules[0].id : null,
          ruleName: modRespRules.length ? modRespRules[0].name : null,
          actionType: CONST.ACTION_TYPES.MODIFY_RESPONSE,
          status: response.status,
          headers: hdrObj,
          body: null
        }, reqId);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: newHeaders });
      });
    } else if (respRules.length === 0) {
      fetchPromise = fetchPromise.then(function (response) {
        var hdrObj = {};
        response.headers.forEach(function (v, k) { hdrObj[k] = v; });
        processVarSavers(url, null, hdrObj, response.status, "response", reqBody);
        var hdrObj2 = {};
        response.headers.forEach(function (v, k) { hdrObj2[k] = v; });
        response.clone().text().then(function(text) {
          reportInterception({
            url: url, method: method, matched: reqRules.length > 0,
            ruleId: reqRules.length ? reqRules[0].id : null,
            ruleName: reqRules.length ? reqRules[0].name : null,
            actionType: reqRules.length ? reqRules[0].action.type : null,
            status: response.status, headers: hdrObj2, body: text
          }, reqId);
        });
        return response;
      });
    }

    return fetchPromise;
  };

  // === XHR ===

  OrigXHR.prototype.open = function (method, url) {
    this.__rm = { method: (method || "GET").toUpperCase(), url: resolveUrl(url || "") };
    return origXhrOpen.apply(this, arguments);
  };

  OrigXHR.prototype.setRequestHeader = function (name, value) {
    if (this.__rm) {
      if (!this.__rmReqHeaders) this.__rmReqHeaders = {};
      this.__rmReqHeaders[name] = value;
    }
    return origXhrSetHeader.apply(this, arguments);
  };

  OrigXHR.prototype.$rmHdrs = function () {
    var hdrs = {};
    try {
      this.getAllResponseHeaders().split("\r\n").forEach(function (line) {
        var p = line.split(": ");
        if (p[0]) hdrs[p[0].toLowerCase()] = p.slice(1).join(": ");
      });
    } catch (e) {}
    return hdrs;
  };

  OrigXHR.prototype.send = function (body) {
    var self = this;
    if (!this.__rm) return origXhrSend.apply(this, arguments);

    addSeenRequest(this.__rm.url, this.__rm.method);
    flushSeenRequests();

    var reqBody = parseReqBody(body);
    _currentReq = { headers: self.__rmReqHeaders || {}, body: reqBody ? JSON.stringify(reqBody) : null };
    processVarSavers(self.__rm.url, reqBody, self.__rmReqHeaders || {}, null, "request", reqBody);
    var reqId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    reportInterception({ url: self.__rm.url, method: self.__rm.method, matched: false, pending: true }, reqId);
    var bpRule = (!_bpSkip && masterEnabled) ? findBreakpointRule(self.__rm.url, self.__rm.method) : null;
    _bpSkip = false;

    if (bpRule && bpRule.breakpoint && bpRule.breakpoint.phase === "request") {
      waitForBreakpoint(
        bpRequestPayload(self.__rm.url, self.__rm.method, self.__rmReqHeaders || {}, reqBody)
      ).then(function(result) {
        var finishWrap = function () {
          var origOLEpt = self.onloadend;
          self.onloadend = function (evt) {
            reportInterception({ url: self.__rm.url, method: self.__rm.method, matched: false, status: self.status, headers: self.$rmHdrs(), body: safeRespText(self) }, reqId);
            if (origOLEpt) origOLEpt.call(self, evt);
          };
        };
        if (result.action === "abort") {
          reportInterception({ url: self.__rm.url, method: self.__rm.method, matched: false, status: 0, body: null }, reqId);
          // Nothing was sent (readyState 1), so native abort() stays silent —
          // dispatch the spec abort sequence (abort + loadend, no load) so the
          // page observes the cancellation instead of hanging forever.
          try {
            self.dispatchEvent(new ProgressEvent("abort"));
            self.dispatchEvent(new ProgressEvent("loadend"));
          } catch (e) {}
          return;
        }
        var mods = result.mods || {};
        if (mods.url || mods.method || (mods.body !== undefined && mods.body !== null)) {
          // open() resets headers set via setRequestHeader — replay them after re-open
          self.__rm = {
            method: String(mods.method || self.__rm.method).toUpperCase(),
            url: mods.url || self.__rm.url
          };
          origXhrOpen.call(self, self.__rm.method, self.__rm.url);
          var savedHdrs = self.__rmReqHeaders || {};
          for (var shk in savedHdrs) origXhrSetHeader.call(self, shk, savedHdrs[shk]);
          finishWrap();
          origXhrSend.call(self, mods.body !== undefined && mods.body !== null ? String(mods.body) : body);
          return;
        }
        finishWrap();
        origXhrSend.call(self, body);
      });
      return;
    }

    var matched = findAllRules(self.__rm.url, self.__rm.method, reqBody);
    if (matched.length === 0) {
      var needBpResp = bpRule && bpRule.breakpoint && bpRule.breakpoint.phase === "response";
      var needRespVars = hasMatchingResponseVarSaver(self.__rm.url);
      // Pause BOTH onload and onloadend on one shared gate so the page cannot
      // observe the response before the breakpoint resumes. Note: response body
      // edits are fetch-only — XHR responseText is read-only.
      var bpGatePromise = null;
      var ensureBpGate = function () {
        if (!bpGatePromise) {
          bpGatePromise = waitForBreakpoint({
            phase: "response", url: self.__rm.url, method: self.__rm.method, status: self.status, headers: self.$rmHdrs(), body: safeRespText(self)
          });
        }
        return bpGatePromise;
      };
      var origOLoad = self.onload;
      var origOLEnd = self.onloadend;
      self.onload = function (evt) {
        if (!needBpResp) { if (origOLoad) origOLoad.call(self, evt); return; }
        ensureBpGate().then(function (result) {
          if (result && result.action === "abort") return; // swallow: response already arrived
          if (origOLoad) origOLoad.call(self, evt);
        });
      };
      self.onloadend = function (evt) {
        var proceed = function () {
          reportInterception({ url: self.__rm.url, method: self.__rm.method, matched: false, status: self.status, headers: self.$rmHdrs(), body: safeRespText(self) }, reqId);
          if (origOLEnd) origOLEnd.call(self, evt);
        };
        if (!needBpResp) { proceed(); return; }
        ensureBpGate().then(function (result) {
          if (result && result.action === "abort") {
            reportInterception({ url: self.__rm.url, method: self.__rm.method, matched: false, status: 0, body: null }, reqId);
            return;
          }
          proceed();
        });
      };
      if (needRespVars) {
        var self2 = this;
        var wrappedOnLoadEnd = self.onloadend; // the bp-gated wrapper above
        self.onloadend = function (evt) {
          var hdrs2 = self2.$rmHdrs();
          processVarSavers(self2.__rm.url, parseRespObj(self2.responseText), hdrs2, self2.status, "response", reqBody);
          wrappedOnLoadEnd.call(self2, evt);
        };
      }
      return origXhrSend.apply(this, arguments);
    }

    // Phase 1: Request modifications (modifyBody + modifyRequest)
    var reqRules = matched.filter(function (r) { return r.action.type === CONST.ACTION_TYPES.MODIFY_BODY || r.action.type === CONST.ACTION_TYPES.MODIFY_REQUEST; });
    var bodyObj = reqBody;
    var sendBody = body;
    var urlChanged = false;
    var methodChanged = null;

    for (var ri = 0; ri < reqRules.length; ri++) {
      var rr = reqRules[ri];
      if (rr.action.type === CONST.ACTION_TYPES.MODIFY_BODY) {
        if (!bodyObj && body) bodyObj = parseReqBody(body);
        if (bodyObj) {
          bodyObj = applyBodyTransforms(bodyObj, rr.action.transforms);
          reportHit(rr.id, self.__rm.url, self.__rm.method);
          logAction("#009688", "XHR modifyBody", self.__rm.method, self.__rm.url, rr, { transforms: rr.action.transforms, resultBody: bodyObj });
          sendBody = JSON.stringify(bodyObj);
        }
      } else if (rr.action.type === CONST.ACTION_TYPES.MODIFY_REQUEST) {
        var newUrl = applyUrlModifications(self.__rm.url, rr);
        if (newUrl !== self.__rm.url) {
          self.__rm.url = newUrl;
          urlChanged = true;
        }
        if (rr.action.removeHeaders && self.__rmReqHeaders) {
          rr.action.removeHeaders.forEach(function (h) {
            delete self.__rmReqHeaders[h];
          });
        }
        if (rr.action.setHeaders) {
          if (!self.__rmReqHeaders) self.__rmReqHeaders = {};
          Object.keys(rr.action.setHeaders).forEach(function (k) {
            self.__rmReqHeaders[k] = String(resolveVarValue(rr.action.setHeaders[k]));
          });
        }
        if (rr.action.method) {
          methodChanged = rr.action.method;
          self.__rm.method = rr.action.method.toUpperCase();
        }
        if (rr.action.graphqlQuery) {
          if (!bodyObj && body) bodyObj = parseReqBody(body);
          if (bodyObj && typeof bodyObj === "object") {
            bodyObj.query = rr.action.graphqlQuery;
            sendBody = JSON.stringify(bodyObj);
          }
        }
        if (rr.action.bodyOverride) {
          bodyObj = parseReqBody(rr.action.bodyOverride);
          sendBody = rr.action.bodyOverride;
        }
        if (rr.action.transforms && rr.action.transforms.length > 0) {
          if (!bodyObj && body) bodyObj = parseReqBody(body);
          if (bodyObj) {
            bodyObj = applyBodyTransforms(bodyObj, rr.action.transforms);
            sendBody = JSON.stringify(bodyObj);
          }
        }
        reportHit(rr.id, self.__rm.url, self.__rm.method);
        logAction("#f39c12", "XHR modifyRequest", self.__rm.method, self.__rm.url, rr, {
          removeHeaders: rr.action.removeHeaders,
          setHeaders: rr.action.setHeaders,
          setQueryParams: rr.action.setQueryParams,
          removeQueryParams: rr.action.removeQueryParams,
          method: rr.action.method,
          transforms: rr.action.transforms,
          graphqlQuery: rr.action.graphqlQuery || undefined,
          bodyOverride: rr.action.bodyOverride ? tryParseBody(rr.action.bodyOverride) : undefined,
          requestHeaders: self.__rmReqHeaders || {}
        });
      }
    }

    if (urlChanged || methodChanged) {
      origXhrOpen.call(self, self.__rm.method, self.__rm.url, true);
      if (self.__rmReqHeaders) {
        Object.keys(self.__rmReqHeaders).forEach(function (k) {
          origXhrSetHeader.call(self, k, self.__rmReqHeaders[k]);
        });
      }
    }

    // Phase 2: Response rules
    var respRules = matched.filter(function (r) { return r.action.type === CONST.ACTION_TYPES.MOCK_RESPONSE || r.action.type === CONST.ACTION_TYPES.MODIFY_RESPONSE; });
    if (respRules.length === 0) {
      var origOLE = self.onloadend;
      self.onloadend = function(evt) {
        var hdrs = {};
        try { self.getAllResponseHeaders().split("\r\n").forEach(function(line) { var p = line.split(": "); if (p[0]) hdrs[p[0].toLowerCase()] = p.slice(1).join(": "); }); } catch(e) {}
        processVarSavers(self.__rm.url, parseRespObj(self.responseText), hdrs, self.status, "response", reqBody);
        reportInterception({
          url: self.__rm.url, method: self.__rm.method, matched: reqRules.length > 0,
          ruleId: reqRules.length ? reqRules[0].id : null,
          ruleName: reqRules.length ? reqRules[0].name : null,
          actionType: reqRules.length ? reqRules[0].action.type : null,
          status: self.status, headers: hdrs, body: safeRespText(self)
        }, reqId);
        if (origOLE) origOLE.call(self, evt);
      };
      return origXhrSend.call(self, sendBody);
    }

    var mockRule = null;
    for (var mi = 0; mi < respRules.length; mi++) {
      if (respRules[mi].action.type === CONST.ACTION_TYPES.MOCK_RESPONSE) { mockRule = respRules[mi]; break; }
    }
    var modRespRules = respRules.filter(function (r) { return r.action.type === CONST.ACTION_TYPES.MODIFY_RESPONSE; });

    if (mockRule && !hasRespBC(mockRule)) {
      reportHit(mockRule.id, self.__rm.url, self.__rm.method);
      logAction("#e74c3c", "XHR intercepted \u2192 " + mockRule.action.status, self.__rm.method, self.__rm.url, mockRule, {
        status: mockRule.action.status,
        delay: mockRule.action.delay + "ms",
        headers: mockRule.action.headers
      });
      if (mockRule.action.saveVars) {
        saveVariables(mockRule.action.saveVars, tryParseBody(mockRule.action.body || CONST.DEFAULT_BODY), mockRule.action.headers || {}, mockRule.action.status || CONST.DEFAULT_STATUS);
      }
      processVarSavers(self.__rm.url, tryParseBody(mockRule.action.body || CONST.DEFAULT_BODY), mockRule.action.headers || {}, mockRule.action.status || CONST.DEFAULT_STATUS, "response", reqBody);
        reportInterception({
          url: self.__rm.url, method: self.__rm.method, matched: true,
          ruleId: mockRule.id, ruleName: mockRule.name,
          actionType: CONST.ACTION_TYPES.MOCK_RESPONSE,
          status: mockRule.action.status || CONST.DEFAULT_STATUS,
          headers: mockRule.action.headers || {},
          body: mockRule.action.body || CONST.DEFAULT_BODY,
          delay: mockRule.action.delay || CONST.DEFAULT_DELAY
        }, reqId);
      mockXhrResponse(self, mockRule, mockRule.action.delay || CONST.DEFAULT_DELAY);
      return;
    }

    // Intercept response for conditional mock + modifyResponse
    var origORSC = self.onreadystatechange;
    var origOnLoad = self.onload;
    var origOnLoadEnd = self.onloadend;
    var respHandled = false;
    var needBody = (mockRule && hasRespBC(mockRule)) || modRespRules.some(function (r) { return hasRespBC(r) || (r.action.transforms && r.action.transforms.length > 0); });

    function handleResponseMods() {
      if (respHandled) return;
      respHandled = true;
      var respObj = needBody ? parseRespObj(self.responseText) : null;
      var curText = self.responseText;
    var origText = curText;
      var mocked = false;

      if (mockRule && hasRespBC(mockRule) && matchBodyConditions(respObj, mockRule.match.bodyConditions)) {
        var ms = mockRule.action.status || CONST.DEFAULT_STATUS;
        var mb = resolveVarsInString(mockRule.action.body || "");
        var mh = mockRule.action.headers || {};
        try { Object.defineProperty(self, 'status', { value: ms, configurable: true, writable: true }); } catch(e) {}
        try { Object.defineProperty(self, 'statusText', { value: '', configurable: true, writable: true }); } catch(e) {}
        try { Object.defineProperty(self, 'responseText', { value: mb, configurable: true, writable: true }); } catch(e) {}
        try { Object.defineProperty(self, 'response', { value: mb, configurable: true, writable: true }); } catch(e) {}
        self.getResponseHeader = function(name) {
          var lower = name.toLowerCase();
          for (var k in mh) { if (k.toLowerCase() === lower) return mh[k]; }
          return null;
        };
        self.getAllResponseHeaders = function() {
          return Object.keys(mh).map(function(k) { return k.toLowerCase() + ": " + mh[k]; }).join("\r\n");
        };
        reportHit(mockRule.id, self.__rm.url, self.__rm.method);
        logAction("#e74c3c", "XHR conditional mock \u2192 " + ms, self.__rm.method, self.__rm.url, mockRule, { status: ms, headers: mh, responseBody: tryParseBody(self.responseText) });
        if (mockRule.action.saveVars) {
          saveVariables(mockRule.action.saveVars, tryParseBody(mb), mh, ms);
        }
        mocked = true;
        reportInterception({
          url: self.__rm.url, method: self.__rm.method, matched: true,
          ruleId: mockRule.id, ruleName: mockRule.name,
          actionType: CONST.ACTION_TYPES.MOCK_RESPONSE,
          status: ms,
          body: mb,
          headers: mh,
          originalBody: origText
        }, reqId);
      }

      if (!mocked && modRespRules.length > 0) {
        var origGH = self.getResponseHeader;
        var origGAH = self.getAllResponseHeaders;
        var allRemove = [];
        var allSet = {};
        for (var di = 0; di < modRespRules.length; di++) {
          var dr = modRespRules[di];
          var apply = !hasRespBC(dr) || matchBodyConditions(respObj, dr.match.bodyConditions);
          if (apply) {
            if (dr.action.removeResponseHeaders) allRemove = allRemove.concat(dr.action.removeResponseHeaders);
            if (dr.action.setResponseHeaders) {
              for (var k in dr.action.setResponseHeaders) allSet[k.toLowerCase()] = String(resolveVarValue(dr.action.setResponseHeaders[k]));
            }
            if (dr.action.transforms && dr.action.transforms.length > 0 && respObj) {
              respObj = applyBodyTransforms(respObj, dr.action.transforms);
              curText = JSON.stringify(respObj);
            }
            reportHit(dr.id, self.__rm.url, self.__rm.method);
            logAction("#9b59b6", hasRespBC(dr) ? "XHR conditional modifyResponse" : "XHR modifyResponse", self.__rm.method, self.__rm.url, dr, {
              removeHeaders: dr.action.removeResponseHeaders,
              setHeaders: dr.action.setResponseHeaders,
              transforms: dr.action.transforms
            });
            if (dr.action.saveVars) {
              var xhHeaders = {};
              if (allSet) Object.keys(allSet).forEach(function(k) { xhHeaders[k] = allSet[k]; });
              saveVariables(dr.action.saveVars, parseRespObj(curText), xhHeaders, self.status);
            }
          }
        }
        if (allRemove.length > 0 || Object.keys(allSet).length > 0) {
          self.getResponseHeader = function(name) {
            var lower = name.toLowerCase();
            if (allRemove.some(function(h) { return h.toLowerCase() === lower; })) return null;
            if (allSet[lower] !== undefined) return allSet[lower];
            return origGH.call(self, name);
          };
          self.getAllResponseHeaders = function() {
            var raw = origGAH.call(self);
            if (!raw) return raw;
            var result = raw;
            allRemove.forEach(function(h) {
              var re = new RegExp(h.toLowerCase() + ": [^\\r]*\\r?\\n?", "gi");
              result = result.replace(re, "");
            });
            for (var k in allSet) {
              var re2 = new RegExp(k + ": [^\\r]*\\r?\\n?", "gi");
              result = result.replace(re2, "");
              result += k + ": " + allSet[k] + "\r\n";
            }
            return result;
          };
        }
        if (curText !== self.responseText) {
          try { Object.defineProperty(self, 'responseText', { value: curText, configurable: true, writable: true }); } catch(e) {}
          try { Object.defineProperty(self, 'response', { value: curText, configurable: true, writable: true }); } catch(e) {}
        }
      }

      var xhHdrsFinal = {};
      try { self.getAllResponseHeaders().split("\r\n").forEach(function(line) { var p = line.split(": "); if (p[0]) xhHdrsFinal[p[0].toLowerCase()] = p.slice(1).join(": "); }); } catch(e) {}
      reportInterception({
        url: self.__rm.url, method: self.__rm.method, matched: true,
        ruleId: modRespRules.length ? modRespRules[0].id : null,
        ruleName: modRespRules.length ? modRespRules[0].name : null,
        actionType: CONST.ACTION_TYPES.MODIFY_RESPONSE,
        status: self.status,
        headers: xhHdrsFinal,
        body: curText,
        originalBody: origText
      }, reqId);
      processVarSavers(self.__rm.url, parseRespObj(self.responseText), xhHdrsFinal, self.status, "response", reqBody);
    }

    self.onreadystatechange = function(evt) {
      if (self.readyState === 4) handleResponseMods();
      if (origORSC) origORSC.call(self, evt);
    };
    self.onload = function(evt) {
      handleResponseMods();
      if (origOnLoad) origOnLoad.call(self, evt);
    };
    self.onloadend = function(evt) {
      if (origOnLoadEnd) origOnLoadEnd.call(self, evt);
    };

    return origXhrSend.call(self, sendBody);
  };

  function mockXhrResponse(xhr, rule, delay) {
    var action = rule.action;
    var status = action.status || CONST.DEFAULT_STATUS;
    var body = resolveVarsInString(action.body || "");
    if (action.transforms && action.transforms.length > 0) {
      var obj = parseRespObj(body);
      if (obj) {
        obj = applyBodyTransforms(obj, action.transforms);
        body = JSON.stringify(obj);
      }
    }
    var headers = action.headers || {};

    setTimeout(function () {
      var defs = {
        readyState: 4,
        status: status,
        statusText: "",
        responseText: body,
        response: body,
        responseURL: xhr.__rm.url
      };

      for (var key in defs) {
        try {
          Object.defineProperty(xhr, key, {
            value: defs[key],
            configurable: true,
            writable: true
          });
        } catch (e) {}
      }

      xhr.getResponseHeader = function (name) {
        var lower = name.toLowerCase();
        for (var k in headers) {
          if (k.toLowerCase() === lower) return headers[k];
        }
        return null;
      };

      xhr.getAllResponseHeaders = function () {
        return Object.keys(headers)
          .map(function (k) {
            return k.toLowerCase() + ": " + headers[k];
          })
          .join("\r\n");
      };

      ["readystatechange", "load", "loadend"].forEach(function (evtName) {
        var evt = new ProgressEvent(evtName);
        try {
          xhr.dispatchEvent(evt);
        } catch (e) {}
        var handler = xhr["on" + evtName];
        if (typeof handler === "function") {
          try { handler(evt); } catch (e) {}
        }
      });
    }, delay || CONST.DEFAULT_DELAY);
  }

  // === BREAKPOINTS ===

  var _pendingBreakpoints = {};

  function waitForBreakpoint(data) {
    var bpMsgId = "bp_" + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    return new Promise(function (resolve) {
      _pendingBreakpoints[bpMsgId] = resolve;
      window.postMessage({ type: CONST.PAGE_MSG.BREAKPOINT_HIT, bpMsgId: bpMsgId, data: data }, "*");
    });
  }

  // Builds the request-phase breakpoint payload sent to the panel. The body
  // MUST be a string: the panel renders it as text and diffs it verbatim on
  // resume. Sending the parsed object corrupted untouched bodies to
  // "[object Object]" on every plain resume.
  function findBreakpointRule(url, method) {
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.type !== "breakpoint" || r.enabled === false) continue;
      if (!r.match || !r.match.urlPattern) continue; // malformed rule must not break fetch
      if (!globToRegex(r.match.urlPattern).test(url)) continue;
      if (r.match.method && r.match.method !== "ANY" && r.match.method !== method) continue;
      return r;
    }
    return null;
  }

  function bpRequestPayload(url, method, headers, reqBody) {
    return {
      phase: "request", url: url, method: method, headers: headers || {},
      body: reqBody == null ? null : (typeof reqBody === "string" ? reqBody : JSON.stringify(reqBody))
    };
  }

  // Applies user edits from a resumed request-phase breakpoint to fetch args.
  // Pure: no side effects, returns new {input, init}.
  // `origBodyText` is the body captured at pause time (Request-form calls);
  // used to rebuild the Request when only the URL is edited.
  function applyBpRequestMods(input, init, mods, origBodyText) {
    if (!mods) return { input: input, init: init };
    init = init ? Object.assign({}, init) : {};
    if (init.headers && typeof init.headers.forEach !== "function") {
      init.headers = Object.assign({}, init.headers);
    }
    if (mods.method) init.method = String(mods.method).toUpperCase();
    if (mods.body !== undefined && mods.body !== null) init.body = String(mods.body);
    if (mods.url) {
      if (typeof input === "string") {
        input = mods.url;
      } else if (typeof Request !== "undefined" && typeof input === "object" && input !== null && input instanceof Request) {
        // Request url is immutable. Rebuild from plain options: headers,
        // credentials and mode carry over; body only when captured (a string
        // is the one thing a sync seam can pass). `new Request(url, request)`
        // is NOT used: Chromium disturbs the input there and the clone then
        // fails to send ("Failed to fetch"). init edits (method/body from the
        // panel) still win at the subsequent fetch(input, init) per spec.
        var opts = {
          method: init.method || input.method,
          headers: new Headers(input.headers),
          credentials: input.credentials,
          mode: input.mode,
          cache: input.cache,
          redirect: input.redirect
        };
        if (origBodyText != null) opts.body = origBodyText;
        try { input = new Request(mods.url, opts); } catch (e) {}
      }
    }
    return { input: input, init: init };
  }

  // Builds a replacement Response from user edits of a response-phase
  // breakpoint. Returns null when nothing effectively changed — the caller
  // then keeps the original response object.
  function buildBpResponse(origStatus, origHeaders, origBody, mods) {
    if (!mods) return null;
    var status = origStatus;
    if (mods.status !== undefined && mods.status !== null && String(mods.status).trim() !== "") {
      var parsed = parseInt(mods.status, 10);
      if (parsed >= 200 && parsed <= 599) status = parsed; // Response ctor range
    }
    var body = (mods.body !== undefined && mods.body !== null) ? String(mods.body) : origBody;
    if (status === origStatus && body === origBody) return null;
    if (status === 204 || status === 205 || status === 304) body = null; // bodyless statuses
    try {
      return new Response(body, { status: status, headers: new Headers(origHeaders || {}) });
    } catch (e) {
      return null;
    }
  }

  // === COMMUNICATION ===

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    if (event.data && event.data.type === CONST.PAGE_MSG.RULES) {
      rules = event.data.rules || [];
      varSavers = event.data.varSavers || [];
      var incomingTabVars = event.data.tabVars || {};
      if (Object.keys(tabVars).length === 0 && Object.keys(incomingTabVars).length > 0) {
        tabVars = incomingTabVars;
      }
      var activeVarNames = {};
      varSavers.forEach(function (vs) {
        if (vs.varName && vs.enabled) activeVarNames[vs.varName] = true;
      });
      var cleaned = {};
      for (var vn in tabVars) {
        if (activeVarNames[vn]) cleaned[vn] = tabVars[vn];
      }
      tabVars = cleaned;
      masterEnabled = event.data.masterEnabled !== false;
    }
    if (event.data && event.data.type === CONST.PAGE_MSG.BREAKPOINT_RESUME) {
      var bpResolve = _pendingBreakpoints[event.data.bpMsgId];
      if (bpResolve) {
        delete _pendingBreakpoints[event.data.bpMsgId];
        var result = event.data.result || { action: "resume" };
        if (result.vars) {
          for (var vk in result.vars) tabVars[vk.startsWith("$") ? vk : "$" + vk] = result.vars[vk];
        }
        bpResolve(result);
      }
    }
  });

  window.postMessage({ type: CONST.PAGE_MSG.INIT }, "*");
  // Test-only export. Inert in production: globalThis.__RM_TEST_EXPORT is
  // undefined in the browser, so this never runs outside the Node test harness.
  if (typeof globalThis !== "undefined" && typeof globalThis.__RM_TEST_EXPORT === "function") {
    globalThis.__RM_TEST_EXPORT({
      globToRegex: globToRegex,
      parseGraphQL: parseGraphQL,
      findAllRules: findAllRules,
      splitPath: splitPath,
      getByPath: getByPath,
      setByPath: setByPath,
      matchBodyConditions: matchBodyConditions,
      resolveVarsInString: resolveVarsInString,
      applyBodyTransforms: applyBodyTransforms,
      parseValue: parseValue,
      matchVarConditions: matchVarConditions,
      saveVariables: saveVariables,
      processVarSavers: processVarSavers,
      hasMatchingResponseVarSaver: hasMatchingResponseVarSaver,
      findBreakpointRule: findBreakpointRule,
      bpRequestPayload: bpRequestPayload,
      applyBpRequestMods: applyBpRequestMods,
      buildBpResponse: buildBpResponse,
      _setRuntime: function (r, vs, tv, me) { rules = r || []; varSavers = vs || []; tabVars = tv || {}; masterEnabled = me !== false; }
    });
  }
})();
