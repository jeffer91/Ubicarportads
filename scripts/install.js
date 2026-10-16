"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const envDir = path.join(root, ".venv");
const envPython = process.platform === "win32"
  ? path.join(envDir, "Scripts", "python.exe")
  : path.join(envDir, "bin", "python");

function findPython() {
  const candidates = process.platform === "win32"
    ? [["py", ["-3"]], ["python", []]]
    : [["python3", []], ["python", []]];
  for (const [command, prefix] of candidates) {
    const check = spawnSync(command, [...prefix, "-c", "import sys; assert sys.version_info >= (3, 9)"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (!check.error && check.status === 0) return { command, prefix };
  }
  return null;
}

if (!fs.existsSync(envPython)) {
  const python = findPython();
  if (!python) {
    console.error("No se encontró Python 3.9 o superior. Instala Python 3 y vuelve a ejecutar npm install.");
    process.exit(1);
  }
  const create = spawnSync(python.command, [...python.prefix, "-m", "venv", envDir], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  });
  if (create.error || create.status !== 0) {
    console.error("No se pudo crear el entorno virtual de Python.", create.error?.message || "");
    process.exit(1);
  }
}

const install = spawnSync(envPython, ["-m", "pip", "install", "-r", "backend/requirements.txt"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
if (install.error || install.status !== 0) {
  console.error("No se pudieron instalar las dependencias Python.", install.error?.message || "");
  process.exit(1);
}
console.log("Entorno preparado. Ejecuta npm start para abrir Ubicarportads.");
