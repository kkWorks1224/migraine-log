// Google から URL フラグメントで返された ID トークンをサーバへ送ってセッションを作る
(function () {
  var p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, "", "/auth/callback");
  var token = p.get("id_token");
  if (!token) return location.replace("/?auth=error");
  fetch("/auth/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ id_token: token, state: p.get("state") }),
  })
    .then(function (r) { location.replace(r.ok ? "/" : "/?auth=error"); })
    .catch(function () { location.replace("/?auth=error"); });
})();
