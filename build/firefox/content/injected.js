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

  function globToRegex(pattern) {
    var escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    escaped = escaped.replace(/\*/g, ".*");
    escaped = escaped.replace(/\?/g, ".");
    return new RegExp("^" + escaped + "$", "i");
  }

  function findRule(url, method) {
    if (!masterEnabled) return null;
    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (!rule.enabled) continue;
      if (!rule.match || !rule.match.urlPattern) continue;
      var regex = globToRegex(rule.match.urlPattern);
      if (!regex.test(url)) continue;
      if (rule.match.method && rule.match.method !== "ANY" && rule.match.method !== method) continue;
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
    var url, method;
    if (typeof input === "string") {
      url = input;
    } else if (input instanceof Request) {
      url = input.url;
      method = input.method;
    } else {
      url = input.url || "";
    }
    method = ((init && init.method) || method || "GET").toUpperCase();

    addSeenRequest(url, method);
    flushSeenRequests();

    var rule = findRule(url, method);

    if (rule && rule.action.type === "mockResponse") {
      var delay = rule.action.delay || 0;
      var respHeaders = rule.action.headers || { "Content-Type": "application/json" };
      reportHit(rule.id, url, method);
      console.log(
        "%c[Request Mocker]%c FETCH intercepted: " + method + " " + url + " \u2192 " + rule.action.status + (delay ? " (delay " + delay + "ms)" : ""),
        "background:#e74c3c;color:#fff;padding:2px 6px;border-radius:3px",
        "color:#e74c3c;font-weight:bold",
        "\n  Rule:", rule.name,
        "\n  Status:", rule.action.status,
        "\n  Delay:", delay + "ms",
        "\n  Headers:", respHeaders,
        "\n  Body:", rule.action.body
      );
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

    if (rule && rule.action.type === "modifyRequest") {
      init = applyRequestModifications(init, rule);
      var modifiedHeaders = {};
      if (init && init.headers) {
        init.headers.forEach(function (v, k) { modifiedHeaders[k] = v; });
      }
      reportHit(rule.id, url, method);
      console.log(
        "%c[Request Mocker]%c FETCH modified: " + method + " " + url,
        "background:#f39c12;color:#fff;padding:2px 6px;border-radius:3px",
        "color:#f39c12;font-weight:bold",
        "\n  Rule:", rule.name,
        "\n  Remove headers:", rule.action.removeHeaders,
        "\n  Set headers:", rule.action.setHeaders,
        "\n  Result headers:", modifiedHeaders
      );
      if (typeof input === "string") {
        return origFetch.call(this, input, init);
      }
      return origFetch.call(this, new Request(input, init));
    }

    return origFetch.apply(this, arguments);
  };

  // === XHR ===

  OrigXHR.prototype.open = function (method, url) {
    this.__rm = { method: (method || "GET").toUpperCase(), url: url || "" };
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

      var rule = findRule(this.__rm.url, this.__rm.method);

      if (rule && rule.action.type === "mockResponse") {
        var delay = rule.action.delay || 0;
        reportHit(rule.id, self.__rm.url, self.__rm.method);
        console.log(
          "%c[Request Mocker]%c XHR intercepted: " + self.__rm.method + " " + self.__rm.url + " \u2192 " + rule.action.status + (delay ? " (delay " + delay + "ms)" : ""),
          "background:#e74c3c;color:#fff;padding:2px 6px;border-radius:3px",
          "color:#e74c3c;font-weight:bold",
          "\n  Rule:", rule.name,
          "\n  Status:", rule.action.status,
          "\n  Delay:", delay + "ms",
          "\n  Headers:", rule.action.headers || {},
          "\n  Body:", rule.action.body
        );
        mockXhrResponse(self, rule, delay);
        return;
      }

      if (rule && rule.action.type === "modifyRequest") {
        if (rule.action.setHeaders) {
          Object.keys(rule.action.setHeaders).forEach(function (k) {
            origXhrSetHeader.call(self, k, rule.action.setHeaders[k]);
          });
        }
        reportHit(rule.id, self.__rm.url, self.__rm.method);
        console.log(
          "%c[Request Mocker]%c XHR modified: " + self.__rm.method + " " + self.__rm.url,
          "background:#f39c12;color:#fff;padding:2px 6px;border-radius:3px",
          "color:#f39c12;font-weight:bold",
          "\n  Rule:", rule.name,
          "\n  Remove headers:", rule.action.removeHeaders,
          "\n  Set headers:", rule.action.setHeaders,
          "\n  Request headers:", self.__rmReqHeaders || {}
        );
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
