var CONST = {
  ACTION_TYPES: {
    MOCK_RESPONSE: "mockResponse",
    MODIFY_REQUEST: "modifyRequest",
    MODIFY_RESPONSE: "modifyResponse",
    MODIFY_BODY: "modifyBody"
  },

  DEFAULT_STATUS: 200,
  DEFAULT_DELAY: 0,
  GRAPHQL_STATUS: 200,
  DEFAULT_BODY: "{}",

  HEADER_CONTENT_TYPE: "Content-Type",
  CONTENT_TYPE_JSON: "application/json",

  METHOD_ANY: "ANY",
  METHOD_GET: "GET",
  METHOD_POST: "POST",

  SEEN_MAX: 100,

  // Flat keys for backwards compat (panel/popup use them)
  MSG_RULES_UPDATED: "rulesUpdated",
  MSG_GET_RULES: "getRules",
  MSG_SAVE_RULES: "saveRules",
  MSG_OPEN_PANEL: "openPanel",
  MSG_HIT_COUNT: "hitCount",
  MSG_GET_HIT_COUNTERS: "getHitCounters",
  MSG_RESET_HIT_COUNTERS: "resetHitCounters",
  MSG_SEEN_REQUESTS: "seenRequests",
  MSG_GET_SEEN_REQUESTS: "getSeenRequests",

  PAGE_MSG_RULES: "REQUEST_MOCKER_RULES",
  PAGE_MSG_INIT: "REQUEST_MOCKER_INIT",
  PAGE_MSG_HIT: "REQUEST_MOCKER_HIT",
  PAGE_MSG_SEEN: "REQUEST_MOCKER_SEEN",

  // Nested objects for content/injected/background (single source of truth)
  MSG: {
    GET_RULES: "getRules",
    SAVE_RULES: "saveRules",
    OPEN_PANEL: "openPanel",
    RULES_UPDATED: "rulesUpdated",
    HIT_COUNT: "hitCount",
    GET_HIT_COUNTERS: "getHitCounters",
    RESET_HIT_COUNTERS: "resetHitCounters",
    SEEN_REQUESTS: "seenRequests",
    GET_SEEN_REQUESTS: "getSeenRequests",
    TAB_VARS: "tabVars",
    INTERCEPTION: "interception"
  },

  PAGE_MSG: {
    RULES: "REQUEST_MOCKER_RULES",
    INIT: "REQUEST_MOCKER_INIT",
    HIT: "REQUEST_MOCKER_HIT",
    SEEN: "REQUEST_MOCKER_SEEN",
    TAB_VARS: "REQUEST_MOCKER_TAB_VARS",
    INTERCEPTION: "REQUEST_MOCKER_INTERCEPTION"
  },
  INTERCEPTION_LIMIT: 500,

  LOG_COLORS: {
    MOCK: "#e74c3c",
    MODIFY_REQ: "#f39c12",
    MODIFY_BODY: "#009688",
    MODIFY_RESP: "#9b59b6"
  }
};

// Export under a unique key for page-context (injected.js) to avoid
// collision with page globals like Jira's window.CONST.
if (typeof window !== "undefined") { window.__RM_CONST = CONST; }
