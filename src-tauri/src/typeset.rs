//! Imprenta: composición tipográfica con Typst, dentro de la app.
//!
//! La interfaz genera el documento en lenguaje Typst (libro, manuscrito, guion
//! o portada) y aquí se compila a PDF. Fuentes disponibles:
//! - las que trae Typst (Libertinus Serif, New Computer Modern, DejaVu Sans Mono);
//! - algunas clásicas del sistema si existen (Times New Roman, Georgia,
//!   Garamond, Courier New, Palatino, Book Antiqua, Cambria, Liberation…);
//! - cualquier .ttf/.otf que el usuario ponga en `<datos>/fuentes` o en la
//!   carpeta `fuentes/` del proyecto.

use crate::{paths, project};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use typst::diag::{FileError, FileResult, Severity};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
use typst_layout::PagedDocument;

/// Nombres (en minúsculas, sin extensión) de fuentes del sistema que se cargan si están.
const SYSTEM_FONTS: &[&str] = &[
    "times", "timesbd", "timesi", "timesbi", "georgia", "georgiab", "georgiai", "georgiaz", "gara", "garabd", "garait", "cour", "courbd", "couri", "courbi",
    "pala", "palab", "palai", "palabi", "bkant", "antquab", "antquai", "antquabi", "cambria", "cambriab", "cambriai", "cambriaz", "constan", "constanb", "constani",
    "constanz", "liberationserif-regular", "liberationserif-bold", "liberationserif-italic", "liberationserif-bolditalic", "liberationmono-regular",
    "liberationmono-bold", "liberationmono-italic", "dejavuserif", "dejavuserif-bold", "dejavuserif-italic", "dejavuserif-bolditalic",
];

struct Fonts {
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
}

fn load_dir(dir: &Path, filter: Option<&[&str]>, out: &mut Vec<Font>, depth: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            if depth > 0 {
                load_dir(&p, filter, out, depth - 1);
            }
            continue;
        }
        let ext = p.extension().map(|x| x.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        if !matches!(ext.as_str(), "ttf" | "otf" | "ttc" | "otc") {
            continue;
        }
        if let Some(names) = filter {
            let stem = p.file_stem().map(|x| x.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            if !names.contains(&stem.as_str()) {
                continue;
            }
        }
        if let Ok(data) = std::fs::read(&p) {
            out.extend(Font::iter(Bytes::new(data)));
        }
    }
}

fn system_font_dirs() -> Vec<PathBuf> {
    let mut v = Vec::new();
    if cfg!(windows) {
        let win = std::env::var("WINDIR").unwrap_or_else(|_| "C:\\Windows".into());
        v.push(PathBuf::from(win).join("Fonts"));
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            v.push(PathBuf::from(local).join("Microsoft\\Windows\\Fonts"));
        }
    } else {
        v.push(PathBuf::from("/usr/share/fonts"));
        v.push(PathBuf::from("/usr/local/share/fonts"));
        if let Ok(home) = std::env::var("HOME") {
            v.push(PathBuf::from(home).join(".local/share/fonts"));
        }
    }
    v
}

fn base_fonts() -> &'static Vec<Font> {
    static BASE: OnceLock<Vec<Font>> = OnceLock::new();
    BASE.get_or_init(|| {
        let mut fonts: Vec<Font> = typst_assets::fonts().flat_map(|data| Font::iter(Bytes::new(data))).collect();
        for d in system_font_dirs() {
            load_dir(&d, Some(SYSTEM_FONTS), &mut fonts, 4);
        }
        fonts
    })
}

fn fonts_for(extra_dirs: &[PathBuf]) -> Fonts {
    let mut fonts = base_fonts().clone();
    for d in extra_dirs {
        load_dir(d, None, &mut fonts, 2);
    }
    Fonts { book: LazyHash::new(FontBook::from_fonts(&fonts)), fonts }
}

struct DocWorld {
    library: LazyHash<Library>,
    fonts: Fonts,
    main: Source,
    files: HashMap<String, Bytes>,
}

fn main_id() -> FileId {
    FileId::new(RootedPath::new(VirtualRoot::Project, VirtualPath::new("main.typ").expect("ruta válida")))
}

