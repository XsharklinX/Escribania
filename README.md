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

Compila la app, el instalador propio (`installer/`) y la herramienta de firma
(`tools/firma`), y deja en `release\v<versión>\`:

- `Escribania-<versión>-Setup.exe`: instalador propio. Instala para el usuario en
  `%LOCALAPPDATA%\Programs\Escribania` sin pedir administrador, o portable en la
  carpeta que se elija. Queda como `desinstalar.exe`, que también repara.
  En silencio: `/S` (opcionales `/D=carpeta`, `/portable`, `/sinescritorio`);
  `desinstalar.exe --desinstalar /S` desinstala conservando los datos.
- `Escribania-<versión>-Portable.zip`: descomprimir y ejecutar `Escribania.exe`. El
  archivo `portable` que va al lado hace que ajustes, copias y cuaderno se guarden en
  `Datos\`, junto al programa (para llevarlo en un USB).
- `Escribania-<versión>-x64.exe` y su `.sig`: el programa solo, para el actualizador.
- `latest.json`: versión, notas (de `notas/<versión>.json`), URL, SHA-256 y firma.
- `SHA256SUMS.txt`.

Se publican todos en una release de GitHub con la etiqueta `v<versión>`
(`gh release create v0.8.0 release\v0.8.0\*`).

### Actualizaciones y firma

- El repositorio de GitHub se indica en `src-tauri/actualizaciones.json` (`"repo": "usuario/escribania"`).
  Sin él, la app no busca actualizaciones.
- Las descargas se comprueban con ed25519. La clave privada vive fuera del repositorio,
  en `%USERPROFILE%\.escribania\firma.key` (o en la variable `ESCRIBANIA_FIRMA`); la
  pública está en `src-tauri/firma.pub`. **Haz copia de la clave privada**: sin ella las
  copias ya instaladas no aceptarán nuevas versiones. Se crea con
  `cargo run --release --manifest-path tools/firma/Cargo.toml -- clave`.
- La versión anterior queda como `Escribania.old.exe`: Ajustes › Datos permite volver a
  ella, y si una versión nueva no llega a mostrar la ventana, el siguiente arranque
  vuelve sola a la anterior.

Los ejecutables no van firmados con certificado: Windows SmartScreen avisará la primera vez.
En Linux, `npx tauri build` genera AppImage y .deb (el AppImage también se actualiza solo).

## Formato de proyecto

```
La casa del faro/
├─ La casa del faro.escribania   árbol, Códice, relaciones, murales, metas (JSON)
├─ texto/                        textos: cabecera YAML (id, título) + Markdown
├─ codice/                       descripción de cada ficha del Códice (.md)
├─ texto/variantes/              otras versiones de una escena (la activa está en texto/)
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
En la carpeta de datos también están los estilos de imprenta (`estilos.json`), los temas
propios (`temas.json`) y las extensiones (`extensiones.json`).
Mientras el proyecto está abierto hay un archivo `.escribania-abierto` (candado para avisar
si se abre en otro equipo a la vez cuando el proyecto está en Dropbox, OneDrive…).
Una saga es un archivo `<Nombre>.saga.json` con las fichas compartidas por varios libros.

Las extensiones son archivos `.js` que se ejecutan en un Worker sin acceso a la ventana,
los archivos ni la red:

```js
// @name Quitar dobles espacios
// @description Deja un solo espacio entre palabras.
escribania.command("Quitar dobles espacios", (scene) => ({ replace: scene.text.replace(/ {2,}/g, " ") }));
```

La función recibe `{ title, text, selection }` y devuelve `replace`, `insert` y/o `message`.

## Estructura del código

- `src-tauri/src/`: núcleo en Rust (rutas instalado/portable, escritura atómica,
  proyectos, copias de seguridad).
- `src/lib/`: lógica de la interfaz (árbol, Markdown, guardado automático, exportación,
  sonido ambiente, idiomas).
- `src/components/`: pantallas y paneles.
- `installer/`: instalador, desinstalador y reparador propios (Tauri, solo Windows).
- `tools/firma/`: firma de las versiones para el actualizador.
- `scripts/tesauro.py`: prepara los diccionarios de sinónimos de `public/thes/`.

La hoja de ruta está en [ROADMAP.md](ROADMAP.md).
