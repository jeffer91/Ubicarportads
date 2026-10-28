"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { test } = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "..", "js", "pdf-engine.js"), "utf8");

function setup({ interactivePage = -1, coverLinks = false } = {}) {
  const calls = { loads: [], annotations: [], saved: 0, embeds: 0 };
  class DummyPage {
    constructor(number) {
      this.number = number;
      this.w = 612.12;
      this.h = 792.12;
      this.cleared = false;
      this.drawn = 0;
      this.scaled = 0;
      this.node = { set: (key, value) => {
        if (key === "Contents" && Array.isArray(value)) this.cleared = true;
      } };
    }
    getWidth() { return this.w; }
    getHeight() { return this.h; }
    setSize(w, h) { this.w = w; this.h = h; }
    scale() { this.scaled++; }
    drawPage() { this.drawn++; }
  }
  class DummyDoc {
    constructor() {
      this.pages = Array.from({ length: 53 }, (_, i) => new DummyPage(i));
      this.context = { enumerateIndirectObjects: () => [], obj: x => x };
    }
    getPages() { return this.pages; }
    getPageCount() { return this.pages.length; }
    async embedPage() { calls.embeds++; return {}; }
    async save() { calls.saved++; return new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]); }
  }
  const lib = {
    PDFDict: class {}, PDFName: { of: name => name },
    PDFDocument: {
      async load() { const doc = new DummyDoc(); calls.loads.push(doc); return doc; },
      async create() { throw Error("No se deben reconstruir todas las páginas."); }
    }
  };
  function makeViewerPage(pageNumber) {
    return {
      rotate: 0,
      getViewport({ scale }) {
        return { width: 612.12 * scale, height: 792.12 * scale, transform: [scale, 0, 0, scale, 0, 0] };
      },
      async getTextContent() { return { items: [] }; },
      render() { return { promise: Promise.resolve() }; },
      async getAnnotations() {
        const annotations = [];
        const count = pageNumber === 2 ? 28 : pageNumber === 52 ? 10 : (pageNumber === 1 && coverLinks ? 1 : 0);
        for (let i = 0; i < count; i++) annotations.push({ annotationType: 2, dest: "page" + i });
        if (pageNumber === interactivePage) annotations.push({ annotationType: 20 });
        calls.annotations.push({ pageNumber, count: annotations.length });
        return annotations;
      }
    };
  }
  const createReader = () => ({
    numPages: 53,
    getPage: async i => makeViewerPage(i),
    async destroy() {}
  });
  const engineContext = {
    PDFLib: lib,
    Blob,
    setTimeout,
    pdfjsLib: {
      Util: { transform: (_, transform) => transform },
      getDocument: () => ({ promise: Promise.resolve(createReader()) })
    }
  };
  vm.runInNewContext(source, engineContext);
  const bytes = Uint8Array.from([37, 80, 68, 70, 45, 49, 46, 55]).buffer;
  const file = { name: "ejemplo.pdf", size: 8, arrayBuffer: async () => bytes };
  const canvas = {
    width: 1, height: 1,
    getContext: () => ({
      fillRect() {},
      set fillStyle(_) {},
      getImageData: () => ({ data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255) })
    })
  };
  return { calls, engineContext, file, canvas };
}

test("Regresión 53 páginas: preserva los 38 enlaces y modifica solo contenido de portada", async () => {
  const { calls, engineContext, file, canvas } = setup();
  const session = await engineContext.UbicarPDF.createSession(file);
  await session.render(canvas);
  const rect = { x: 45, y: 643, width: 511, height: 128 };
  const blob = await session.process(rect);
  assert.ok(blob instanceof Blob);
  assert.equal(calls.loads.length, 2, "La página de origen debe ser independiente de la página editada");
  assert.equal(calls.saved, 1);
  const [src, result] = calls.loads;
  assert.equal(src.pages.length, 53);
  assert.equal(result.pages.length, 53, "No se debe reconstruir ni eliminar el árbol de páginas");
  assert.equal(result.pages[0].cleared, true, "Sólo el contenido de la portada se elimina");
  assert.equal(result.pages[1].cleared, false);
  assert.ok(result.pages[0].drawn >= 4);
  assert.ok(result.pages.slice(1).every(p => !p.drawn && !p.cleared));
  assert.equal(calls.annotations.filter(x => [2, 52].includes(x.pageNumber)).reduce((s, x) => s + x.count, 0), 76,
    "Los enlaces se verifican tanto en la entrada como en la salida");
  await session.dispose();
});
test("Se bloquea una anotación interactiva que no sea enlace normal", async () => {
  const { engineContext, file, canvas } = setup({ interactivePage: 7 });
  const session = await engineContext.UbicarPDF.createSession(file);
  await session.render(canvas);
  await assert.rejects(session.process({ x: 45, y: 643, width: 511, height: 128 }),
    /anotaciones editables/);
  await session.dispose();
});
test("Se bloquea portada con enlaces para no desplazar zonas activas", async () => {
  const { engineContext, file, canvas } = setup({ coverLinks: true });
  const session = await engineContext.UbicarPDF.createSession(file);
  await session.render(canvas);
  await assert.rejects(session.process({ x: 45, y: 643, width: 511, height: 128 }),
    /La portada contiene enlaces/);
  await session.dispose();
});
