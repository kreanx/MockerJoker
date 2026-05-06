function globToRegex(pattern) {
  var escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  escaped = escaped.replace(/\*/g, ".*");
  escaped = escaped.replace(/\?/g, ".");
  return new RegExp("^" + escaped + "$", "i");
}

function matchRule(url, method, resourceType, rules) {
  if (!rules || !Array.isArray(rules)) return null;
  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    if (!rule.enabled) continue;
    var m = rule.match;
    if (!m || !m.urlPattern) continue;
    var regex = globToRegex(m.urlPattern);
    if (!regex.test(url)) continue;
    if (m.method && m.method !== "ANY" && m.method !== method) continue;
    if (m.resourceType && m.resourceType !== resourceType) continue;
    return rule;
  }
  return null;
}

function findRuleById(rules, id) {
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].id === id) return rules[i];
  }
  return null;
}

function addRule(rules, rule) {
  rules.push(rule);
  return rules;
}

function updateRule(rules, updatedRule) {
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].id === updatedRule.id) {
      rules[i] = updatedRule;
      return rules;
    }
  }
  return rules;
}

function deleteRule(rules, id) {
  return rules.filter(function (r) { return r.id !== id; });
}
