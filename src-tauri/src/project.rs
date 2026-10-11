//! Formato de proyecto: una carpeta normal que se puede abrir sin Escribanía.
//!
//! ```text
//! La casa del faro/
//! ├─ La casa del faro.escribania   ← JSON: árbol, metadatos, metas
//! └─ texto/
//!    └─ el-faro-apagado-k3f9.md    ← cabecera YAML + Markdown
//! ```
//!
//! La estructura del JSON la decide la interfaz. Rust solo necesita saber qué
//! archivos de texto referencia (cualquier clave `"file"` del árbol), para contar
//! palabras y detectar textos huérfanos que no están en el árbol.

use crate::fsx;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

pub const EXT: &str = "escribania";
pub const TEXT_DIR: &str = "texto";

/// Ruta de un texto dentro del proyecto. Rechaza rutas absolutas y `..`.
pub fn text_path(root: &Path, file: &str) -> Result<PathBuf, String> {
    let rel = Path::new(file);
    let safe = !file.is_empty()
        && rel.components().all(|c| matches!(c, Component::Normal(_)))
        && rel.extension().is_some_and(|e| e == "md");
    if !safe {
        return Err(format!("Ruta de texto no válida: {file}"));
    }
    Ok(root.join(rel))
}

/// Cualquier archivo dentro del proyecto (recursos, capas). Rechaza rutas absolutas y `..`.
pub fn rel_path(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if rel.is_empty() || !p.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(format!("Ruta no válida: {rel}"));
    }
    Ok(root.join(p))
}

fn root_of(manifest: &Path) -> Result<PathBuf, String> {
    manifest.parent().map(PathBuf::from).ok_or_else(|| "Ruta de proyecto no válida".to_string())
}

/// Palabras: trozos separados por espacios con al menos una letra o número.
/// La interfaz cuenta igual (src/lib/words.ts).
pub fn count_words(text: &str) -> usize {
    text.split_whitespace().filter(|w| w.chars().any(|c| c.is_alphanumeric())).count()
}

/// Quita la cabecera YAML (`---` … `---`) si la hay.
pub fn strip_front_matter(text: &str) -> &str {
    let t = text.strip_prefix('\u{feff}').unwrap_or(text);
    let Some(rest) = t.strip_prefix("---\n").or_else(|| t.strip_prefix("---\r\n")) else { return t };
    for end in ["\n---\n", "\n---\r\n"] {
        if let Some(i) = rest.find(end) {
            return &rest[i + end.len()..];
        }
    }
    // Cabecera sin texto detrás.
    if rest.ends_with("\n---") || rest.ends_with("\n---\r") {
        return "";
    }
    t
}

pub fn with_front_matter(id: &str, title: &str, body: &str) -> String {
    // Una cadena JSON es también una cadena YAML válida (comillas dobles con escapes).
    let q = |s: &str| serde_json::to_string(s).unwrap_or_else(|_| "\"\"".into());
    format!("---\nid: {}\ntitle: {}\n---\n{}", q(id), q(title), body.trim_end_matches('\n').to_string() + "\n")
}

fn collect_files(v: &serde_json::Value, out: &mut Vec<String>) {
    match v {
        serde_json::Value::Object(m) => {
            for (k, x) in m {
                if k == "file" {
                    if let Some(s) = x.as_str() {
                        out.push(s.to_string());
                    }
                } else {
                    collect_files(x, out);
                }
            }
        }
        serde_json::Value::Array(a) => a.iter().for_each(|x| collect_files(x, out)),
        _ => {}
    }
}

#[derive(Serialize)]
pub struct Opened {
    pub path: String,
    pub root: String,
    pub manifest: serde_json::Value,
    /// Palabras por archivo de texto.
    pub words: BTreeMap<String, usize>,
    /// Textos en `texto/` que el árbol no menciona (se recuperan en la interfaz).
    pub orphans: Vec<String>,
    /// Archivos que el árbol menciona pero no existen.
    pub missing: Vec<String>,
}

