# Escribanía

Software libre de escritorio para escritores: escribe, estructura y termina tu libro.
Funciona sin conexión, sin cuentas, y guarda tus textos como archivos Markdown en la
carpeta que elijas. Licencia GPL-3.0.

## Desarrollo

Necesitas Node 20+ y Rust estable.

```
npm install
npm run app          # abre la app en modo desarrollo (tauri dev)
npm test             # tests de la interfaz (vitest)
cargo test --manifest-path src-tauri/Cargo.toml   # tests del núcleo
```

## Versiones para distribuir

```
npm run build:release
```

Deja en `release\v<versión>\`:

- `Escribania-<versión>-Setup.exe`: instalador por usuario (no pide administrador).
- `Escribania-<versión>-Portable.zip`: descomprimir y ejecutar `Escribania.exe`. El
  archivo `portable` que va al lado hace que ajustes, copias y proyectos nuevos se
  guarden en `Datos\`, junto al programa (para llevarlo en un USB).
- `SHA256SUMS.txt`.

Los ejecutables no van firmados: Windows SmartScreen avisará la primera vez.
En Linux, `npx tauri build` genera AppImage y .deb.

## Formato de proyecto

```
La casa del faro/
├─ La casa del faro.escribania   árbol, Códice, relaciones, murales, metas (JSON)
├─ texto/                        textos: cabecera YAML (id, título) + Markdown
├─ codice/                       descripción de cada ficha del Códice (.md)
├─ capas/<id del texto>/         instantáneas de cada texto (.md)
├─ recursos/                     retratos e imágenes del Mural
├─ investigacion/                PDF, imágenes y páginas web guardadas
└─ bitacora.json                 sesiones, días escritos, carreras y retos
```

El árbol vive en el `.escribania`; cada texto es un `.md` legible con cualquier editor.
Los comentarios de Marginalia se guardan dentro del Markdown como
`{{c:id}}texto comentado{{/c}}` y su contenido va en el `.escribania`.
El Cuaderno de ideas no pertenece a ningún proyecto: está en `cuaderno.json`, en la
carpeta de datos de la app.
Las copias de seguridad (`.zip` del proyecto entero) van a la carpeta de datos de la app,
en `copias/<proyecto>/`.

## Estructura del código

- `src-tauri/src/`: núcleo en Rust (rutas instalado/portable, escritura atómica,
  proyectos, copias de seguridad).
- `src/lib/`: lógica de la interfaz (árbol, Markdown, guardado automático, exportación,
  sonido ambiente, idiomas).
- `src/components/`: pantallas y paneles.

La hoja de ruta está en [ROADMAP.md](ROADMAP.md).
