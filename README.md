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

## Aplicación de escritorio (Electron)

La aplicación funciona como **ventana de escritorio Electron** y usa internamente Python/FastAPI para los PDF. El usuario no tiene que abrir manualmente servidores ni usar el navegador.

### Abrir desde Visual Studio Code (Windows)

Requisitos para desarrollar: **Node.js 20 o superior** y **Python 3.9 o superior** instalados.

Desde la raíz del repositorio:

```powershell
npm install
npm start
```

- `npm install` prepara `.venv` e instala las dependencias del procesador Python, además de descargar Electron.
- `npm start` abre una ventana independiente de Electron; inicia el backend en un puerto local libre y sirve la interfaz desde otro puerto local libre.
- `npm run dev` abre la ventana con herramientas de desarrollo.
- `npm test` ejecuta pruebas automatizadas del servidor local.
- Cierra la ventana para detener el servidor local. No requiere conexión a Render para procesar los PDF.

**Si `git pull` indica que un `package-lock.json` local sería sobreescrito**, esta versión deja de publicarlo; después de actualizar se generará uno local durante `npm install`. No elimines tus archivos de trabajo.

### Crear instalador de Windows

En Windows, con Node.js y Python instalados, ejecuta:

```powershell
npm install
npm run dist:win
```

El proceso compila primero el backend Python usando PyInstaller y después crea el instalador de Electron con electron-builder. Los artefactos se guardan en `release/`. **El instalador generado incluye el backend**: el usuario final no necesita instalar Python ni Node.js.

El backend compilado permanece en `build/backend-dist/` y no se sube a GitHub. Para distribuir el instalador es recomendable firmarlo digitalmente.

### Modo web

La interfaz `web/index.html` sigue disponible en GitHub Pages y utiliza el backend alojado en Render. En Electron usa únicamente su backend local.

## Despliegue

1. En GitHub → Settings → Pages → Source, seleccionar **GitHub Actions**.
2. La web se publica automáticamente al actualizar `web/` en `main`.
3. Crear un servicio web Python en Render desde este repositorio, rama `main`, plan gratuito.
4. Build: `pip install -r backend/requirements.txt`.
5. Start: `uvicorn backend.app:app --host 0.0.0.0 --port $PORT`.
6. Comprobar la API `/api/health`. Si Render asigna un dominio distinto del previsto, cambiar la constante `API` dentro de `web/index.html`.

Las pruebas sintéticas no sustituyen la revisión visual del PDF corregido antes de enviarlo al firmador.