pub fn open(manifest_path: &Path) -> Result<Opened, String> {
    let text = std::fs::read_to_string(manifest_path)
        .map_err(|e| format!("No se puede leer {}: {e}", manifest_path.display()))?;
    let manifest: serde_json::Value =
        serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| format!("El proyecto está dañado: {e}"))?;
    let root = root_of(manifest_path)?;
    let mut files = Vec::new();
    collect_files(&manifest, &mut files);

    let mut words = BTreeMap::new();
    let mut missing = Vec::new();
    for f in &files {
        match text_path(&root, f).and_then(|p| std::fs::read_to_string(p).map_err(|e| e.to_string())) {
            Ok(t) => {
                words.insert(f.clone(), count_words(strip_front_matter(&t)));
            }
            Err(_) => missing.push(f.clone()),
        }
    }

    let mut orphans = Vec::new();
    if let Ok(rd) = std::fs::read_dir(root.join(TEXT_DIR)) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.ends_with(".md") {
                continue;
            }
            let rel = format!("{TEXT_DIR}/{name}");
            if !files.contains(&rel) {
                if let Ok(t) = std::fs::read_to_string(e.path()) {
                    words.insert(rel.clone(), count_words(strip_front_matter(&t)));
                }
                orphans.push(rel);
            }
        }
    }
    orphans.sort();

    Ok(Opened {
        path: manifest_path.display().to_string(),
        root: root.display().to_string(),
        manifest,
        words,
        orphans,
        missing,
    })
}

#[derive(serde::Deserialize)]
pub struct NewText {
    pub id: String,
    pub file: String,
    pub title: String,
    pub body: String,
}

/// Crea `<dir>/<folder>/<folder>.escribania` y sus textos iniciales.
pub fn create(dir: &Path, folder: &str, manifest: &serde_json::Value, texts: &[NewText]) -> Result<PathBuf, String> {
    let folder = sanitize_name(folder);
    if folder.is_empty() {
        return Err("El proyecto necesita un nombre.".into());
    }
    let root = dir.join(&folder);
    if root.exists() && std::fs::read_dir(&root).map(|mut r| r.next().is_some()).unwrap_or(true) {
        return Err(format!("Ya existe una carpeta con ese nombre: {}", root.display()));
    }
    std::fs::create_dir_all(root.join(TEXT_DIR)).map_err(|e| format!("No se puede crear {}: {e}", root.display()))?;
    for t in texts {
        let p = text_path(&root, &t.file)?;
        fsx::write_atomic(&p, with_front_matter(&t.id, &t.title, &t.body).as_bytes())?;
    }
    let manifest_path = root.join(format!("{folder}.{EXT}"));
    save(&manifest_path, manifest)?;
    Ok(manifest_path)
}

pub fn save(manifest_path: &Path, manifest: &serde_json::Value) -> Result<(), String> {
    let text = serde_json::to_string_pretty(manifest).map_err(|e| e.to_string())?;
    fsx::write_atomic(manifest_path, text.as_bytes())
}

/// Quita los caracteres que Windows no admite en nombres de carpeta.
pub fn sanitize_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if "<>:\"/\\|?*".contains(c) || c.is_control() { ' ' } else { c })
        .collect();
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ").trim_end_matches('.').trim().to_string()
}

// ---------------- comandos ----------------

#[tauri::command]
pub fn project_create(dir: String, name: String, manifest: serde_json::Value, texts: Vec<NewText>) -> Result<String, String> {
    create(Path::new(&dir), &name, &manifest, &texts).map(|p| p.display().to_string())
}

#[tauri::command]
pub fn project_open(path: String) -> Result<Opened, String> {
    let p = PathBuf::from(&path);
    // Se admite la carpeta del proyecto: se busca su .escribania dentro.
    let manifest = if p.is_dir() {
        std::fs::read_dir(&p)
            .map_err(|e| e.to_string())?
            .flatten()
            .map(|e| e.path())
            .find(|x| x.extension().is_some_and(|e| e == EXT))
            .ok_or("Esa carpeta no contiene un proyecto de Escribanía.")?
    } else {
        p
    };
    open(&manifest)
}

