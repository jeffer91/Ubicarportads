"use strict";

const { contextBridge } = require("electron");

const prefix = "--ubicarportads-api=";
const argument = process.argv.find((entry) => entry.startsWith(prefix));
const url = argument && argument.slice(prefix.length);
if (url && /^http:\/\/127\.0\.0\.1:\d+$/.test(url)) {
  contextBridge.exposeInMainWorld("UBICARPORTADS_DESKTOP_API", url);
}
