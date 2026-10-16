"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, dialog, shell, session } = require("electron");
const { findFreePort, startWebServer } = require("./server");

const root = path.resolve(__dirname, "..");
let window = null;
let webServer = null;
let pythonProcess = null;
let terminating = false;
let webOrigin = "";

function backendCommand(port, origin) {
  if (app.isPackaged) {
    const binary = path.join(
      process.resourcesPath,
      "backend",
      process.platform === "win32" ? "ubicarportads-api.exe" : "ubicarportads-api"
    );
    if (!fs.existsSync(binary)) {
      throw new Error("No se encontró el procesador PDF incluido en la instalación: " + binary);
    }
    return { command: binary, args: ["--port", String(port)], env: { ...process.env, UBICARPORTADS_DESKTOP_ORIGIN: origin } };
  }
  const python = process.platform === "win32"
    ? path.join(root, ".venv", "Scripts", "python.exe")
    : path.join(root, ".venv", "bin", "python");
  if (!fs.existsSync(python)) {
    throw new Error("No está instalado el entorno de Python. Ejecuta npm install desde VS Code.");
  }
  return {
    command: python,
    args: ["-m", "backend.desktop_server", "--port", String(port)],
    env: { ...process.env, UBICARPORTADS_DESKTOP_ORIGIN: origin },
  };
}

function waitForApi(port, child, timeoutMs = 45000) {
  const end = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let done = false;
    let scheduled = null;
    const finish = (error) => {
      if (done) return;
      done = true;
      if (scheduled) clearTimeout(scheduled);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    const onError = (error) => finish(error);
    const onExit = (code) => finish(new Error("El procesador PDF terminó antes de iniciar (código " + code + ")."));
    child.once("error", onError);
    child.once("exit", onExit);
    const poll = () => {
      if (done) return;
      if (Date.now() >= end) {
        finish(new Error("El procesador PDF no respondió en el tiempo esperado."));
        return;
      }
      const request = http.get(`http://127.0.0.1:${port}/api/health`, { timeout: 1800 }, (response) => {
        const ok = response.statusCode === 200;
        response.resume();
        if (ok) finish();
        else scheduled = setTimeout(poll, 250);
      });
      request.on("timeout", () => request.destroy());
      request.on("error", () => {
        if (!done) scheduled = setTimeout(poll, 250);
      });
    };
    poll();
  });
}

function stopServices() {
  if (terminating) return;
  terminating = true;
  if (pythonProcess && !pythonProcess.killed) pythonProcess.kill();
  if (webServer) webServer.close();
}

function permitExternalLink(url) {
  if (!url.startsWith("https://github.com/jeffer91/Ubicarportads")) return;
  shell.openExternal(url).catch(() => {});
}

async function openDesktop() {
  let apiPort;
  ({ origin: webOrigin, server: webServer } = await startWebServer(path.join(root, "web")));
  apiPort = await findFreePort();
  const options = backendCommand(apiPort, webOrigin);
  pythonProcess = spawn(options.command, options.args, {
    cwd: root,
    env: options.env,
    stdio: app.isPackaged ? "ignore" : "inherit",
    windowsHide: true,
  });

  await waitForApi(apiPort, pythonProcess);

  // El backend en este punto ya está activo y se puede comprobar el health check.
  pythonProcess.once("exit", () => {
    if (!terminating) {
      dialog.showErrorBox("Ubicarportads", "El procesador de PDF se detuvo. Abre nuevamente la aplicación.");
      app.quit();
    }
  });

  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({
      title: "Guardar PDF procesado",
      defaultPath: path.join(app.getPath("downloads"), item.getFilename()),
      filters: [{ name: "Documentos PDF", extensions: ["pdf"] }],
    });
  });

  window = new BrowserWindow({
    title: "Ubicarportads",
    width: 1280,
    height: 850,
    minWidth: 880,
    minHeight: 620,
    autoHideMenuBar: true,
    backgroundColor: "#f5f7fa",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: [`--ubicarportads-api=http://127.0.0.1:${apiPort}`],
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    permitExternalLink(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, destination) => {
    if (!destination.startsWith(webOrigin + "/")) {
      event.preventDefault();
      permitExternalLink(destination);
    }
  });
  window.once("ready-to-show", () => window.show());
  await window.loadURL(webOrigin + "/");
  if (process.argv.includes("--devtools")) window.webContents.openDevTools({ mode: "detach" });
  console.log("Ubicarportads listo en Electron.");
  console.log("API local: http://127.0.0.1:" + apiPort + "/api/docs");
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.on("before-quit", stopServices);
  app.on("window-all-closed", () => app.quit());
  app.whenReady().then(openDesktop).catch((error) => {
    console.error("No se pudo iniciar Ubicarportads:", error);
    dialog.showErrorBox("Error al iniciar Ubicarportads", error.message);
    app.quit();
  });
}
