/** Test-only route: its mutation counter proves HTTP admission ran before the handler. */
export default {
  id: "u3-auth-grant-fixture",
  name: "U3 Auth Grant Fixture",
  description: "Disposable Control UI auth boundary fixture",
  register(api) {
    if (api.registrationMode !== "full") return;
    let mutationCount = 0;
    api.registerHttpRoute({
      path: "/u3-auth-grant-fixture",
      auth: "gateway",
      match: "prefix",
      handler(req, res) {
        if (req.method === "POST") mutationCount += 1;
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true, mutationCount }));
      },
    });
    api.session.controls.registerControlUiDescriptor({
      surface: "tab",
      id: "u3-auth-grant-fixture",
      label: "U3 Auth Grant Fixture",
      path: "/u3-auth-grant-fixture",
      requiredScopes: ["operator.read"],
    });
  },
};
