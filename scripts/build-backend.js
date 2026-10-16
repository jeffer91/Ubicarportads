"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const python = process.platform === "win32"
  ? path.join(root, ".venv", "Scripts", "python.exe")
  : path.join(root, ".venv", "bin", "python");
if (!fs.existsSync(python)) {
  console.error("Falta el entorno Python. Ejecuta npm install.");
  process.exit(1);
}
function run(args) {
  const result = spawnSync(python, args, { cwd: root, stdio: "inherit", windowsHide: true });
  if (result.error || result.status !== 0) {
    console.error("Error al preparar el backend:", result.error?.message || "código " + result.status);
    process.exit(1);
  }
}
run(["-m", "pip", "install", "pyinstaller==6.16.0"]);
run([
  "-m", "PyInstaller",
  "--noconfirm", "--clean", "--onedir",
  "--name", "ubicarportads-api",
  "--paths", root,
  "--collect-all", "pymupdf",
  "--distpath", path.join(root, "build", "backend-dist"),
  "--workpath", path.join(root, "build", "pyinstaller-work"),
  "--specpath", path.join(root, "build"),
  path.join(root, "backend", "desktop_server.py"),
]);
const binary = path.join(root, "build", "backend-dist", "ubicarportads-api",
  process.platform === "win32" ? "ubicarportads-api.exe" : "ubicarportads-api");
if (!fs.existsSync(binary)) {
  console.error("El binario Python no se generó: " + binary);
  process.exit(1);
}
console.log("Backend compilado en " + binary);
