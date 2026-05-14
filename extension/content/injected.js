(function () {
  var AT = {
    MOCK_RESPONSE: "mockResponse",
    MODIFY_REQUEST: "modifyRequest",
    MODIFY_RESPONSE: "modifyResponse",
    MODIFY_BODY: "modifyBody"
  };
  var DEFAULT_STATUS = 200;
  var DEFAULT_DELAY = 0;
  var DEFAULT_BODY = "{}";
  var CT_JSON = "application/json";
  var CT_HEADER = "Content-Type";
  var SEEN_MAX = 100;
  var PAGE_MSG = {
    RULES: "REQUEST_MOCKER_RULES",
    INIT: "REQUEST_MOCKER_INIT",
    HIT: "REQUEST_MOCKER_HIT",
    SEEN: "REQUEST_MOCKER_SEEN"
  };

  var rules = [];
  var varSavers = [];
  var masterEnabled = true;
  var seenRequests = [];
  var tabVars = {};
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

  function globToRegex(pattern) {
    var escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    escaped = escaped.replace(/\*/g, ".*");
    return new RegExp("^" + escaped + "$", "i");
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
      if (!rule.match || !rule.match.urlPattern) continue;
      var regex = globToRegex(rule.match.urlPattern);
      if (!regex.test(url)) continue;
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
      if (at === AT.MODIFY_BODY || at === AT.MODIFY_REQUEST) {
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
    if (seenRequests.length > SEEN_MAX) seenRequests.shift();
  }

  var seenTimer = null;
  function flushSeenRequests() {
    if (seenTimer) return;
    seenTimer = setTimeout(function () {
      seenTimer = null;
      window.postMessage({ type: PAGE_MSG.SEEN, requests: seenRequests }, "*");
    }, 500);
  }

  function reportHit(ruleId, url, method) {
    window.postMessage({
      type: PAGE_MSG.HIT,
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

  function parseValue(str) {
    if (str === "true") return true;
    if (str === "false") return false;
    if (str === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(str)) return Number(str);
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
    if (c.operator === "exists") return val !== undefined;
    if (c.operator === "equals") return val === parseValue(c.value);
    if (c.operator === "notEquals") return val !== parseValue(c.value);
    if (c.operator === "contains") {
      if (typeof val === "string") return val.indexOf(c.value) !== -1;
      if (Array.isArray(val)) return val.indexOf(parseValue(c.value)) !== -1;
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

  function applyBodyTransforms(body, transforms) {
    if (!transforms || !transforms.length) return body;
    for (var i = 0; i < transforms.length; i++) {
      var t = transforms[i];
      setByPath(body, t.path, parseValue(resolveVarValue(t.value)));
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
      (rule.action.type === AT.MOCK_RESPONSE || rule.action.type === AT.MODIFY_RESPONSE);
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

  function processVarSavers(url, respBody, respHeaders, statusCode) {
    if (!varSavers || !varSavers.length) return;
    for (var i = 0; i < varSavers.length; i++) {
      var vs = varSavers[i];
      if (!vs.enabled) continue;
      var regex = globToRegex(vs.urlPattern);
      if (!regex.test(url)) continue;
      var val;
      if (vs.source === "status") {
        val = statusCode;
      } else if (vs.source === "header") {
        val = respHeaders ? respHeaders[vs.path] || respHeaders[vs.path.toLowerCase()] : undefined;
      } else {
        if (respBody && typeof respBody === "object") {
          val = getByPath(respBody, vs.path);
        }
      }
      if (val !== undefined) {
        tabVars[vs.varName] = val;
        console.log(
          "%c[MockerJoker]%c var saved: " + vs.varName + " = " + JSON.stringify(val),
          "background:#8e44ad;color:#fff;padding:2px 6px;border-radius:3px",
          "color:#8e44ad;font-weight:bold"
        );
      }
    }
  }

  function logAction(bg, label, method, url, rule, extra) {
    var obj = { rule: rule.name };
    if (extra) {
      var keys = Object.keys(extra);
      for (var i = 0; i < keys.length; i++) obj[keys[i]] = extra[keys[i]];
    }
    if (rule.action.body !== undefined) obj.body = tryParseBody(rule.action.body);
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

    var matched = findAllRules(url, method, reqBody);
    if (matched.length === 0) return origFetch.apply(this, arguments);

    // Phase 1: Request modifications (modifyBody + modifyRequest)
    var reqRules = matched.filter(function (r) { return r.action.type === AT.MODIFY_BODY || r.action.type === AT.MODIFY_REQUEST; });
    var bodyObj = reqBody;
    var urlChanged = false;
    for (var ri = 0; ri < reqRules.length; ri++) {
      var rr = reqRules[ri];
      if (rr.action.type === AT.MODIFY_BODY) {
        if (!bodyObj && init && init.body) bodyObj = parseReqBody(init.body);
        if (bodyObj) {
          bodyObj = applyBodyTransforms(bodyObj, rr.action.transforms);
          reportHit(rr.id, url, method);
          logAction("#009688", "FETCH modifyBody", method, url, rr, { transforms: rr.action.transforms, resultBody: bodyObj });
        }
      } else if (rr.action.type === AT.MODIFY_REQUEST) {
        var newUrl = applyUrlModifications(url, rr);
        if (newUrl !== url) { url = newUrl; urlChanged = true; }
        init = applyRequestModifications(init, rr);
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
        logAction("#f39c12", "FETCH modifyRequest", method, url, rr, { removeHeaders: rr.action.removeHeaders, setHeaders: rr.action.setHeaders, setQueryParams: rr.action.setQueryParams, removeQueryParams: rr.action.removeQueryParams, method: rr.action.method, transforms: rr.action.transforms, resultHeaders: mh });
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
    var respRules = matched.filter(function (r) { return r.action.type === AT.MOCK_RESPONSE || r.action.type === AT.MODIFY_RESPONSE; });
    var mockRule = null;
    for (var mi = 0; mi < respRules.length; mi++) {
      if (respRules[mi].action.type === AT.MOCK_RESPONSE) { mockRule = respRules[mi]; break; }
    }
    var modRespRules = respRules.filter(function (r) { return r.action.type === AT.MODIFY_RESPONSE; });

    if (mockRule && !hasRespBC(mockRule)) {
      reportHit(mockRule.id, url, method);
      logAction("#e74c3c", "FETCH intercepted \u2192 " + mockRule.action.status, method, url, mockRule, { status: mockRule.action.status, delay: mockRule.action.delay + "ms", headers: mockRule.action.headers });
      if (mockRule.action.saveVars) {
        var mockBody = tryParseBody(mockRule.action.body || DEFAULT_BODY);
        var mockHeaders = mockRule.action.headers || {};
        saveVariables(mockRule.action.saveVars, mockBody, mockHeaders, mockRule.action.status || DEFAULT_STATUS);
      }
      processVarSavers(url, mockBody, mockHeaders, mockRule.action.status || DEFAULT_STATUS);
      var mockRespBody = mockRule.action.body || "";
      if (mockRule.action.transforms && mockRule.action.transforms.length > 0) {
        var mockObj = parseRespObj(mockRespBody);
        if (mockObj) {
          mockObj = applyBodyTransforms(mockObj, mockRule.action.transforms);
          mockRespBody = JSON.stringify(mockObj);
        }
      }
      return new Promise(function (resolve) {
        setTimeout(function () {
          var defHeaders = {};
          defHeaders[CT_HEADER] = CT_JSON;
          resolve(new Response(mockRespBody, { status: mockRule.action.status || DEFAULT_STATUS, statusText: "", headers: new Headers(mockRule.action.headers || defHeaders) }));
        }, mockRule.action.delay || DEFAULT_DELAY);
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
            curText = mockRule.action.body || "";
            curStatus = mockRule.action.status || DEFAULT_STATUS;
            curStatusText = "";
            var defMockHeaders = {};
            defMockHeaders[CT_HEADER] = CT_JSON;
            curHeaders = new Headers(mockRule.action.headers || defMockHeaders);
            if (mockRule.action.saveVars) {
              saveVariables(mockRule.action.saveVars, tryParseBody(mockRule.action.body || DEFAULT_BODY), mockRule.action.headers || {}, mockRule.action.status || DEFAULT_STATUS);
            }
            mocked = true;
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
          processVarSavers(url, parseRespObj(curText), hdrObjFinal, curStatus);
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
        processVarSavers(url, null, hdrObj, response.status);
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: newHeaders });
      });
    } else if (respRules.length === 0) {
      fetchPromise = fetchPromise.then(function (response) {
        var hdrObj = {};
        response.headers.forEach(function (v, k) { hdrObj[k] = v; });
        processVarSavers(url, null, hdrObj, response.status);
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

  OrigXHR.prototype.send = function (body) {
    var self = this;
    if (!this.__rm) return origXhrSend.apply(this, arguments);

    addSeenRequest(this.__rm.url, this.__rm.method);
    flushSeenRequests();

    var reqBody = parseReqBody(body);
    var matched = findAllRules(this.__rm.url, this.__rm.method, reqBody);
    if (matched.length === 0) return origXhrSend.apply(this, arguments);

    // Phase 1: Request modifications (modifyBody + modifyRequest)
    var reqRules = matched.filter(function (r) { return r.action.type === AT.MODIFY_BODY || r.action.type === AT.MODIFY_REQUEST; });
    var bodyObj = reqBody;
    var sendBody = body;
    var urlChanged = false;
    var methodChanged = null;

    for (var ri = 0; ri < reqRules.length; ri++) {
      var rr = reqRules[ri];
      if (rr.action.type === AT.MODIFY_BODY) {
        if (!bodyObj && body) bodyObj = parseReqBody(body);
        if (bodyObj) {
          bodyObj = applyBodyTransforms(bodyObj, rr.action.transforms);
          reportHit(rr.id, self.__rm.url, self.__rm.method);
          logAction("#009688", "XHR modifyBody", self.__rm.method, self.__rm.url, rr, { transforms: rr.action.transforms, resultBody: bodyObj });
          sendBody = JSON.stringify(bodyObj);
        }
      } else if (rr.action.type === AT.MODIFY_REQUEST) {
        var newUrl = applyUrlModifications(self.__rm.url, rr);
        if (newUrl !== self.__rm.url) {
          self.__rm.url = newUrl;
          urlChanged = true;
        }
        if (rr.action.setHeaders) {
          Object.keys(rr.action.setHeaders).forEach(function (k) {
            origXhrSetHeader.call(self, k, rr.action.setHeaders[k]);
          });
        }
        if (rr.action.method) {
          methodChanged = rr.action.method;
          self.__rm.method = rr.action.method.toUpperCase();
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
    var respRules = matched.filter(function (r) { return r.action.type === AT.MOCK_RESPONSE || r.action.type === AT.MODIFY_RESPONSE; });
    if (respRules.length === 0) {
      var origOLE = self.onloadend;
      self.onloadend = function(evt) {
        var hdrs = {};
        try { self.getAllResponseHeaders().split("\r\n").forEach(function(line) { var p = line.split(": "); if (p[0]) hdrs[p[0].toLowerCase()] = p.slice(1).join(": "); }); } catch(e) {}
        processVarSavers(self.__rm.url, parseRespObj(self.responseText), hdrs, self.status);
        if (origOLE) origOLE.call(self, evt);
      };
      return origXhrSend.call(self, sendBody);
    }

    var mockRule = null;
    for (var mi = 0; mi < respRules.length; mi++) {
      if (respRules[mi].action.type === AT.MOCK_RESPONSE) { mockRule = respRules[mi]; break; }
    }
    var modRespRules = respRules.filter(function (r) { return r.action.type === AT.MODIFY_RESPONSE; });

    if (mockRule && !hasRespBC(mockRule)) {
      reportHit(mockRule.id, self.__rm.url, self.__rm.method);
      logAction("#e74c3c", "XHR intercepted \u2192 " + mockRule.action.status, self.__rm.method, self.__rm.url, mockRule, {
        status: mockRule.action.status,
        delay: mockRule.action.delay + "ms",
        headers: mockRule.action.headers
      });
      if (mockRule.action.saveVars) {
        saveVariables(mockRule.action.saveVars, tryParseBody(mockRule.action.body || DEFAULT_BODY), mockRule.action.headers || {}, mockRule.action.status || DEFAULT_STATUS);
      }
      processVarSavers(self.__rm.url, tryParseBody(mockRule.action.body || DEFAULT_BODY), mockRule.action.headers || {}, mockRule.action.status || DEFAULT_STATUS);
      mockXhrResponse(self, mockRule, mockRule.action.delay || DEFAULT_DELAY);
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
      var mocked = false;

      if (mockRule && hasRespBC(mockRule) && matchBodyConditions(respObj, mockRule.match.bodyConditions)) {
        var ms = mockRule.action.status || DEFAULT_STATUS;
        var mb = mockRule.action.body || "";
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
              for (var k in dr.action.setResponseHeaders) allSet[k.toLowerCase()] = dr.action.setResponseHeaders[k];
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
      processVarSavers(self.__rm.url, parseRespObj(self.responseText), xhHdrsFinal, self.status);
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
    var status = action.status || DEFAULT_STATUS;
    var body = action.body || "";
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
    }, delay || DEFAULT_DELAY);
  }

  // === COMMUNICATION ===

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    if (event.data && event.data.type === PAGE_MSG.RULES) {
      rules = event.data.rules || [];
      varSavers = event.data.varSavers || [];
      masterEnabled = event.data.masterEnabled !== false;
    }
  });

  window.postMessage({ type: PAGE_MSG.INIT }, "*");
})();
