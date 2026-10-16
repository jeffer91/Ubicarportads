# Ubicarportads

Aplicación web para preparar PDFs **antes** de enviarlos al sistema externo de firma electrónica: normaliza todas las páginas a Carta y sitúa la tabla de tres responsables en la parte inferior de la portada. **No agrega ni aplica firmas**.

## Enlaces

- Web: https://jeffer91.github.io/Ubicarportads/
- Backend previsto: https://ubicarportads-api.onrender.com/api/health
- Código fuente: https://github.com/jeffer91/Ubicarportads

## Arquitectura

- `web/index.html`: aplicación visual estática que se publica en GitHub Pages.
- `backend/app.py`: FastAPI y PyMuPDF, detección de cuadro, movimiento y normalización.
- `backend/requirements.txt`: dependencias Python.
- `backend/tests/test_app.py`: pruebas automáticas con PDFs sintéticos.
- `.github/workflows/pages.yml`: despliegue de la web automáticamente desde `main`.
- `.github/workflows/tests.yml`: validaciones del backend en commits.
- `render.yaml`: configuración para alojar el backend en Render.

GitHub Pages no ejecuta Python. **Para procesar PDFs desde la página es imprescindible desplegar también el servicio del backend**.

## Flujo

1. Subir PDF de 30 MB como máximo, 1–250 páginas.
2. Detectar tres encabezados alineados: ELABORADO / REVISADO / APROBADO, junto con la tabla de tres columnas.
3. Si es necesario, utilizar selección manual del rectángulo mediante porcentajes. Se comprueba que incluya los tres encabezados.
4. Convertir todas las páginas a **Carta 612 × 792 pt (21,59 × 27,94 cm)**, sin recortar contenido.
5. En la primera página, reconstruir todo salvo el cuadro antiguo y reinsertarlo en la zona estándar sin duplicarlo.
6. Mostrar vista previa y permitir descargar el PDF final.

## Geometría de la tabla

- Ancho estándar: 18,00 cm.
- Alto estándar: 4,20 cm.
- Centrado horizontal, borde inferior a 1,80 cm del borde inferior de la hoja.
- Conserva nombres y cargos como aparecen en el documento; no se consideran valores fijos.
- No genera firmas electrónicas ni códigos QR.

Por decisión del proyecto se utiliza Carta, aunque la guía institucional aportada especifica A4 para sus plantillas.

## Seguridad

Los PDFs se procesan en memoria y no se almacenan en el backend. Se rechazan archivos con campos de firmas digitales, protegidos con contraseña o cuyos contenidos se superpondrían al área de destino. Si no puede identificarse con seguridad la tabla, devuelve un error en lugar de modificar el documento incorrectamente. Los PDFs escaneados sin texto o líneas vectoriales pueden requerir preparación previa.

**No subir documentos institucionales con datos personales al repositorio público.** No modificar un documento después de que ya fue firmado digitalmente.

## Desarrollo local con npm

Requisitos: **Node.js 18 o superior y Python 3.9 o superior** instalados.

Desde la raíz del repositorio:

1. Ejecutar `npm install`: crea el entorno virtual `.venv` e instala las dependencias Python.
2. Ejecutar `npm start`: inicia la web en `http://localhost:5500` y la API en `http://localhost:8000`.
3. Abrir `http://localhost:5500` en el navegador. `Ctrl+C` detiene ambos servicios.
4. Para desarrollo con recarga automática del backend, usar `npm run dev`.

La web detecta automáticamente `localhost` y se conecta a la API local; en GitHub Pages sigue utilizando el backend publicado en Render. El procesamiento de PDFs **sigue siendo Python/FastAPI**, mientras que npm prepara y arranca toda la aplicación.

Para las pruebas del backend, después de `npm install`:

- Windows: `.venv\\Scripts\\python.exe -m pip install pytest` y `.venv\\Scripts\\python.exe -m pytest -q backend/tests`.
- Linux/macOS: `.venv/bin/python -m pip install pytest` y `.venv/bin/python -m pytest -q backend/tests`.

## Despliegue

1. En GitHub → Settings → Pages → Source, seleccionar **GitHub Actions**.
2. La web se publica automáticamente al actualizar `web/` en `main`.
3. Crear un servicio web Python en Render desde este repositorio, rama `main`, plan gratuito.
4. Build: `pip install -r backend/requirements.txt`.
5. Start: `uvicorn backend.app:app --host 0.0.0.0 --port $PORT`.
6. Comprobar la API `/api/health`. Si Render asigna un dominio distinto del previsto, cambiar la constante `API` dentro de `web/index.html`.

Las pruebas sintéticas no sustituyen la revisión visual del PDF corregido antes de enviarlo al firmador.
