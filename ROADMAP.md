# Escribanía · hoja de ruta

Software libre (GPL-3.0) de escritorio para escritores. Interfaz en React dentro de
Tauri 2, núcleo en Rust. Windows y Linux en la 1.0; español e inglés.

Cada fase termina con una versión que se puede usar.

## F0 · Cimientos ✅ (0.1)
- [x] **Formato abierto**: un proyecto es una carpeta con `<Título>.escribania` (JSON) y `texto/*.md` (cabecera YAML + Markdown).
- [x] **Salvavidas**: escritura atómica, autoguardado (1 s tras teclear), copias `.zip` al abrir, cada N minutos y al cerrar, con rotación.
- [x] Textos huérfanos (en `texto/` pero fuera del árbol) se recuperan en Notas › Recuperados.
- [x] **Instalador** NSIS por usuario (sin administrador), con asociación de archivos `.escribania`.
- [x] **Portable**: archivo `portable` junto al `.exe` → datos en `.\Datos`. Zip generado por `scripts/package-release.ps1`.
- [x] Linux: AppImage y .deb configurados (sin probar todavía).
- [x] CI preparado en `.github/workflows/release.yml` (se activa cuando el proyecto tenga repositorio propio).

## F1 · Escribir ✅ (0.1)
- [x] **La Hoja**: editor con tipografía de libro, sangría o espacio entre párrafos, raya de diálogo (`--` → —), comillas « » o “ ”, `...` → …, separador de escena ❦, modo máquina de escribir.
- [x] **El Legajo**: Manuscrito, Notas y Papelera; arrastrar y soltar, estados (idea, borrador, revisado, final), incluir/excluir del libro, recuento por texto y carpeta, menú contextual, teclado (flechas, F2, Supr).
- [x] **Retiro**: pantalla completa, atenúa todo menos el párrafo activo, sonido ambiente generado en local (lluvia, chimenea, mar).
- [x] **Plantillas de proyecto**: novela, cuentos, ensayo, poemario, guion, en blanco.
- [x] Inspector: título, estado, sinopsis, notas y meta de palabras por texto.
- [x] Barra de estado: texto, carpeta, libro y sesión; estado del guardado.
- [x] Temas Algodón, Tinta, Olivetti y Pizarra; Literata, Source Serif, Courier Prime y Georgia.
- [x] Exportar a Word (.docx, incluido formato de manuscrito estándar), Markdown, HTML y texto.
- [x] Español e inglés.
- [x] **Buscar y reemplazar en el proyecto** (Ctrl+Shift+F): en Manuscrito, Investigación, Notas y Códice; mayúsculas, palabra completa y expresiones regulares; resalta en el texto abierto; antes de reemplazar guarda una capa de cada texto.

## F2 · Estructurar ✅ (0.4)
- [x] **Corcho**: fichas con chincheta del color del POV, sinopsis editable, arrastrar para reordenar (también dentro de carpetas), vista de carpeta o de todo el libro.
- [x] **Escaleta**: tabla editable (título, sinopsis, POV, día, estado, palabras, meta, incluir), columnas a elegir, exportar a CSV.
- [x] **Moldes de estructura**: Tres actos, Save the Cat, Viaje del héroe, Siete puntos, Kishōtenketsu; barra del libro a escala, «estás aquí» y desviación de cada momento.
- [x] **Capas**: instantáneas por texto en `capas/<id>/`, comparación palabra a palabra, restaurar (con capa automática previa) y borrar.
- [x] **Marginalia**: comentarios anclados al texto (`{{c:id}}…{{/c}}` en el Markdown), columna al margen, resolver y borrar; nunca salen al exportar.
- [x] **Hoja partida**: abrir al lado otro texto, una ficha del Códice o un documento de Investigación.

