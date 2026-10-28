"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const engine = fs.readFileSync(path.join(root, "js", "pdf-engine.js"), "utf8");
const app = fs.readFileSync(path.join(root, "js", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sandbox = {};
vm.runInNewContext(engine, sandbox);
const pdf = sandbox.UbicarPDF;

test("Los scripts compilan sin errores de sintaxis", () => {
  assert.doesNotThrow(() => new vm.Script(engine));
  assert.doesNotThrow(() => new vm.Script(app));
});
test("La página no necesita servidor Render ni Electron", () => {
  assert.doesNotMatch(html, /onrender\.com|localhost:8000|UBICARPORTADS_DESKTOP_API|electron\.js/i);
  assert.match(html, /js\/pdf-engine\.js/);
  assert.match(html, /js\/app\.js/);
});
test("Geometría institucional de la tabla y de la página Carta", () => {
  assert.equal(pdf.LETTER.width, 612);
  assert.equal(pdf.LETTER.height, 792);
  assert.ok(Math.abs(pdf.TARGET.width - 510.236) < 0.01);
  assert.ok(Math.abs(pdf.TARGET.height - 119.055) < 0.01);
  assert.ok(Math.abs(pdf.TARGET.y + pdf.TARGET.height - (792 - 1.8 * 72 / 2.54)) < 0.001);
});
test("Selección: válido, fuera de página, demasiado pequeño", () => {
  assert.equal(pdf.validRect({ x: 50, y: 620, width: 500, height: 115 }, 595, 842), true);
  assert.equal(pdf.validRect({ x: 50, y: 620, width: 200, height: 115 }, 595, 842), false);
  assert.equal(pdf.validRect({ x: 50, y: 740, width: 500, height: 115 }, 595, 842), false);
});
test("Las cuatro regiones fuera de la tabla no se superponen y preservan el área", () => {
  const W = 595, H = 842;
  const r = { x: 70, y: 632, width: 460, height: 108 };
  const pieces = pdf.regionsOutside(r, W, H);
  assert.equal(pieces.length, 4);
  const rest = pieces.reduce((sum, item) => sum + item.width * item.height, 0);
  assert.ok(Math.abs(rest - (W * H - r.width * r.height)) < 0.001);
});
test("Identifica tres encabezados variables y alineados", () => {
  const items = ["ELABORADO POR:", "Revisado por:", "Aprobado por:"].map((s, i) =>
    ({ str: s, transform: [1, 0, 0, 11, 90 + i * 170, 650] }));
  const result = pdf.findHeadings({ items }, { width: 595, height: 842, transform: [] },
    { transform: (_viewport, item) => item });
  assert.ok(result);
  assert.equal(result.xs.length, 3);
  assert.equal(result.y, 639);
});
test("Detección automática reconoce dos bordes largos alrededor de la tabla", () => {
  const W = 595, H = 842, data = new Uint8ClampedArray(W * H * 4);
  data.fill(255);
  function line(y) { for (let x = 75; x <= 535; x++) {
    const i = (y * W + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 0;
  }}
  line(631); line(632); line(738); line(739);
  const canvas = { width: W, height: H, getContext: () => ({ getImageData: () => ({ data }) }) };
  const labels = { y: 639, xs: [100, 270, 440] };
  const result = pdf.detectTable(canvas, labels, W, H);
  assert.ok(result, "Se esperaba detectar tabla");
  assert.ok(result.y <= 632 && result.y + result.height >= 739);
  assert.equal(pdf.detectTable({ width: W, height: H,
    getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(W * H * 4).fill(255) }) }) },
    labels, W, H), null);
});
