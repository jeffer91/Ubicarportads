"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const webRoot = path.join(root, "web");
const python = process.platform === "win32"
  ? path.join(root, ".venv", "Scripts", "python.exe")
  : path.join(root, ".venv", "bin", "python");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

if (!fs.existsSync(python)) {
  console.error("Falta preparar el proyecto. Ejecuta npm install antes de npm start.");
  process.exit(1);
}

let backend;
let stopping = false;
const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end("Método no permitido");
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400).end("Solicitud inválida");
    return;
  }
  const relativePath = pathname.replace(/^\/+/, "") || "index.html";
  const filePath = path.resolve(webRoot, relativePath);
  if (!filePath.startsWith(webRoot + path.sep)) {
    res.writeHead(403).end("Acceso denegado");
    return;
  }
  fs.stat(filePath, (err, info) => {
    if (err || !info.isFile()) {
      res.writeHead(404).end("No encontrado");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") res.end();
    else fs.createReadStream(filePath).pipe(res);
  });
});

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (backend && !backend.killed) backend.kill();
  server.close();
  process.exitCode = exitCode;
}

server.on("error", (err) => {
  console.error("No se pudo iniciar la web:", err.message);
  stop(1);
});
server.listen(5500, "127.0.0.1", () => {
  const args = ["-m", "uvicorn", "backend.app:app", "--host", "127.0.0.1", "--port", "8000"];
  if (process.argv.includes("--reload")) args.push("--reload");
  backend = spawn(python, args, { cwd: root, stdio: "inherit", windowsHide: true });
  backend.on("error", (err) => {
    console.error("No se pudo iniciar la API:", err.message);
    stop(1);
  });
  backend.on("exit", (code) => {
    if (!stopping) {
      console.error("El servidor Python se detuvo.");
      stop(code || 1);
    }
  });
  console.log("Web: http://localhost:5500");
  console.log("API: http://localhost:8000/api/docs");
  console.log("Pulsa Ctrl+C para detener ambos servidores.");
});
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
