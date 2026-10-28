/* Ubicarportads — procesamiento 100 % local en el navegador.
   PDF.js reconoce el contenido; pdf-lib reconstruye sin rasterizar el texto. */
(function (global) {
  "use strict";
  const LETTER = { width: 612, height: 792 };
  const CM = 72 / 2.54;
  const TARGET = {
    x: (612 - 18 * CM) / 2,
    y: 792 - 1.8 * CM - 4.2 * CM,
    width: 18 * CM,
    height: 4.2 * CM
  };
  const MAX_BYTES = 30 * 1024 * 1024, MAX_PAGES = 250;

  const normalize = value => String(value || "").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toUpperCase();
  function validRect(r, width, height) {
    return !!r && [r.x, r.y, r.width, r.height].every(Number.isFinite) &&
      r.x >= 0 && r.y >= 0 && r.width >= width * 0.35 &&
      r.height >= 28 && r.x + r.width <= width + 0.5 &&
      r.y + r.height <= height + 0.5;
  }
  function regionsOutside(r, width, height) {
    return [
      { x: 0, y: 0, width, height: r.y },
      { x: 0, y: r.y + r.height, width, height: height - r.y - r.height },
      { x: 0, y: r.y, width: r.x, height: r.height },
      { x: r.x + r.width, y: r.y, width: width - r.x - r.width, height: r.height }
    ].filter(piece => piece.width > 0.5 && piece.height > 0.5);
  }
  function findHeadings(text, viewport, util) {
    const labels = [];
    for (const item of text.items) {
      if (!item.str || !item.transform) continue;
      const word = normalize(item.str);
      const type = /ELABORAD[OA]/.test(word) ? "elaborado" :
        /REVISAD[OA]/.test(word) ? "revisado" :
        /APROBAD[OA]/.test(word) ? "aprobado" : "";
      if (!type) continue;
      const t = util.transform(viewport.transform, item.transform);
      const size = Math.max(7, Math.hypot(t[2], t[3]));
      const point = { type, x: t[4], y: t[5] - size };
      if (point.y >= viewport.height * 0.40 && point.y <= viewport.height * 0.96) labels.push(point);
    }
    for (const e of labels.filter(x => x.type === "elaborado")) {
      const r = labels.find(x => x.type === "revisado" &&
        x.x > e.x + viewport.width * 0.13 && Math.abs(x.y - e.y) < 16);
      const a = labels.find(x => x.type === "aprobado" && r &&
        x.x > r.x + viewport.width * 0.13 && Math.abs(x.y - e.y) < 16);
      if (r && a) return { y: (e.y + r.y + a.y) / 3, xs: [e.x, r.x, a.x] };
    }
    return null;
  }
  // Busca bordes horizontales continuos. No se adivina el cuadro si no hay líneas.
  function horizontalLines(canvas, label, pageWidth, pageHeight) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const sw = canvas.width, sh = canvas.height;
    const ratioX = sw / pageWidth, ratioY = sh / pageHeight;
    const rows = [], y0 = Math.max(1, Math.floor((label.y - 25) * ratioY));
    const y1 = Math.min(sh - 2, Math.ceil((label.y + 225) * ratioY));
    const minRun = Math.floor(sw * 0.55), allowedGap = Math.max(2, Math.round(ratioX * 2));
    for (let y = y0; y <= y1; y++) {
      let begin = -1, last = -1, bestBegin = -1, bestEnd = -1;
      const offset = y * sw * 4;
      for (let x = 0; x < sw; x++) {
        const i = offset + x * 4;
        const dark = image.data[i + 3] > 150 &&
          image.data[i] < 145 && image.data[i + 1] < 145 && image.data[i + 2] < 145;
        if (dark) {
          if (begin < 0 || x - last > allowedGap + 1) begin = x;
          last = x;
          if (last - begin > bestEnd - bestBegin) { bestBegin = begin; bestEnd = last; }
        }
      }
      if (bestBegin >= 0 && bestEnd - bestBegin >= minRun) {
        const left = bestBegin / ratioX, right = bestEnd / ratioX;
        if (left <= label.xs[0] + 8 && right >= label.xs[2] + 8) {
          rows.push({ y: y / ratioY, left, right });
        }
      }
    }
    return rows;
  }
  function detectTable(canvas, headings, width, height) {
    if (!headings) return null;
    const rows = horizontalLines(canvas, headings, width, height);
    const top = rows.filter(row => Math.abs(row.y - headings.y) < 25)
      .sort((a, b) => Math.abs(a.y - headings.y) - Math.abs(b.y - headings.y))[0];
    if (!top) return null;
    const bottoms = rows.filter(row => row.y >= top.y + 50 && row.y <= top.y + 220 &&
      Math.abs(row.left - top.left) < 17 && Math.abs(row.right - top.right) < 17);
    if (!bottoms.length) return null;
    const bottom = bottoms.sort((a, b) => b.y - a.y)[0];
    const rect = { x: Math.max(0, top.left - 2), y: Math.max(0, top.y - 2),
      width: Math.min(width, top.right + 3) - Math.max(0, top.left - 2),
      height: bottom.y - Math.max(0, top.y - 2) + 3 };
    return validRect(rect, width, height) ? rect : null;
  }
  function isSigned(pdf, lib) {
    const name = lib.PDFName.of;
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
      if (!(obj instanceof lib.PDFDict)) continue;
      if (obj.has(name("ByteRange"))) return true;
      const kind = obj.get(name("FT"));
      if (kind && kind.toString() === "/Sig") return true;
    }
    return false;
  }
  function collision(canvas, rect, pageWidth, pageHeight) {
    const scale = Math.min(LETTER.width / pageWidth, LETTER.height / pageHeight);
    const ox = (LETTER.width - pageWidth * scale) / 2;
    const oy = (LETTER.height - pageHeight * scale) / 2;
    const region = {
      x: Math.max(0, (TARGET.x - ox) / scale),
      y: Math.max(0, (TARGET.y - oy) / scale),
      width: TARGET.width / scale, height: TARGET.height / scale
    };
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const sx = canvas.width / pageWidth, sy = canvas.height / pageHeight;
    let ink = 0;
    for (let y = region.y + 3; y < Math.min(pageHeight, region.y + region.height - 3); y += 3) {
      for (let x = region.x + 3; x < Math.min(pageWidth, region.x + region.width - 3); x += 3) {
        if (x >= rect.x - 3 && x <= rect.x + rect.width + 3 &&
            y >= rect.y - 3 && y <= rect.y + rect.height + 3) continue;
        const ix = Math.floor(x * sx), iy = Math.floor(y * sy);
        if (ix < 0 || iy < 0 || ix >= canvas.width || iy >= canvas.height) continue;
        const i = (iy * canvas.width + ix) * 4;
        if (data[i + 3] > 150 && data[i] < 140 && data[i + 1] < 140 && data[i + 2] < 140) {
          if (++ink >= 9) return true;
        }
      }
    }
    return false;
  }
  function pageBox(r, height) {
    return { left: r.x, right: r.x + r.width, bottom: height - r.y - r.height, top: height - r.y };
  }
  async function embedPiece(dstDoc, dstPage, srcPage, region, scale, offsetX, offsetY, pageHeight) {
    if (region.width <= 0.5 || region.height <= 0.5) return;
    const embedded = await dstDoc.embedPage(srcPage, pageBox(region, pageHeight));
    dstPage.drawPage(embedded, {
      x: offsetX + region.x * scale,
      y: LETTER.height - offsetY - (region.y + region.height) * scale,
      width: region.width * scale, height: region.height * scale
    });
  }
  async function createSession(file) {
    if (!global.pdfjsLib || !global.PDFLib) throw Error("No se cargaron las bibliotecas de PDF. Comprueba la conexión e inténtalo de nuevo.");
    if (!file || !/\.pdf$/i.test(file.name)) throw Error("Selecciona un documento PDF.");
    if (file.size > MAX_BYTES) throw Error("El PDF supera el límite de 30 MB.");
    if (!file.size) throw Error("El archivo está vacío.");
    const bytes = await file.arrayBuffer();
    const raw = new Uint8Array(bytes);
    if (String.fromCharCode(...raw.slice(0, 5)) !== "%PDF-") throw Error("El archivo no parece un PDF válido.");
    let reader;
    try { reader = await global.pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise; }
    catch (err) { throw Error("No se pudo abrir el PDF. Puede estar dañado o protegido."); }
    if (reader.numPages > MAX_PAGES) {
      await reader.destroy(); throw Error("El PDF supera el límite de 250 páginas.");
    }
    const first = await reader.getPage(1);
    if (first.rotate % 360 !== 0) {
      await reader.destroy(); throw Error("La portada está girada. Enderézala antes de procesarla.");
    }
    const viewport = first.getViewport({ scale: 1 });
    const text = await first.getTextContent();
    const headings = findHeadings(text, viewport, global.pdfjsLib.Util);
    let canvas = null;
    return {
      width: viewport.width, height: viewport.height, pages: reader.numPages, headings,
      async render(canvasEl) {
        const scale = Math.min(1.9, 1400 / viewport.width);
        const v = first.getViewport({ scale });
        canvasEl.width = Math.ceil(v.width);
        canvasEl.height = Math.ceil(v.height);
        const context = canvasEl.getContext("2d", { alpha: false, willReadFrequently: true });
        context.fillStyle = "#fff"; context.fillRect(0, 0, canvasEl.width, canvasEl.height);
        await first.render({ canvasContext: context, viewport: v }).promise;
        canvas = canvasEl;
        return detectTable(canvasEl, headings, viewport.width, viewport.height);
      },
      async process(rect, onProgress) {
        if (!canvas) throw Error("La vista previa aún no está preparada.");
        if (!validRect(rect, viewport.width, viewport.height)) throw Error("El área seleccionada debe ser suficientemente grande y estar dentro de la portada.");
        if (headings && !(headings.xs.every(x => x >= rect.x - 4 && x <= rect.x + rect.width + 4) &&
          headings.y >= rect.y - 8 && headings.y <= rect.y + rect.height)) {
          throw Error("La selección no incluye los tres encabezados de responsables.");
        }
        if (collision(canvas, rect, viewport.width, viewport.height)) {
          throw Error("La ubicación de destino ya contiene información ajena a la tabla. No se modificó el documento.");
        }
        const lib = global.PDFLib;
        let src;
        try { src = await lib.PDFDocument.load(bytes, { updateMetadata: false }); }
        catch (_) { throw Error("No se pudo analizar el PDF. Puede estar cifrado o dañado."); }
        if (isSigned(src, lib)) throw Error("El PDF contiene una firma o campo de firma digital; no se modificará.");
        const srcPages = src.getPages();
        if (srcPages.length !== reader.numPages) throw Error("La cantidad de páginas no coincide entre los lectores PDF.");
        if (Math.abs(srcPages[0].getWidth() - viewport.width) > 1 ||
            Math.abs(srcPages[0].getHeight() - viewport.height) > 1) {
          throw Error("La portada utiliza un recorte de página incompatible con esta versión.");
        }

        // Se preserva el árbol de páginas original. Los enlaces PDF son anotaciones
        // normales: NO deben bloquearse ni perderse al reconstruir todo el archivo.
        const linksByPage = [];
        for (let i = 0; i < reader.numPages; i++) {
          const p = await reader.getPage(i + 1);
          if (p.rotate % 360 !== 0) {
            throw Error("Hay páginas giradas. Enderézalas antes de continuar.");
          }
          const annotations = await p.getAnnotations({ intent: "display" });
          const links = annotations.filter(a =>
            a.annotationType === 2 || a.subtype === "Link" || a.type === "Link");
          if (links.length !== annotations.length) {
            throw Error("El PDF contiene anotaciones editables, comentarios o campos interactivos. No se modificarán.");
          }
          // La portada será redibujada. Un enlace sobre ella requeriría
          // transformar su zona activa; se rechaza para evitar desalineación.
          if (i === 0 && links.length) {
            throw Error("La portada contiene enlaces interactivos que no se pueden recolocar de forma segura.");
          }
          linksByPage.push(links.length);
        }

        // Cargar una segunda copia para editar: embedPage debe leer SIEMPRE una
        // página original independiente. Así se evitan referencias circulares.
        const result = await lib.PDFDocument.load(bytes.slice(0), { updateMetadata: false });
        if (result.getPageCount() !== srcPages.length) throw Error("No coincide el número de páginas original.");
        const firstOut = result.getPages()[0];

        // Vaciar SOLO el contenido de portada. Se conserva el objeto /Page,
        // sus referencias y el árbol /Pages: los destinos del índice no cambian.
        // Las otras páginas conservan su texto, enlaces, imágenes y estructura.
        firstOut.node.set(lib.PDFName.of("Contents"), result.context.obj([]));
        firstOut.setSize(LETTER.width, LETTER.height);
        const scale = Math.min(LETTER.width / viewport.width, LETTER.height / viewport.height);
        const ox = (LETTER.width - viewport.width * scale) / 2;
        const oy = (LETTER.height - viewport.height * scale) / 2;
        for (const part of regionsOutside(rect, viewport.width, viewport.height)) {
          await embedPiece(result, firstOut, srcPages[0], part, scale, ox, oy, viewport.height);
        }
        const table = await result.embedPage(srcPages[0], pageBox(rect, viewport.height));
        const fit = Math.min(TARGET.width / rect.width, TARGET.height / rect.height);
        const w = rect.width * fit, h = rect.height * fit;
        firstOut.drawPage(table, {
          x: TARGET.x + (TARGET.width - w) / 2,
          y: LETTER.height - TARGET.y - (TARGET.height + h) / 2,
          width: w, height: h
        });
        if (onProgress) onProgress(1, srcPages.length);

        // En vez de recomponer las demás páginas, se mantienen y, únicamente
        // cuando corresponde, se ajusta su tamaño junto con sus anotaciones.
        // pdf-lib PDFPage.scale() escala contenido Y rectángulos de enlaces.
        for (let i = 1; i < srcPages.length; i++) {
          const page = result.getPages()[i];
          const width = page.getWidth(), height = page.getHeight();
          if (!width || !height) throw Error("Página con dimensiones inválidas.");
          if (Math.abs(width - LETTER.width) > 0.5 || Math.abs(height - LETTER.height) > 0.5) {
            const ratio = Math.min(LETTER.width / width, LETTER.height / height);
            page.scale(ratio, ratio);
          }
          page.setSize(LETTER.width, LETTER.height);
          if (onProgress && (i % 10 === 0 || i === srcPages.length - 1)) onProgress(i + 1, srcPages.length);
          if (i % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
        const output = await result.save({ useObjectStreams: false });
        // Comprobar que el resultado es legible y que mantiene los enlaces.
        let validated;
        try {
          validated = await global.pdfjsLib.getDocument({ data: new Uint8Array(output) }).promise;
          if (validated.numPages !== reader.numPages) {
            throw Error("El PDF generado no conserva todas las páginas.");
          }
          for (let i = 0; i < validated.numPages; i++) {
            if (!linksByPage[i]) continue;
            const checkPage = await validated.getPage(i + 1);
            const annots = await checkPage.getAnnotations({ intent: "display" });
            const found = annots.filter(a =>
              a.annotationType === 2 || a.subtype === "Link" || a.type === "Link").length;
            if (found !== linksByPage[i]) {
              throw Error("No se conservaron todos los enlaces del documento (página " + (i + 1) + ").");
            }
          }
        } catch (err) {
          throw Error("No se pudo verificar la integridad del PDF: " + (err.message || "archivo incompatible"));
        } finally {
          if (validated) await validated.destroy();
        }
        return new Blob([output], { type: "application/pdf" });
      },
      async dispose() { await reader.destroy(); }
    };
  }
  global.UbicarPDF = { createSession, validRect, regionsOutside, findHeadings,
    detectTable, collision, TARGET, LETTER };
})(typeof window !== "undefined" ? window : globalThis);