impl World for DocWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }
    fn book(&self) -> &LazyHash<FontBook> {
        &self.fonts.book
    }
    fn main(&self) -> FileId {
        self.main.id()
    }
    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main.id() {
            Ok(self.main.clone())
        } else {
            Err(FileError::NotSource)
        }
    }
    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if id == self.main.id() {
            return Ok(Bytes::from_string(self.main.text().to_string()));
        }
        let p = id.get().vpath().get_without_slash().to_string();
        self.files.get(&p).cloned().ok_or_else(|| FileError::NotFound(PathBuf::from(p)))
    }
    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.fonts.get(index).cloned()
    }
    fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
        use chrono::Datelike;
        let now = chrono::Local::now();
        Datetime::from_ymd(now.year(), now.month() as u8, now.day() as u8)
    }
}

pub struct Compiled {
    pub pdf: Vec<u8>,
    pub pages: usize,
    pub warnings: Vec<String>,
    pub doc: Option<PagedDocument>,
}

/// Compila un documento Typst a PDF. `files`: nombre usado en el documento → bytes.
pub fn compile_document(source: &str, files: HashMap<String, Vec<u8>>, extra_font_dirs: &[PathBuf]) -> Result<(PagedDocument, Vec<String>), String> {
    let world = DocWorld {
        library: LazyHash::new(Library::default()),
        fonts: fonts_for(extra_font_dirs),
        main: Source::new(main_id(), source.to_string()),
        files: files.into_iter().map(|(k, v)| (k, Bytes::new(v))).collect(),
    };
    let result = typst::compile::<PagedDocument>(&world);
    let warnings = result.warnings.iter().filter(|w| w.severity == Severity::Warning).map(|w| w.message.to_string()).collect();
    let doc = result.output.map_err(|errs| {
        let msgs: Vec<String> = errs.iter().map(|e| e.message.to_string()).collect();
        format!("No se pudo componer el documento: {}", msgs.join("; "))
    })?;
    Ok((doc, warnings))
}

pub fn compile(source: &str, files: HashMap<String, Vec<u8>>, extra_font_dirs: &[PathBuf]) -> Result<Compiled, String> {
    let (doc, warnings) = compile_document(source, files, extra_font_dirs)?;
    let pages = doc.pages().len();
    let pdf = typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default()).map_err(|errs| {
        let msgs: Vec<String> = errs.iter().map(|e| e.message.to_string()).collect();
        format!("No se pudo generar el PDF: {}", msgs.join("; "))
    })?;
    Ok(Compiled { pdf, pages, warnings, doc: Some(doc) })
}

/// Último PDF compuesto, para la vista previa (se pide aparte como binario).
static LAST: Mutex<Option<Vec<u8>>> = Mutex::new(None);
/// Y el documento compuesto, para pintar páginas sueltas (vista de pliegos).
static LAST_DOC: Mutex<Option<PagedDocument>> = Mutex::new(None);

/// Una página del último documento como PNG (`scale`: píxeles por punto).
#[tauri::command]
pub async fn typeset_page(index: usize, scale: f32) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let guard = LAST_DOC.lock().map_err(|e| e.to_string())?;
        let doc = guard.as_ref().ok_or("No hay vista previa")?;
        let page = doc.pages().get(index).ok_or("Esa página no existe")?;
        let opts = typst_render::RenderOptions { pixel_per_pt: typst::utils::Scalar::new(scale.clamp(0.2, 4.0) as f64), ..Default::default() };
        let png = typst_render::render(page, &opts).encode_png().map_err(|e| e.to_string())?;
        Ok(tauri::ipc::Response::new(png))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
pub struct TypesetInfo {
    pub pages: usize,
    pub warnings: Vec<String>,
    pub bytes: usize,
}

