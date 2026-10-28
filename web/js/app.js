(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  let sourceFile = null, session = null, automatic = null, selected = null;
  let outputUrl = null, busy = false, pointerStart = null;
  const canvas = $("pageCanvas");
  canvas.style.display = "none";

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
  if (!window.pdfjsLib || !window.PDFLib || !window.UbicarPDF) {
    alertMessage("No se pudieron cargar las bibliotecas de PDF. Comprueba tu conexión y actualiza la página.", "error");
  }
  function alertMessage(message, kind) {
    const el = $("alert");
    el.textContent = message || "";
    el.className = message ? "alert active " + (kind || "info") : "alert";
  }
  function mode() {
    return document.querySelector('input[name="mode"]:checked').value;
  }
  function setMode(value) {
    document.querySelector('input[name="mode"][value="' + value + '"]').checked = true;
    chooseMode();
  }
  function setBusy(value) {
    busy = value;
    $("process").disabled = value || !session || !selected;
    $("process").textContent = value ? "Preparando PDF…" : "Preparar documento";
    $("fileInput").disabled = value;
    $("remove").disabled = value;
    document.querySelectorAll('input[name="mode"]').forEach(input => input.disabled = value);
  }
  function clearOutput() {
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    outputUrl = null;
    $("download").classList.remove("active");
    $("correctedTab").disabled = true;
    $("corrected").src = "about:blank";
    $("progress").classList.remove("active");
    $("progressBar").style.width = "0%";
    showOriginal();
  }
  function showOriginal() {
    $("preview").classList.remove("corrected");
    $("originalTab").classList.add("on");
    $("correctedTab").classList.remove("on");
  }
  function showCorrected() {
    if (!outputUrl) return;
    $("preview").classList.add("corrected");
    $("originalTab").classList.remove("on");
    $("correctedTab").classList.add("on");
  }
  function displaySelection(rect) {
    const el = $("selection");
    if (!rect || !session) { el.classList.remove("active"); return; }
    el.classList.add("active");
    el.style.left = (100 * rect.x / session.width) + "%";
    el.style.top = (100 * rect.y / session.height) + "%";
    el.style.width = (100 * rect.width / session.width) + "%";
    el.style.height = (100 * rect.height / session.height) + "%";
  }
  function chooseMode() {
    selected = mode() === "auto" ? automatic : (mode() === "manual" ? selected : null);
    if (mode() === "auto") {
      selected = automatic;
      $("instructions").textContent = "Se utiliza el cuadro detectado automáticamente. Si está incompleto, cambia a selección manual.";
    } else {
      if (selected === automatic) selected = null;
      $("instructions").textContent = "Arrastra sobre la portada para marcar TODO el cuadro, incluidos nombres, cargos y bordes.";
    }
    $("drawLayer").classList.toggle("active", mode() === "manual" && !!session);
    displaySelection(selected);
    $("process").disabled = busy || !session || !selected;
    $("detectMessage").textContent = session
      ? (mode() === "auto" ? (automatic ? "✓ Cuadro encontrado. Comprueba el recuadro azul." : "No encontrado. Usa selección manual.")
        : (selected ? "✓ Área marcada. Revísala antes de preparar." : "Dibuja un rectángulo sobre la tabla."))
      : "";
    if (!busy && outputUrl) clearOutput();
  }
  async function reset() {
    if (busy) return;
    clearOutput();
    const old = session;
    session = null; sourceFile = null; automatic = null; selected = null;
    $("fileInput").value = "";
    $("picked").classList.remove("active");
    $("blank").style.display = "flex";
    canvas.style.display = "none";
    $("drawLayer").classList.remove("active");
    displaySelection(null);
    alertMessage("");
    $("detectMessage").textContent = "";
    $("process").disabled = true;
    if (old) await old.dispose();
    setMode("auto");
  }
  async function loadFile(file) {
    if (!file || busy) return;
    setBusy(true);
    const old = session;
    session = null; selected = null; automatic = null;
    clearOutput();
    $("picked").classList.remove("active");
    $("detectMessage").textContent = "";
    alertMessage("Analizando el documento en este navegador…", "info");
    try {
      if (old) await old.dispose();
      const next = await window.UbicarPDF.createSession(file);
      session = next;
      sourceFile = file;
      const rect = await next.render(canvas);
      automatic = rect;
      canvas.style.display = "block";
      $("blank").style.display = "none";
      $("fileName").textContent = file.name + " · " + next.pages + (next.pages === 1 ? " página" : " páginas");
      $("picked").classList.add("active");
      if (rect) {
        document.querySelector('input[name="mode"][value="auto"]').checked = true;
        selected = rect;
        alertMessage("Tabla detectada. Verifica el recuadro azul.", "info");
      } else {
        document.querySelector('input[name="mode"][value="manual"]').checked = true;
        selected = null;
        alertMessage("No se detectó de forma segura. Selecciona la tabla arrastrando sobre la portada.", "info");
      }
      chooseMode();
    } catch (err) {
      sourceFile = null;
      if (session) { await session.dispose(); session = null; }
      $("blank").style.display = "flex"; canvas.style.display = "none";
      alertMessage(err.message || "No se pudo abrir el archivo.", "error");
    } finally {
      setBusy(false);
    }
  }
  function eventPoint(evt) {
    const b = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(session.width, (evt.clientX - b.left) * session.width / b.width)),
      y: Math.max(0, Math.min(session.height, (evt.clientY - b.top) * session.height / b.height))
    };
  }
  function rectFromPoints(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
  }
  $("drawLayer").addEventListener("pointerdown", event => {
    if (!session || busy || mode() !== "manual") return;
    pointerStart = eventPoint(event);
    $("drawLayer").setPointerCapture(event.pointerId);
    selected = null;
    clearOutput();
    displaySelection(null);
  });
  $("drawLayer").addEventListener("pointermove", event => {
    if (!pointerStart || !session) return;
    displaySelection(rectFromPoints(pointerStart, eventPoint(event)));
  });
  $("drawLayer").addEventListener("pointerup", event => {
    if (!pointerStart || !session) return;
    const r = rectFromPoints(pointerStart, eventPoint(event));
    pointerStart = null;
    if (window.UbicarPDF.validRect(r, session.width, session.height)) {
      selected = r; alertMessage("");
    } else {
      selected = null;
      alertMessage("Marca toda la tabla: el rectángulo debe abarcar al menos el 35 % del ancho de la hoja y tener altura suficiente.", "error");
    }
    chooseMode();
  });
  $("drawLayer").addEventListener("pointercancel", () => {
    pointerStart = null; displaySelection(selected);
  });
  $("process").addEventListener("click", async () => {
    if (!session || !selected || busy) return;
    setBusy(true);
    alertMessage("Validando y preparando las páginas…", "info");
    $("progress").classList.add("active");
    $("progressBar").style.width = "4%";
    try {
      const blob = await session.process(selected, (done, total) => {
        $("progressBar").style.width = Math.round(5 + 90 * done / total) + "%";
      });
      outputUrl = URL.createObjectURL(blob);
      $("download").href = outputUrl;
      $("download").download = sourceFile.name.replace(/\.pdf$/i, "") + "_CARTA.pdf";
      $("download").classList.add("active");
      $("corrected").src = outputUrl + "#view=FitH";
      $("correctedTab").disabled = false;
      $("progressBar").style.width = "100%";
      alertMessage("Documento generado. Revisa el PDF corregido antes de descargarlo o firmarlo.", "success");
      showCorrected();
    } catch (err) {
      $("progress").classList.remove("active");
      alertMessage(err.message || "No fue posible preparar el PDF.", "error");
    } finally { setBusy(false); }
  });
  $("originalTab").addEventListener("click", showOriginal);
  $("correctedTab").addEventListener("click", showCorrected);
  $("remove").addEventListener("click", reset);
  document.querySelectorAll('input[name="mode"]').forEach(el => {
    el.addEventListener("change", chooseMode);
  });
  $("drop").addEventListener("click", () => { if (!busy) $("fileInput").click(); });
  $("drop").addEventListener("keydown", evt => {
    if (evt.key === "Enter" || evt.key === " ") { evt.preventDefault(); if (!busy) $("fileInput").click(); }
  });
  $("fileInput").addEventListener("change", evt => loadFile(evt.target.files[0]));
  for (const name of ["dragover", "dragenter"]) $("drop").addEventListener(name, evt => {
    evt.preventDefault(); $("drop").classList.add("drag");
  });
  for (const name of ["dragleave", "drop"]) $("drop").addEventListener(name, evt => {
    evt.preventDefault(); $("drop").classList.remove("drag");
  });
  $("drop").addEventListener("drop", evt => loadFile(evt.dataTransfer.files[0]));
  window.addEventListener("beforeunload", () => { if (outputUrl) URL.revokeObjectURL(outputUrl); });
})();
