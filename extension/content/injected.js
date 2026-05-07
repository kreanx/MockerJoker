(function () {
  var rules = [];
  var masterEnabled = true;
  var seenRequests = [];
  var SEEN_MAX = 100;

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

  function findRule(url, method, body) {
    if (!masterEnabled) return null;
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (!rule.enabled) continue;
      if (!rule.match || !rule.match.urlPattern) continue;
      var regex = globToRegex(rule.match.urlPattern);
      if (!regex.test(url)) continue;
      if (rule.match.method && rule.match.method !== "ANY" && rule.match.method !== method) continue;
      if (!matchBodyConditions(body, rule.match.bodyConditions)) continue;
      return rule;
    }
    return null;
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
    return path.replace(/\[(\d+)\]/g, ".$1").split(".").filter(function(p) { return p !== ""; });
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
    if (obj != null && obj[key] != null) {
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

  function applyRequestModifications(init, rule) {
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
    init.headers = headers;
    return init;
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

    var rule = findRule(url, method, reqBody);

    if (rule && rule.action.type === "mockResponse") {
      var delay = rule.action.delay || 0;
      var respHeaders = rule.action.headers || { "Content-Type": "application/json" };
      reportHit(rule.id, url, method);
      logAction("#e74c3c", "FETCH intercepted \u2192 " + rule.action.status, method, url, rule, {
        status: rule.action.status,
        delay: delay + "ms",
        headers: respHeaders
      });
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve(
            new Response(rule.action.body || "", {
              status: rule.action.status || 200,
              statusText: "",
              headers: new Headers(respHeaders)
            })
          );
        }, delay || 5);
      });
    }

    if (rule && rule.action.type === "modifyBody") {
      var bodyObj = reqBody;
      if (!bodyObj && init && init.body) {
        bodyObj = parseReqBody(init.body);
      }
      if (bodyObj) {
        bodyObj = applyBodyTransforms(bodyObj, rule.action.transforms);
        init = init || {};
        init.body = JSON.stringify(bodyObj);
        reportHit(rule.id, url, method);
        logAction("#009688", "FETCH modifyBody", method, url, rule, {
          transforms: rule.action.transforms,
          resultBody: bodyObj
        });
        if (typeof input === "string") {
          return origFetch.call(this, input, init);
        }
        return origFetch.call(this, new Request(input, init));
      }
    }

    if (rule && rule.action.type === "modifyRequest") {
      init = applyRequestModifications(init, rule);
      var modifiedHeaders = {};
      if (init && init.headers) {
        init.headers.forEach(function (v, k) { modifiedHeaders[k] = v; });
      }
      reportHit(rule.id, url, method);
      logAction("#f39c12", "FETCH modified", method, url, rule, {
        removeHeaders: rule.action.removeHeaders,
        setHeaders: rule.action.setHeaders,
        resultHeaders: modifiedHeaders
      });
      if (typeof input === "string") {
        return origFetch.call(this, input, init);
      }
      return origFetch.call(this, new Request(input, init));
    }

    if (rule && rule.action.type === "modifyResponse") {
      reportHit(rule.id, url, method);
      logAction("#9b59b6", "FETCH modifyResponse", method, url, rule, {
        removeHeaders: rule.action.removeResponseHeaders,
        setHeaders: rule.action.setResponseHeaders
      });
      return origFetch.apply(this, arguments).then(function (response) {
        var newHeaders = new Headers(response.headers);
        if (rule.action.removeResponseHeaders) {
          rule.action.removeResponseHeaders.forEach(function (h) {
            newHeaders.delete(h);
          });
        }
        if (rule.action.setResponseHeaders) {
          Object.keys(rule.action.setResponseHeaders).forEach(function (k) {
            newHeaders.set(k, rule.action.setResponseHeaders[k]);
          });
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders
        });
      });
    }

    return origFetch.apply(this, arguments);
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
    if (this.__rm) {
      addSeenRequest(this.__rm.url, this.__rm.method);
      flushSeenRequests();

      var reqBody = parseReqBody(body);
      var rule = findRule(this.__rm.url, this.__rm.method, reqBody);

      if (rule && rule.action.type === "mockResponse") {
        var delay = rule.action.delay || 0;
        reportHit(rule.id, self.__rm.url, self.__rm.method);
        logAction("#e74c3c", "XHR intercepted \u2192 " + rule.action.status, self.__rm.method, self.__rm.url, rule, {
          status: rule.action.status,
          delay: delay + "ms",
          headers: rule.action.headers || {}
        });
        mockXhrResponse(self, rule, delay);
        return;
      }

      if (rule && rule.action.type === "modifyBody") {
        var bodyObj = reqBody;
        if (!bodyObj && body) {
          bodyObj = parseReqBody(body);
        }
        if (bodyObj) {
          bodyObj = applyBodyTransforms(bodyObj, rule.action.transforms);
          reportHit(rule.id, self.__rm.url, self.__rm.method);
          logAction("#009688", "XHR modifyBody", self.__rm.method, self.__rm.url, rule, {
            transforms: rule.action.transforms,
            resultBody: bodyObj
          });
          return origXhrSend.call(self, JSON.stringify(bodyObj));
        }
      }

      if (rule && rule.action.type === "modifyRequest") {
        if (rule.action.setHeaders) {
          Object.keys(rule.action.setHeaders).forEach(function (k) {
            origXhrSetHeader.call(self, k, rule.action.setHeaders[k]);
          });
        }
        reportHit(rule.id, self.__rm.url, self.__rm.method);
        logAction("#f39c12", "XHR modified", self.__rm.method, self.__rm.url, rule, {
          removeHeaders: rule.action.removeHeaders,
          setHeaders: rule.action.setHeaders,
          requestHeaders: self.__rmReqHeaders || {}
        });
      }

      if (rule && rule.action.type === "modifyResponse") {
        reportHit(rule.id, self.__rm.url, self.__rm.method);
        logAction("#9b59b6", "XHR modifyResponse", self.__rm.method, self.__rm.url, rule, {
          removeHeaders: rule.action.removeResponseHeaders,
          setHeaders: rule.action.setResponseHeaders
        });

        var modRule = rule;
        self.getResponseHeader = function (name) {
          var val = origXhrGetHeader.call(self, name);
          if (modRule.action.removeResponseHeaders) {
            var lower = name.toLowerCase();
            for (var i = 0; i < modRule.action.removeResponseHeaders.length; i++) {
              if (modRule.action.removeResponseHeaders[i].toLowerCase() === lower) return null;
            }
          }
          if (modRule.action.setResponseHeaders) {
            var lower2 = name.toLowerCase();
            for (var k in modRule.action.setResponseHeaders) {
              if (k.toLowerCase() === lower2) return modRule.action.setResponseHeaders[k];
            }
          }
          return val;
        };

        self.getAllResponseHeaders = function () {
          var raw = origXhrGetAllHeaders.call(self);
          if (!raw) return raw;
          var result = raw;
          if (modRule.action.removeResponseHeaders) {
            modRule.action.removeResponseHeaders.forEach(function (h) {
              var re = new RegExp(h.toLowerCase() + ": [^\\r]*\\r?\\n?", "gi");
              result = result.replace(re, "");
            });
          }
          if (modRule.action.setResponseHeaders) {
            Object.keys(modRule.action.setResponseHeaders).forEach(function (k) {
              var re = new RegExp(k.toLowerCase() + ": [^\\r]*\\r?\\n?", "gi");
              result = result.replace(re, "");
              result += k.toLowerCase() + ": " + modRule.action.setResponseHeaders[k] + "\r\n";
            });
          }
          return result;
        };
      }
    }
    return origXhrSend.apply(this, arguments);
  };

  function mockXhrResponse(xhr, rule, delay) {
    var status = rule.action.status || 200;
    var body = rule.action.body || "";
    var headers = rule.action.headers || {};

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
    }
  });

  window.postMessage({ type: "REQUEST_MOCKER_INIT" }, "*");
})();