/// `files`: nombre en el documento → ruta relativa dentro del proyecto.
#[tauri::command]
pub async fn typeset(app: tauri::AppHandle, root: String, source: String, files: HashMap<String, String>, out: Option<String>) -> Result<TypesetInfo, String> {
    let root = PathBuf::from(root);
    let mut font_dirs = vec![root.join("fuentes")];
    if let Ok(d) = paths::data_dir(&app) {
        font_dirs.push(d.join("fuentes"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut bytes = HashMap::new();
        for (name, rel) in files {
            let p = project::rel_path(&root, &rel)?;
            bytes.insert(name, std::fs::read(&p).map_err(|e| format!("No se puede leer {rel}: {e}"))?);
        }
        let c = compile(&source, bytes, &font_dirs)?;
        if let Some(out) = out {
            crate::fsx::write_atomic(Path::new(&out), &c.pdf)?;
        }
        let info = TypesetInfo { pages: c.pages, warnings: c.warnings, bytes: c.pdf.len() };
        *LAST.lock().map_err(|e| e.to_string())? = Some(c.pdf);
        *LAST_DOC.lock().map_err(|e| e.to_string())? = c.doc;
        Ok(info)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn typeset_last() -> Result<tauri::ipc::Response, String> {
    let pdf = LAST.lock().map_err(|e| e.to_string())?.clone().ok_or("No hay vista previa")?;
    Ok(tauri::ipc::Response::new(pdf))
}

/// Familias de fuentes que Typst puede usar ahora mismo.
#[tauri::command]
pub async fn typeset_fonts(app: tauri::AppHandle, root: Option<String>) -> Result<Vec<String>, String> {
    let mut dirs = Vec::new();
    if let Some(r) = root {
        dirs.push(PathBuf::from(r).join("fuentes"));
    }
    if let Ok(d) = paths::data_dir(&app) {
        dirs.push(d.join("fuentes"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let f = fonts_for(&dirs);
        let mut names: Vec<String> = f.fonts.iter().map(|x| x.info().family.clone()).collect();
        names.sort();
        names.dedup();
        Ok(names)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composes_a_small_book() {
        let src = r#"
#set page(width: 6in, height: 9in, margin: (inside: 0.8in, outside: 0.6in, y: 0.8in))
#set text(font: "Libertinus Serif", size: 11pt, lang: "es", hyphenate: true)
#set par(justify: true, first-line-indent: 1.2em)
= La carta
La marea había subido antes de lo previsto, y con ella llegó el olor a gasoil y a algas.
#pagebreak()
Segunda página con _cursiva_ y *negrita*.
"#;
        let c = compile(src, HashMap::new(), &[]).unwrap();
        assert_eq!(c.pages, 2);
        assert!(c.pdf.starts_with(b"%PDF"));
    }

    /// Los documentos que genera la interfaz (src/lib/phase567.test.ts los deja en
    /// target/typst-fixtures) deben componerse sin errores. Se guardan PNG de las
    /// primeras páginas para revisarlas a ojo.
    #[test]
    fn compiles_generated_fixtures() {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("target").join("typst-fixtures");
        let Ok(rd) = std::fs::read_dir(&dir) else { return };
        let out = dir.join("png");
        std::fs::create_dir_all(&out).unwrap();
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().is_none_or(|x| x != "typ") {
                continue;
            }
            let src = std::fs::read_to_string(&p).unwrap();
            let (doc, _) = compile_document(&src, HashMap::new(), &[]).unwrap_or_else(|err| panic!("{}: {err}", p.display()));
            assert!(!doc.pages().is_empty(), "{}", p.display());
            let stem = p.file_stem().unwrap().to_string_lossy().to_string();
            for (i, page) in doc.pages().iter().take(16).enumerate() {
                let png = typst_render::render(page, &typst_render::RenderOptions::default()).encode_png().unwrap();
                std::fs::write(out.join(format!("{stem}-{:02}.png", i + 1)), png).unwrap();
            }
        }
    }

    #[test]
    fn reports_errors_in_spanish() {
        let err = compile("#nofunciona()", HashMap::new(), &[]).err().unwrap();
        assert!(err.starts_with("No se pudo componer"), "{err}");
    }

    #[test]
    fn uses_embedded_images() {
        let svg = br#"<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'><rect width='10' height='10'/></svg>"#.to_vec();
        let mut files = HashMap::new();
        files.insert("img/p.svg".to_string(), svg);
        let c = compile("#image(\"img/p.svg\", width: 2cm)", files, &[]).unwrap();
        assert_eq!(c.pages, 1);
    }
}