## F3 · El mundo ✅ (0.4)
- [x] **Fichas del Códice**: personajes, lugares, objetos, facciones, mundo y términos; retrato, alias, campos editables, descripción en `codice/*.md`.
- [x] **Ecos**: nombres y alias subrayados en el texto, ficha al pasar el ratón, Ctrl+clic la abre al lado; «aparece en N textos» y «En este texto» en el Inspector.
- [x] **Telaraña**: grafo de relaciones con disposición automática, nodos arrastrables, filtro por tipo.
- [x] **Glosario y lenguas**: términos del Códice, pestaña Glosario y opción de añadirlo al final del libro.
- [x] **Archivo de investigación**: sección del Legajo con PDF, imágenes, textos y páginas web guardadas sin scripts para leer sin conexión.
- [x] **Mural de inspiración**: tableros con imágenes, notas y paletas; mover, cambiar tamaño, vincular a una ficha.

## F4 · Hábito ✅ (0.4)
- [x] **Metas con fecha**: meta del libro, fecha de entrega y días de descanso; palabras al día recalculadas.
- [x] **Bitácora de sesiones**: `bitacora.json` con días, sesiones, minutos activos y palabras por hora; tabla y CSV.
- [x] **Carrera de palabras**: duración y meta, modo valiente (sin borrar), descanso de 5 minutos, historial y mejor hora.
- [x] **Paleta de comandos** (Ctrl+K): acciones, textos, fichas y murales sin acentos ni mayúsculas.
- [x] **Cuaderno de ideas**: ideas fuera de los proyectos (`cuaderno.json`), atajo global Ctrl+Alt+I, enviar a Notas.
- [x] **Retos**: NaNoWriMo, 30 días, 10.000 en 30 días o propios; insignia al conseguirlo.
- [x] Termómetro: progreso, ritmo, hoy, racha, mapa de calor de seis meses y últimos 30 días.

## F5 · Imprenta ✅ (0.7)
- [x] **PDF de imprenta** con Typst integrado en la app: 7 tamaños (KDP, A5, rústica española), márgenes espejo, estilos clásico, moderno y romántico, inicial grande y versalitas, cabeceras con autor y capítulo, capítulos en página impar, páginas en blanco limpias, partes, portadilla, créditos, dedicatoria, cita, índice, agradecimientos y «sobre el autor». Vista previa dentro de la app.
- [x] Fuentes: Libertinus Serif incluida, más Times, Georgia, Garamond, Palatino, Courier… si están en el sistema, y cualquier .ttf/.otf puesto en `fuentes/` (del proyecto o de los datos de la app).
- [x] **EPUB 3** (con toc.ncx): portada, créditos, dedicatoria, un archivo por capítulo, estilos según el diseño elegido.
- [x] **Manuscrito estándar** (Shunn) en PDF y Word: contacto, recuento redondeado, cabecera «Apellido / TÍTULO / página», # entre escenas, FIN.
- [x] **Taller de portada**: calculadora de lomo (papel crema, blanco y color de KDP), vista previa con sangrado y código de barras, PDF de cubierta completa.
- [x] **Kit de envío**: frase gancho, sinopsis corta y larga, carta (con plantilla), comparables y biografía con recuento orientativo; exportar a Word. **Registro de envíos** a agencias, editoriales y concursos.

## F6 · Revisión ✅ (0.7)
- [x] **Lápiz rojo**: control de cambios en el editor (guardado como CriticMarkup `{++…++}` / `{--…--}`), anterior/siguiente, aceptar/rechazar uno o todos; al exportar se dan por aceptados. **Word para revisión** con comentarios y cambios de Word reales; **traer revisión** importa los comentarios de un .docx al texto.
- [x] **Lupa de estilo**: repeticiones cercanas, adverbios, muletillas (propias y editables), frases largas (umbral ajustable), voz pasiva; legibilidad Fernández-Huerta (español) o Flesch (inglés).
- [x] **Corrector local**: Hunspell (español e inglés) en un hilo aparte, sugerencias con clic derecho, diccionario personal; acepta solo los nombres del Códice. Se puede usar el del sistema o apagarlo.
- [x] **Pulso**: palabras por escena con el color del POV, curva de tensión (puntuable), proporción de diálogo, frase media, presencia de personajes con avisos de desapariciones y palabras por punto de vista.
- [x] **Lectura en voz alta** con las voces del sistema, resaltando la palabra que suena; voz y velocidad en Ajustes.
- [x] **Puentes**: importar de Scrivener 2 y 3 (árbol, RTF, sinopsis, notas, PDF e imágenes de investigación), Manuskript (esquema, resúmenes, personajes), Word (títulos como capítulos, comentarios y cambios) y carpetas de Markdown (Obsidian, exportaciones de Novelcrafter, Ulysses…). En un proyecto nuevo o dentro del actual.

