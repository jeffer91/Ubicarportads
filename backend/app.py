"""Ubicarportads: normalización de PDFs y reubicación de la tabla de firmas.

No añade firmas digitales, no almacena archivos y nunca modifica un PDF firmado.
"""
from __future__ import annotations

import io
import os
import re
import unicodedata
from dataclasses import dataclass

import fitz
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

APP_VERSION = "1.0.0"
LETTER_W, LETTER_H = 612.0, 792.0
CM = 72 / 2.54
TABLE_W, TABLE_H = 18 * CM, 4.2 * CM
BOTTOM_GAP = 1.8 * CM
MAX_UPLOAD = 30 * 1024 * 1024
MAX_PAGES = 250

app = FastAPI(
    title="Ubicarportads API",
    version=APP_VERSION,
    description="PDF Carta con cuadro de firmas reposicionado, sin agregar firmas.",
    docs_url="/api/docs",
    redoc_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://jeffer91.github.io",
        "http://localhost:8000",
        "http://localhost:5500",
        "http://127.0.0.1:5500",
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
    expose_headers=["X-Page-Count", "X-Detection-Mode", "X-Source-Paper"],
)


@dataclass(frozen=True)
class Detection:
    rect: fitz.Rect
    mode: str


def plain(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).upper().strip(":., ")


def get_heading(page: fitz.Page) -> tuple[float, list[float]]:
    """Confirma tres encabezados alineados; no depende de nombres ni cargos."""
    candidates = []
    for w in page.get_text("words"):
        if plain(str(w[4])) in ("ELABORADO", "REVISADO", "APROBADO"):
            if page.rect.height * 0.45 < w[1] < page.rect.height * 0.94:
                candidates.append((plain(str(w[4])), float(w[0]), float(w[1])))
    for el in candidates:
        if el[0] != "ELABORADO":
            continue
        rv = next((w for w in candidates if w[0] == "REVISADO" and
                   w[1] > el[1] + 35 and abs(w[2] - el[2]) < 16), None)
        ap = next((w for w in candidates if w[0] == "APROBADO" and
                   rv is not None and w[1] > rv[1] + 35 and
                   abs(w[2] - el[2]) < 16), None)
        if rv is not None and ap is not None:
            return el[2], [el[1], rv[1], ap[1]]
    raise ValueError("No se identificaron los tres encabezados alineados: Elaborado, Revisado y Aprobado.")


def detect_table(page: fitz.Page) -> Detection:
    label_y, anchors = get_heading(page)
    lines = []
    verticals = []
    for d in page.get_drawings():
        r = d["rect"]
        if r.width >= 25 and r.height <= 2.8 and label_y - 20 <= r.y0 <= label_y + 240:
            lines.append(r)
        if r.height >= 9 and r.width <= 2.8 and label_y - 20 <= r.y0 <= label_y + 240:
            verticals.append(r)

    groups = []
    for r in sorted(lines, key=lambda v: v.y0):
        if not groups or abs(groups[-1][0] - r.y0) > 2.5:
            groups.append([r.y0, [r]])
        else:
            groups[-1][1].append(r)
    rows = []
    for y, segments in groups:
        xmin = min(r.x0 for r in segments)
        xmax = max(r.x1 for r in segments)
        if xmax - xmin >= page.rect.width * 0.57:
            rows.append((y, xmin, xmax))
    starts = [row for row in rows if abs(row[0] - label_y) < 15
              and row[1] < anchors[0] and row[2] > anchors[2]]
    if not starts:
        raise ValueError("Se encontraron los responsables, pero no los bordes de la tabla.")
    start = min(starts, key=lambda r: abs(r[0] - label_y))
    matching = [r for r in rows if
                start[0] + 50 <= r[0] <= min(start[0] + 220, page.rect.height - 28)
                and abs(r[1] - start[1]) <= 15
                and abs(r[2] - start[2]) <= 15]
    if not matching:
        raise ValueError("No se pudo confirmar el borde inferior del cuadro de firmas.")
    end = max(matching, key=lambda r: r[0])
    xs = sorted(set(round(v.x0 / 2) * 2 for v in verticals
                    if v.y0 >= start[0] - 2 and v.y1 <= end[0] + 3
                    and start[1] - 4 <= v.x0 <= start[2] + 4))
    if len(xs) < 4:
        raise ValueError("El bloque detectado no presenta las tres columnas requeridas.")

    rect = fitz.Rect(start[1] - 1, start[0] - 1, start[2] + 1, end[0] + 2)
    if rect.width < 200 or rect.height < 55 or rect.height > 225:
        raise ValueError("Las dimensiones detectadas del cuadro no son válidas.")
    return Detection(rect, "automatico")


def manual_table(page: fitz.Page, x: float, y: float, w: float, h: float) -> Detection:
    if any(not 0 <= v <= 100 for v in (x, y, w, h)) or w < 20 or h < 4:
        raise ValueError("Los valores manuales deben ser porcentajes válidos.")
    if x + w > 100 or y + h > 100:
        raise ValueError("El rectángulo manual excede los límites de la portada.")
    r = fitz.Rect(x * page.rect.width / 100, y * page.rect.height / 100,
                  (x + w) * page.rect.width / 100, (y + h) * page.rect.height / 100)
    label_y, labels = get_heading(page)
    if not (r.y0 - 4 <= label_y <= r.y1 and r.x0 < labels[0] < labels[2] < r.x1):
        raise ValueError("El área manual debe incluir los tres encabezados de responsabilidad.")
    return Detection(r, "manual")


