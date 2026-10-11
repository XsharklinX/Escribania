//! Series y sagas: varios libros comparten fichas del Códice (y sus relaciones)
//! a través de un archivo `<Saga>.saga.json`, normalmente en la carpeta que
//! contiene los libros. Cada libro guarda la ruta relativa a ese archivo y una
//! copia de las fichas compartidas, que se sincroniza al abrir y al guardar.

use crate::fsx;
use std::path::{Component, Path, PathBuf};

const SUFFIX: &str = ".saga.json";

fn check(p: &Path) -> Result<(), String> {
    let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
    if name.to_lowercase().ends_with(SUFFIX) {
        Ok(())
    } else {
        Err(format!("No es un archivo de saga: {}", p.display()))
    }
}

/// Ruta de `to` relativa a la carpeta `from` (con «..» si hace falta).
pub fn relative(from: &Path, to: &Path) -> Option<String> {
    let a: Vec<Component> = from.components().collect();
    let b: Vec<Component> = to.components().collect();
    if a.first() != b.first() {
        return None; // otra unidad
    }
    let common = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let mut parts: Vec<String> = std::iter::repeat_n("..".to_string(), a.len() - common).collect();
    parts.extend(b[common..].iter().map(|c| c.as_os_str().to_string_lossy().to_string()));
    Some(parts.join("/"))
}

fn resolve(root: &str, rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(root).join(rel);
    check(&p)?;
    Ok(p)
}

#[tauri::command]
pub fn saga_read(root: String, rel: String) -> Result<serde_json::Value, String> {
    let p = resolve(&root, &rel)?;
    let text = std::fs::read_to_string(&p).map_err(|e| format!("No se encuentra la saga ({}): {e}", p.display()))?;
    serde_json::from_str(&text).map_err(|e| format!("La saga está dañada: {e}"))
}

#[tauri::command]
pub fn saga_write(root: String, rel: String, saga: serde_json::Value) -> Result<(), String> {
    let p = resolve(&root, &rel)?;
    fsx::write_atomic(&p, serde_json::to_string_pretty(&saga).map_err(|e| e.to_string())?.as_bytes())
}

/// Ruta relativa desde el proyecto hasta un archivo de saga elegido por el usuario.
#[tauri::command]
pub fn saga_relative(root: String, path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    check(&p)?;
    relative(Path::new(&root), &p).ok_or_else(|| "La saga tiene que estar en la misma unidad que el libro.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths() {
        let root = Path::new("/libros/Saga/Libro uno");
        assert_eq!(relative(root, Path::new("/libros/Saga/Mar.saga.json")).unwrap(), "../Mar.saga.json");
        assert_eq!(relative(root, Path::new("/libros/Saga/Libro uno/x.saga.json")).unwrap(), "x.saga.json");
        assert_eq!(relative(root, Path::new("/otros/S.saga.json")).unwrap(), "../../../otros/S.saga.json");
    }

    #[test]
    fn reads_and_writes_next_to_the_books() {
        let t = tempfile::tempdir().unwrap();
        let book = t.path().join("Libro");
        std::fs::create_dir_all(&book).unwrap();
        let root = book.display().to_string();
        saga_write(root.clone(), "../Mar.saga.json".into(), serde_json::json!({"name": "Mar"})).unwrap();
        assert!(t.path().join("Mar.saga.json").is_file());
        assert_eq!(saga_read(root.clone(), "../Mar.saga.json".into()).unwrap()["name"], "Mar");
        assert!(saga_read(root, "../otra.json".into()).is_err());
    }
}
