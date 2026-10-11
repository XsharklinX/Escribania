//! Copias de seguridad (Salvavidas): un .zip del proyecto entero.
//!
//! Se hace al abrir, cada cierto tiempo mientras se escribe y al cerrar. Van a
//! `<datos>/copias/<carpeta del proyecto>/AAAA-MM-DD_HH-MM-SS.zip` y se conservan
//! las `keep` más recientes.

use crate::paths;
use std::io::Write;
use std::path::{Path, PathBuf};

fn add_dir(zip: &mut zip::ZipWriter<std::fs::File>, base: &Path, dir: &Path) -> Result<usize, String> {
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut n = 0;
    let mut entries: Vec<_> = std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if name.ends_with(".tmp") {
            continue;
        }
        let rel = p.strip_prefix(base).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
        if p.is_dir() {
            n += add_dir(zip, base, &p)?;
        } else if let Ok(bytes) = std::fs::read(&p) {
            zip.start_file(rel, opts).map_err(|e| e.to_string())?;
            zip.write_all(&bytes).map_err(|e| e.to_string())?;
            n += 1;
        }
    }
    Ok(n)
}

/// Comprime `root` en `dest_dir` y deja solo las `keep` copias más recientes.
pub fn backup_to(root: &Path, dest_dir: &Path, stamp: &str, keep: usize) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dest_dir).map_err(|e| e.to_string())?;
    let dest = dest_dir.join(format!("{stamp}.zip"));
    let tmp = dest_dir.join(format!("{stamp}.zip.tmp"));
    {
        let f = std::fs::File::create(&tmp).map_err(|e| format!("No se puede crear la copia: {e}"))?;
        let mut zip = zip::ZipWriter::new(f);
        // Dentro del zip, todo cuelga de la carpeta del proyecto ("Faro/texto/a.md").
        add_dir(&mut zip, root.parent().unwrap_or(root), root)?;
        zip.finish().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;

    let mut zips: Vec<PathBuf> = std::fs::read_dir(dest_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "zip"))
        .collect();
    zips.sort();
    let extra = zips.len().saturating_sub(keep.max(1));
    for old in zips.into_iter().take(extra) {
        let _ = std::fs::remove_file(old);
    }
    Ok(dest)
}

#[tauri::command]
pub async fn project_backup(app: tauri::AppHandle, root: String, keep: usize) -> Result<String, String> {
    let root = PathBuf::from(root);
    let name = root.file_name().map(|s| s.to_string_lossy().to_string()).ok_or("Proyecto sin carpeta")?;
    let dest_dir = paths::backups_dir(&app)?.join(name);
    let stamp = chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string();
    tauri::async_runtime::spawn_blocking(move || backup_to(&root, &dest_dir, &stamp, keep))
        .await
        .map_err(|e| e.to_string())?
        .map(|p| p.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zips_project_and_rotates() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("Faro");
        std::fs::create_dir_all(root.join("texto")).unwrap();
        std::fs::write(root.join("Faro.escribania"), "{}").unwrap();
        std::fs::write(root.join("texto/a.md"), "hola").unwrap();
        std::fs::write(root.join("texto/a.md.tmp"), "basura").unwrap();
        let dest = t.path().join("copias");
        for s in ["2026-01-01", "2026-01-02", "2026-01-03"] {
            backup_to(&root, &dest, s, 2).unwrap();
        }
        let mut names: Vec<_> = std::fs::read_dir(&dest).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        names.sort();
        assert_eq!(names, vec!["2026-01-02.zip", "2026-01-03.zip"]);

        let z = zip::ZipArchive::new(std::fs::File::open(dest.join("2026-01-03.zip")).unwrap()).unwrap();
        let mut files: Vec<_> = z.file_names().map(String::from).collect();
        files.sort();
        assert_eq!(files, vec!["Faro/Faro.escribania", "Faro/texto/a.md"]);
    }
}
