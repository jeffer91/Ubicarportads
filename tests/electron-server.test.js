"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { findFreePort, startWebServer } = require("../electron/server");

function get(origin, target) {
  return new Promise((resolve, reject) => {
    http.get(origin + target, (response) => {
      const parts = [];
      response.on("data", (part) => parts.push(part));
      response.on("end", () => resolve({
        status: response.statusCode,
        type: response.headers["content-type"],
        body: Buffer.concat(parts).toString("utf8"),
      }));
    }).on("error", reject);
  });
}

test("El servidor Electron sirve la web local, bloquea rutas externas y usa puertos libres", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ubicarportads-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<h1>Ubicarportads</h1>");
  const port = await findFreePort();
  assert.ok(port > 1023);
  const { server, origin } = await startWebServer(dir);
  try {
    const home = await get(origin, "/");
    assert.equal(home.status, 200);
    assert.match(home.type, /text\/html/);
    assert.match(home.body, /Ubicarportads/);
    const missing = await get(origin, "/no-existe.js");
    assert.equal(missing.status, 404);
    const traversal = await get(origin, "/%2e%2e/%2e%2e/windows/system.ini");
    assert.notEqual(traversal.status, 200);
    const nul = await get(origin, "/%00");
    assert.notEqual(nul.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
