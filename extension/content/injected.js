(function () {
  var rules = [];
  var masterEnabled = true;
  var seenRequests = [];
  var SEEN_MAX = 100;
  var ruleCallCounts = {};

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
        if (!gql || !gql.operationName) continue;
        var opRegex = globToRegex(rule.match.graphqlOperation);
        if (!opRegex.test(gql.operationName)) continue;
      }
      var at = rule.action && rule.action.type;
      if (at === "modifyBody" || at === "modifyRequest") {
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
      window.postMessage({ type: "REQUEST_MOCKER_SEEN", requests: seenRequests }, "*");
    }, 500);
  }

  function reportHit(ruleId, url, method) {
    window.postMessage({
      type: "REQUEST_MOCKER_HIT",
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

  function applyBodyTransforms(body, transforms) {
    if (!transforms || !transforms.length) return body;
    for (var i = 0; i < transforms.length; i++) {
      var t = transforms[i];
      setByPath(body, t.path, parseValue(t.value));
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
      (rule.action.type === "mockResponse" || rule.action.type === "modifyResponse");
  }

  function parseRespObj(text) {
    if (!text) return null;
    try { return JSON.parse(text); } catch(e) { return null; }
  }

  function getCallCount(ruleId) {
    return ruleCallCounts[ruleId] || 0;
  }

  function incrementCallCount(ruleId) {
    ruleCallCounts[ruleId] = (ruleCallCounts[ruleId] || 0) + 1;
    return ruleCallCounts[ruleId];
  }

  function getStep(rule) {
    if (!rule.action.steps || rule.action.steps.length <= 1) return null;
    var count = getCallCount(rule.id);
    var last = rule.action.steps.length - 1;
    if (count >= last) return rule.action.steps[last];
    return rule.action.steps[count];
  }

  function getStepForUse(rule) {
    var step = getStep(rule);
    var count = incrementCallCount(rule.id);
    if (rule.action.steps && rule.action.steps.length > 1) {
      var last = rule.action.steps.length - 1;
      var mode = rule.action.stepsMode || "repeat";
      if (count > last && mode === "repeat") {
        ruleCallCounts[rule.id] = 0;
      }
    }
    return step;
  }

  function mockActionData(rule, step) {
    if (step) {
      return {
        status: step.status !== undefined ? step.status : (rule.action.status || 200),
        body: step.body !== undefined ? step.body : (rule.action.body || ""),
        headers: step.headers || rule.action.headers || { "Content-Type": "application/json" },
        delay: step.delay !== undefined ? step.delay : (rule.action.delay || 0)
      };
    }
    return {
      status: rule.action.status || 200,
      body: rule.action.body || "",
      headers: rule.action.headers || { "Content-Type": "application/json" },
      delay: rule.action.delay || 0
    };
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
        headers.set(k, rule.action.setHeaders[k]);
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
          urlObj.searchParams.set(k, rule.action.setQueryParams[k]);
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
    var reqRules = matched.filter(function (r) { return r.action.type === "modifyBody" || r.action.type === "modifyRequest"; });
    var bodyObj = reqBody;
    var urlChanged = false;
    for (var ri = 0; ri < reqRules.length; ri++) {
      var rr = reqRules[ri];
      if (rr.action.type === "modifyBody") {
        if (!bodyObj && init && init.body) bodyObj = parseReqBody(init.body);
        if (bodyObj) {
          bodyObj = applyBodyTransforms(bodyObj, rr.action.transforms);
          reportHit(rr.id, url, method);
          logAction("#009688", "FETCH modifyBody", method, url, rr, { transforms: rr.action.transforms, resultBody: bodyObj });
        }
      } else if (rr.action.type === "modifyRequest") {
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
    var respRules = matched.filter(function (r) { return r.action.type === "mockResponse" || r.action.type === "modifyResponse"; });
    var mockRule = null;
    for (var mi = 0; mi < respRules.length; mi++) {
      if (respRules[mi].action.type === "mockResponse") { mockRule = respRules[mi]; break; }
    }
    var modRespRules = respRules.filter(function (r) { return r.action.type === "modifyResponse"; });

    // Immediate mock (no body conditions, no steps needing body)
    if (mockRule && !hasRespBC(mockRule)) {
      var step = getStepForUse(mockRule);
      var md = mockActionData(mockRule, step);
      var rh = md.headers;
      reportHit(mockRule.id, url, method);
      logAction("#e74c3c", "FETCH intercepted \u2192 " + md.status, method, url, mockRule, { status: md.status, delay: md.delay + "ms", headers: rh, step: step ? "step " + getCallCount(mockRule.id) : null });
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve(new Response(md.body, { status: md.status, statusText: "", headers: new Headers(rh) }));
        }, md.delay || 5);
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
            var step2 = getStepForUse(mockRule);
            var md2 = mockActionData(mockRule, step2);
            var mrh = md2.headers;
            reportHit(mockRule.id, url, method);
            logAction("#e74c3c", "FETCH conditional mock \u2192 " + md2.status, method, url, mockRule, { status: md2.status, headers: mrh, responseBody: tryParseBody(curText), step: step2 ? "step " + getCallCount(mockRule.id) : null });
            curText = md2.body;
            curStatus = md2.status;
            curStatusText = "";
            curHeaders = new Headers(mrh);
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
              }
            }
          }

          return new Response(curText, { status: curStatus, statusText: curStatusText, headers: curHeaders });
        });
      });
    } else if (modRespRules.length > 0) {
      fetchPromise = fetchPromise.then(function (response) {
        var newHeaders = new Headers(response.headers);
        for (var di = 0; di < modRespRules.length; di++) {
          var dr = modRespRules[di];
          if (dr.action.removeResponseHeaders) dr.action.removeResponseHeaders.forEach(function (h) { newHeaders.delete(h); });
          if (dr.action.setResponseHeaders) Object.keys(dr.action.setResponseHeaders).forEach(function (k) { newHeaders.set(k, dr.action.setResponseHeaders[k]); });
          reportHit(dr.id, url, method);
          logAction("#9b59b6", "FETCH modifyResponse", method, url, dr, { removeHeaders: dr.action.removeResponseHeaders, setHeaders: dr.action.setResponseHeaders });
        }
        return new Response(response.body, { status: response.status, statusText: response.statusText, headers: newHeaders });
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
    var reqRules = matched.filter(function (r) { return r.action.type === "modifyBody" || r.action.type === "modifyRequest"; });
    var bodyObj = reqBody;
    var sendBody = body;
    var urlChanged = false;
    var methodChanged = null;

    for (var ri = 0; ri < reqRules.length; ri++) {
      var rr = reqRules[ri];
      if (rr.action.type === "modifyBody") {
        if (!bodyObj && body) bodyObj = parseReqBody(body);
        if (bodyObj) {
          bodyObj = applyBodyTransforms(bodyObj, rr.action.transforms);
          reportHit(rr.id, self.__rm.url, self.__rm.method);
          logAction("#009688", "XHR modifyBody", self.__rm.method, self.__rm.url, rr, { transforms: rr.action.transforms, resultBody: bodyObj });
          sendBody = JSON.stringify(bodyObj);
        }
      } else if (rr.action.type === "modifyRequest") {
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
    var respRules = matched.filter(function (r) { return r.action.type === "mockResponse" || r.action.type === "modifyResponse"; });
    if (respRules.length === 0) {
      return origXhrSend.call(self, sendBody);
    }

    var mockRule = null;
    for (var mi = 0; mi < respRules.length; mi++) {
      if (respRules[mi].action.type === "mockResponse") { mockRule = respRules[mi]; break; }
    }
    var modRespRules = respRules.filter(function (r) { return r.action.type === "modifyResponse"; });

    // Immediate mock (no body conditions)
    if (mockRule && !hasRespBC(mockRule)) {
      var step = getStepForUse(mockRule);
      var md = mockActionData(mockRule, step);
      reportHit(mockRule.id, self.__rm.url, self.__rm.method);
      logAction("#e74c3c", "XHR intercepted \u2192 " + md.status, self.__rm.method, self.__rm.url, mockRule, {
        status: md.status,
        delay: md.delay + "ms",
        headers: md.headers,
        step: step ? "step " + getCallCount(mockRule.id) : null
      });
      mockXhrResponse(self, { action: md }, md.delay);
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
        var step2 = getStepForUse(mockRule);
        var md2 = mockActionData(mockRule, step2);
        var ms = md2.status;
        var mb = md2.body;
        var mh = md2.headers;
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
        logAction("#e74c3c", "XHR conditional mock \u2192 " + ms, self.__rm.method, self.__rm.url, mockRule, { status: ms, headers: mh, responseBody: tryParseBody(self.responseText), step: step2 ? "step " + getCallCount(mockRule.id) : null });
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
    var status = action.status || 200;
    var body = action.body || "";
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
    }, delay || 5);
  }

  // === COMMUNICATION ===

  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    if (event.data && event.data.type === "REQUEST_MOCKER_RULES") {
      rules = event.data.rules || [];
      masterEnabled = event.data.masterEnabled !== false;
      ruleCallCounts = {};
    }
  });

  window.postMessage({ type: "REQUEST_MOCKER_INIT" }, "*");
})();