## F7 · Tiempo y espacio ✅ (0.7)
- [x] **Rejilla de tramas**: subtramas × escenas, casillas arrastrables, aviso de subtramas abandonadas.
- [x] **Cronos**: línea de tiempo con pistas por personaje y acontecimientos, calendario real o inventado (meses y años propios), arrastrar para fechar, saltos atrás señalados y aviso de personajes en dos lugares el mismo día.
- [x] **Cartógrafo**: mapas propios con chinchetas enlazadas a lugares del Códice, rutas, zoom.
- [x] **Árbol de linajes**: generaciones, parejas y descendencia a partir de relaciones padre/madre y pareja.
- [x] **Copo de nieve**: asistente en siete pasos que crea fichas de personaje, escenas y una nota con las sinopsis.
- [x] **Modo guion** (Fountain): reconoce encabezados, personajes, acotaciones, diálogos y transiciones; Tab cambia el tipo; PDF con formato de industria y exportación .fountain.

## 0.8 · Mejoras votadas e instalador propio ✅
- [x] **Instalador propio** (`installer/`, estilo «Hoja en blanco»): lleva dentro Escribania.exe; instala por usuario en `%LOCALAPPDATA%\Programs\Escribania` sin administrador (accesos, `.escribania`, «Aplicaciones instaladas») o portable; guarda la versión anterior; se copia como `desinstalar.exe` para **desinstalar y reparar** con la misma estética; `/S` silencioso.
- [x] **Actualizador**: `latest.json` en GitHub Releases, comprobación diaria (canal estable o beta), descarga en segundo plano, **SHA-256 + firma ed25519** (`tools/firma`, clave pública en `src-tauri/firma.pub`), ventana «Fe de erratas» con *Reiniciar y actualizar / Al cerrar / Más tarde*, aviso discreto en la barra (sin ventanas durante Retiro o un sprint), vuelta atrás manual y automática si la nueva no arranca. El repositorio se configura en `src-tauri/actualizaciones.json`.
- [x] Escribir: **variantes de escena**, **escritura sin red**, **sinónimos y antónimos** (tesauros de LibreOffice), **frase de arranque**, **ambientes** tren/bosque/biblioteca/teclas, **accesibilidad** (OpenDyslexic, alto contraste, escala, menos animación, atajos configurables).
- [x] Revisar: **Repaso** con pendientes, **continuidad**, **voces** y **lectores beta** (HTML para comentar + importación a Marginalia); **Máquina del tiempo**; **copia para leer en papel**.
- [x] Organizar: **calendario editorial**, **etiquetas y colecciones**, **corcho libre**, **paneles en otra ventana**, **proyecto de ejemplo y recorrido**, **series y sagas**.
- [x] Publicar: **inicial capitular real**, **vista de pliegos**, **exportar para la web**, **estilos de imprenta propios**.
- [x] Cimientos: **sincronía por carpeta** (candado, cambios externos, copias en conflicto) y **extensiones y temas** (Worker aislado, galería incluida).
- Textos nuevos solo en español por ahora: el inglés se completará de una vez.

## F8 · Ecosistema y 1.0
- Dictado local · Linux probado de verdad · traducción al inglés de la 0.8 · publicación 1.0

## Fuera del plan
Generador de nombres · Musa (IA)
