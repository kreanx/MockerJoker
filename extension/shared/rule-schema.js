var ACTION_TYPES = {
  MOCK_RESPONSE: "mockResponse",
  MODIFY_REQUEST: "modifyRequest"
};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function createDefaultRule() {
  return {
    id: generateId(),
    name: "New Rule",
    enabled: true,
    match: {
      urlPattern: "",
      method: "ANY",
      resourceType: ""
    },
    action: {
      type: ACTION_TYPES.MOCK_RESPONSE,
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: "{}",
      removeHeaders: [],
      setHeaders: {}
    }
  };
}

function validateRule(rule) {
  if (!rule || !rule.id) return { valid: false, error: "Missing rule id" };
  if (!rule.match || !rule.match.urlPattern) return { valid: false, error: "Missing urlPattern" };
  if (!rule.action || !rule.action.type) return { valid: false, error: "Missing action type" };
  if (!Object.values(ACTION_TYPES).includes(rule.action.type)) {
    return { valid: false, error: "Invalid action type: " + rule.action.type };
  }
  if (rule.action.type === ACTION_TYPES.MOCK_RESPONSE) {
    if (typeof rule.action.status !== "number") return { valid: false, error: "Missing status code" };
  }
  return { valid: true };
}

function presets() {
  return {
    error500: function (urlPattern) {
      return {
        id: generateId(),
        name: "500 Internal Server Error",
        enabled: true,
        match: { urlPattern: urlPattern, method: "ANY", resourceType: "" },
        action: {
          type: ACTION_TYPES.MOCK_RESPONSE,
          status: 500,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Internal Server Error", code: 500, message: "Something went wrong" })
        }
      };
    },
    forbidden403: function (urlPattern) {
      return {
        id: generateId(),
        name: "403 Forbidden",
        enabled: true,
        match: { urlPattern: urlPattern, method: "ANY", resourceType: "" },
        action: {
          type: ACTION_TYPES.MOCK_RESPONSE,
          status: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Forbidden", code: 403, message: "Access denied" })
        }
      };
    },
    partialData: function (urlPattern) {
      return {
        id: generateId(),
        name: "Partial Data (missing fields)",
        enabled: true,
        match: { urlPattern: urlPattern, method: "GET", resourceType: "" },
        action: {
          type: ACTION_TYPES.MOCK_RESPONSE,
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: 1, name: "John Doe" })
        }
      };
    },
    removeAuth: function (urlPattern) {
      return {
        id: generateId(),
        name: "Remove Authorization Header",
        enabled: true,
        match: { urlPattern: urlPattern, method: "ANY", resourceType: "" },
        action: {
          type: ACTION_TYPES.MODIFY_REQUEST,
          removeHeaders: ["Authorization"],
          setHeaders: {}
        }
      };
    },
    mock401: function (urlPattern) {
      return {
        id: generateId(),
        name: "401 Unauthorized (mock)",
        enabled: true,
        match: { urlPattern: urlPattern, method: "ANY", resourceType: "" },
        action: {
          type: ACTION_TYPES.MOCK_RESPONSE,
          status: 401,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Unauthorized", code: 401, message: "Invalid or missing token" })
        }
      };
    },
    removeCookies: function (urlPattern) {
      return {
        id: generateId(),
        name: "Remove Cookies",
        enabled: true,
        match: { urlPattern: urlPattern, method: "ANY", resourceType: "" },
        action: {
          type: ACTION_TYPES.MODIFY_REQUEST,
          removeHeaders: ["Cookie"],
          setHeaders: {}
        }
      };
    }
  };
}