#[tauri::command]
pub fn project_save(path: String, manifest: serde_json::Value) -> Result<(), String> {
    save(Path::new(&path), &manifest)
}

#[tauri::command]
pub fn text_read(root: String, file: String) -> Result<String, String> {
    let p = text_path(Path::new(&root), &file)?;
    match std::fs::read_to_string(&p) {
        Ok(t) => Ok(strip_front_matter(&t).to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("No se puede leer {}: {e}", p.display())),
    }
}

#[tauri::command]
pub fn text_write(root: String, file: String, id: String, title: String, body: String) -> Result<usize, String> {
    let p = text_path(Path::new(&root), &file)?;
    fsx::write_atomic(&p, with_front_matter(&id, &title, &body).as_bytes())?;
    Ok(count_words(&body))
}

/// Borra para siempre (al vaciar la papelera). Las copias de seguridad lo conservan.
#[tauri::command]
pub fn text_delete(root: String, file: String) -> Result<(), String> {
    let p = text_path(Path::new(&root), &file)?;
    match std::fs::remove_file(&p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Exportaciones: la interfaz genera el contenido y aquí se escribe donde diga el usuario.
#[tauri::command]
pub fn file_write_text(path: String, text: String) -> Result<(), String> {
    fsx::write_atomic(Path::new(&path), text.as_bytes())
}

#[tauri::command]
pub fn file_write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    fsx::write_atomic(Path::new(&path), &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_paths_outside_project() {
        let r = Path::new("/p");
        assert!(text_path(r, "texto/a.md").is_ok());
        assert!(text_path(r, "../a.md").is_err());
        assert!(text_path(r, "texto/../../a.md").is_err());
        assert!(text_path(r, "/etc/a.md").is_err());
        assert!(text_path(r, "texto/a.exe").is_err());
        assert!(text_path(r, "").is_err());
    }

    #[test]
    fn counts_words_like_a_writer() {
        assert_eq!(count_words("—No puede ser —dijo en voz alta."), 7);
        assert_eq!(count_words("* * *\n\nHola,   mundo"), 2);
        assert_eq!(count_words(""), 0);
    }

    #[test]
    fn front_matter_round_trip() {
        let s = with_front_matter("k3f9", "La \"carta\"", "Texto\n\nOtro párrafo.\n\n");
        assert!(s.starts_with("---\nid: \"k3f9\"\ntitle: \"La \\\"carta\\\"\"\n---\n"));
        assert_eq!(strip_front_matter(&s), "Texto\n\nOtro párrafo.\n");
        assert_eq!(strip_front_matter("sin cabecera"), "sin cabecera");
        assert_eq!(strip_front_matter("---\r\nid: x\r\n---\r\nhola"), "hola");
    }

    #[test]
    fn create_open_and_detect_orphans() {
        let t = tempfile::tempdir().unwrap();
        let manifest = json!({"title": "Faro", "manuscript": [{"id": "a", "type": "text", "file": "texto/a.md"}, {"id": "b", "file": "texto/b.md"}]});
        let texts = vec![NewText { id: "a".into(), file: "texto/a.md".into(), title: "A".into(), body: "uno dos tres".into() }];
        let path = create(t.path(), "La casa: del faro?", &manifest, &texts).unwrap();
        assert!(path.ends_with("La casa del faro/La casa del faro.escribania"));
        std::fs::write(path.parent().unwrap().join("texto/huerfano.md"), "perdido aquí").unwrap();

        let o = open(&path).unwrap();
        assert_eq!(o.words.get("texto/a.md"), Some(&3));
        assert_eq!(o.missing, vec!["texto/b.md".to_string()]);
        assert_eq!(o.orphans, vec!["texto/huerfano.md".to_string()]);
        assert!(create(t.path(), "La casa del faro", &manifest, &[]).is_err());
    }
}