def target_rect() -> fitz.Rect:
    left = (LETTER_W - TABLE_W) / 2
    bottom = LETTER_H - BOTTOM_GAP
    return fitz.Rect(left, bottom - TABLE_H, left + TABLE_W, bottom)


def check_target_clear(page: fitz.Page, source: fitz.Rect, dest: fitz.Rect) -> None:
    """Evita tapar texto ajeno a la tabla en su destino."""
    w, h = page.rect.width, page.rect.height
    scale = min(LETTER_W / w, LETTER_H / h)
    offx, offy = (LETTER_W - w * scale) / 2, (LETTER_H - h * scale) / 2
    for word in page.get_text("words"):
        r = fitz.Rect(word[:4])
        if source.intersects(r) and (source & r).get_area() > r.get_area() * 0.7:
            continue
        mapped = fitz.Rect(offx + r.x0 * scale, offy + r.y0 * scale,
                           offx + r.x1 * scale, offy + r.y1 * scale)
        if mapped.intersects(dest) and (mapped & dest).get_area() > mapped.get_area() * 0.15:
            raise ValueError("La posición estándar se superpone a otro contenido de la portada.")


def place_pdf_piece(dst: fitz.Page, src: fitz.Document, index: int,
                    part: fitz.Rect, scale: float, ox: float, oy: float) -> None:
    if part.width < 0.5 or part.height < 0.5:
        return
    target = fitz.Rect(ox + part.x0 * scale, oy + part.y0 * scale,
                       ox + part.x1 * scale, oy + part.y1 * scale)
    dst.show_pdf_page(target, src, index, clip=part, keep_proportion=False)


def process(source: fitz.Document, detection: Detection) -> bytes:
    new = fitz.open()
    fixed = target_rect()
    check_target_clear(source[0], detection.rect, fixed)
    try:
        for i, original in enumerate(source):
            width, height = original.rect.width, original.rect.height
            if width <= 0 or height <= 0:
                raise ValueError("El documento contiene una página con dimensiones inválidas.")
            scale = min(LETTER_W / width, LETTER_H / height)
            ox, oy = (LETTER_W - width * scale) / 2, (LETTER_H - height * scale) / 2
            dst = new.new_page(width=LETTER_W, height=LETTER_H)
            if i:
                place_pdf_piece(dst, source, i, original.rect, scale, ox, oy)
                continue
            r = detection.rect
            pieces = [
                fitz.Rect(0, 0, width, r.y0),
                fitz.Rect(0, r.y1, width, height),
                fitz.Rect(0, r.y0, r.x0, r.y1),
                fitz.Rect(r.x1, r.y0, width, r.y1),
            ]
            for part in pieces:
                place_pdf_piece(dst, source, i, part, scale, ox, oy)
            dst.show_pdf_page(fixed, source, 0, clip=r, keep_proportion=False)

        new.set_metadata({
            "title": (source.metadata or {}).get("title", "") or "PDF normalizado - Ubicarportads",
            "producer": "Ubicarportads / PyMuPDF",
        })
        return new.tobytes(garbage=3, deflate=True)
    finally:
        new.close()


@app.get("/api/health")
def health():
    return {"ok": True, "version": APP_VERSION, "paper": "Carta", "backend": "PyMuPDF"}


@app.post("/api/process")
async def process_pdf(
    file: UploadFile = File(...),
    mode: str = Form("auto"),
    x: float = Form(0),
    y: float = Form(0),
    w: float = Form(0),
    h: float = Form(0),
):
    name = file.filename or "documento.pdf"
    if not name.lower().endswith(".pdf"):
        raise HTTPException(400, "Selecciona un archivo PDF.")
    data = await file.read(MAX_UPLOAD + 1)
    await file.close()
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "El PDF supera el límite de 30 MB.")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(400, "El archivo no es un PDF válido.")
    try:
        pdf = fitz.open(stream=data, filetype="pdf")
    except Exception:
        raise HTTPException(400, "No fue posible abrir el PDF.")
    try:
        if pdf.needs_pass:
            raise HTTPException(422, "No se admiten PDF protegidos con contraseña.")
        if not 1 <= len(pdf) <= MAX_PAGES:
            raise HTTPException(422, "El PDF debe tener entre 1 y 250 páginas.")
        if pdf.get_sigflags() != -1:
            raise HTTPException(422, "Este PDF contiene campos de firma digital. Por seguridad no se modificará.")
        if mode not in ("auto", "manual"):
            raise HTTPException(400, "Modo de procesamiento desconocido.")
        try:
            det = detect_table(pdf[0]) if mode == "auto" else manual_table(pdf[0], x, y, w, h)
            output = process(pdf, det)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        except (RuntimeError, fitz.FileDataError):
            raise HTTPException(422, "El PDF no pudo normalizarse de manera segura.")
        safe_name = re.sub(r"[^a-zA-Z0-9_.-]", "_", name.rsplit(".", 1)[0])[:90]
        filename = f"{safe_name}_CARTA.pdf"
        return Response(
            content=output,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Cache-Control": "no-store",
                "X-Page-Count": str(len(pdf)),
                "X-Detection-Mode": det.mode,
                "X-Source-Paper": f"{pdf[0].rect.width:.1f}x{pdf[0].rect.height:.1f}pt",
            },
        )
    finally:
        pdf.close()
