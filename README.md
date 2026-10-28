# Ubicarportads

**Aplicación para preparar portadas PDF antes de enviarlas a firma electrónica.** Normaliza el documento a tamaño Carta y reubica el cuadro **Elaborado / Revisado / Aprobado** en la parte inferior de la primera página. No aplica firmas.

## Abrir la aplicación web

https://jeffer91.github.io/Ubicarportads/

**GitHub Pages procesa los PDF en el navegador, sin llamar a Render ni requerir Python, Electron o instalación.** Los archivos no se suben a un servidor: se abren y transforman localmente con PDF.js 3.11.174 y pdf-lib 1.17.1. Es necesario disponer de conexión a Internet para cargar inicialmente las bibliotecas JavaScript desde cdnjs.

## Uso

1. Arrastra o selecciona un PDF (hasta 30 MB y 250 páginas).
2. La portada aparece con un recuadro azul si se detectan bordes horizontales y los tres encabezados.
3. Si no se detecta, elige **Seleccionar sobre PDF**, y arrastra un rectángulo que contenga el cuadro entero. En un documento escaneado también puedes utilizar esta selección manual.
4. Pulsa **Preparar documento**, comprueba la versión corregida y descarga el PDF.

## Geometría y seguridad

- Papel final: Carta, 612 × 792 pt.
- Área objetivo: 18 × 4,2 cm; parte inferior a 1,8 cm del borde de la página.
- Reubica el cuadro **sin estirarlo**: se escala proporcionalmente y se centra en el área objetivo.
- La primera página se reconstruye por regiones recortadas para retirar el cuadro antiguo, preservando el resto de la capa PDF. Las páginas siguientes se insertan escaladas a Carta.
- Se rechazan PDF protegidos, con campos o datos de firma digital, con anotaciones interactivas, páginas rotadas, recortes de portada incompatibles y documentos cuyo área de destino contenga contenido ajeno al cuadro. Algunos PDF escaneados y diseños complejos no podrán procesarse de forma segura.
- Los archivos con firma electrónica **no deben modificarse después de firmarse**.
- El tamaño de salida y el contenido deben revisarse visualmente antes de usar el documento. Las pruebas sintéticas no garantizan compatibilidad con todos los PDF.
- El original sigue en el equipo y no se altera.

### Pruebas de la web

La publicación de GitHub Pages ejecuta previamente tres comprobaciones: sintaxis de los dos scripts JavaScript y pruebas de geometría y detección mediante Node.

Si fallan las pruebas, no se publica la versión nueva.

## Otros componentes históricos

Las carpetas backend/, electron/ y scripts/ permanecen para el modo de escritorio y la API opcional. **No participan en la versión web de GitHub Pages**. El servicio de Render no se requiere para procesar archivos en la web.

## Archivos web

- web/index.html: interfaz compacta y adaptable a móvil.
- web/js/app.js: eventos, selección visual, visualización, descargas y mensajes.
- web/js/pdf-engine.js: reconocimiento de encabezados, bordes, comprobaciones y reconstrucción PDF.
- web/tests/: pruebas de geometría, sintaxis y detección.
- .github/workflows/pages.yml: pruebas y publicación desde main.
