"""Pruebas de regresión con documentos sintéticos; no se versionan PDFs privados."""
import fitz
import pytest

from backend.app import detect_table, process, target_rect


def make_pdf(paper=(595, 842)):
    pdf = fitz.open()
    cover = pdf.new_page(width=paper[0], height=paper[1])
    cover.insert_text((80, 130), "Título del informe")
    left, right, top, bottom = 88, paper[0] - 74, 632, 740
    col = (right - left) / 3
    for j, name in enumerate(("ELABORADO POR:", "REVISADO POR:", "APROBADO POR:")):
        cover.insert_text((left + 26 + j * col, top + 11), name, fontsize=9)
        cover.insert_text((left + 6 + j * col, top + 82), "Nombre: Persona " + str(j + 1), fontsize=8)
        cover.insert_text((left + 6 + j * col, top + 97), "Cargo: Cargo " + str(j + 1), fontsize=8)
    for y in (top, top + 70, top + 87, bottom):
        for j in range(3):
            cover.draw_line((left + col * j, y), (left + col * (j + 1), y))
    for x in (left, left + col, left + col * 2, right):
        cover.draw_line((x, top), (x, bottom))
    next_page = pdf.new_page(width=paper[0], height=paper[1])
    next_page.insert_text((80, 170), "Segunda página intacta")
    return pdf


def test_detects_three_columns_with_variable_names():
    pdf = make_pdf()
    try:
        detection = detect_table(pdf[0])
        assert detection.mode == "automatico"
        assert detection.rect.width > 400
        assert detection.rect.y0 < 640 < detection.rect.y1
    finally:
        pdf.close()


def test_normalizes_every_page_and_moves_table_without_duplication():
    pdf = make_pdf()
    try:
        result = fitz.open(stream=process(pdf, detect_table(pdf[0])), filetype="pdf")
        try:
            assert len(result) == 2
            assert all(abs(p.rect.width - 612) < 0.01 and abs(p.rect.height - 792) < 0.01 for p in result)
            words = result[0].get_text()
            assert words.count("ELABORADO POR:") == 1
            assert "Persona 3" in words
            assert "Segunda página intacta" in result[1].get_text()
            b = target_rect()
            assert 620 <= b.y0 <= 630
            assert 735 <= b.y1 <= 745
        finally:
            result.close()
    finally:
        pdf.close()


def test_refuses_missing_signatures():
    pdf = fitz.open()
    pdf.new_page(width=612, height=792).insert_text((100, 200), "No hay cuadro")
    try:
        with pytest.raises(ValueError):
            detect_table(pdf[0])
    finally:
        pdf.close()
