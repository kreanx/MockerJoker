export function readBody(req, callback) {
  var chunks = [];
  req.on("data", function (chunk) {
    chunks.push(chunk);
  });
  req.on("end", function () {
    callback(Buffer.concat(chunks).toString("utf-8"));
  });
  req.on("error", function () {
    callback("");
  });
}
