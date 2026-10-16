"use strict";

const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function findFreePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => {
      const { port } = socket.address();
      socket.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function startWebServer(directory) {
  const root = fs.realpathSync(directory);
  const server = http.createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end("Método no permitido");
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    } catch {
      response.writeHead(400).end("Dirección inválida");
      return;
    }
    // Nunca servir archivos fuera del directorio web, tampoco mediante rutas codificadas.
    if (pathname.includes("\\") || pathname.includes("\0")) {
      response.writeHead(403).end("Acceso denegado");
      return;
    }
    const relative = pathname.replace(/^\/+/, "") || "index.html";
    const resolved = path.resolve(root, relative);
    if (!resolved.startsWith(root + path.sep)) {
      response.writeHead(403).end("Acceso denegado");
      return;
    }
    fs.realpath(resolved, (realError, realPath) => {
      if (realError || !realPath.startsWith(root + path.sep)) {
        response.writeHead(404).end("No encontrado");
        return;
      }
      fs.stat(realPath, (statError, info) => {
        if (statError || !info.isFile()) {
          response.writeHead(404).end("No encontrado");
          return;
        }
        response.writeHead(200, {
          "Content-Type": mimeTypes[path.extname(realPath).toLowerCase()] || "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        if (request.method === "HEAD") response.end();
        else fs.createReadStream(realPath).pipe(response);
      });
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve({ server, origin: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

module.exports = { findFreePort, startWebServer };
