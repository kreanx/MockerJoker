var MOCK_SERVER_URL = "http://localhost:17500";

function syncRules(rules, callback) {
  var data = JSON.stringify(rules || []);
  var url = MOCK_SERVER_URL + "/api/rules";

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: data
  })
    .then(function (res) {
      if (callback) callback(res.ok);
    })
    .catch(function () {
      if (callback) callback(false);
    });
}

function checkServerHealth(callback) {
  fetch(MOCK_SERVER_URL + "/health", { method: "GET" })
    .then(function (res) {
      if (callback) callback(res.ok);
    })
    .catch(function () {
      if (callback) callback(false);
    });
}
