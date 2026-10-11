//! Máquina del tiempo: todas las versiones guardadas de un texto, juntando sus
//! capas (`capas/<id>/`) y las copias de seguridad del proyecto (zip en la
//! carpeta de datos). Las versiones iguales seguidas se cuentan una sola vez.

use crate::{paths, project};
use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Serialize, Clone)]
pub struct Version {
    /// "snapshot" (capa) o "backup" (copia de seguridad).
    pub source: String,
    /// Sello de la capa o nombre del zip.
    pub key: String,
    /// "AAAA-MM-DD HH:MM:SS", para ordenar y mostrar.
    pub when: String,
    /// Nombre de la capa (vacío en las copias).
    pub label: String,
    pub words: usize,
}

fn check_name(s: &str) -> Result<(), String> {
    if !s.is_empty() && s.len() <= 60 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) && !s.contains("..") {
        Ok(())
    } else {
        Err(format!("Nombre no válido: {s}"))
    }
}

/// "20261010-153000" → "2026-10-10 15:30:00".
fn when_of_snapshot(stamp: &str) -> String {
    let d: String = stamp.chars().filter(|c| c.is_ascii_digit()).take(14).collect();
    if d.len() < 14 {
        return stamp.into();
    }
    format!("{}-{}-{} {}:{}:{}", &d[0..4], &d[4..6], &d[6..8], &d[8..10], &d[10..12], &d[12..14])
}

/// "2026-10-10_15-30-00.zip" → "2026-10-10 15:30:00".
fn when_of_backup(name: &str) -> String {
    let stem = name.trim_end_matches(".zip");
    match stem.split_once('_') {
        Some((d, t)) => format!("{d} {}", t.replace('-', ":")),
        None => stem.into(),
    }
}

fn backups_of(app: &tauri::AppHandle, root: &Path) -> Result<PathBuf, String> {
    let name = root.file_name().map(|s| s.to_string_lossy().to_string()).ok_or("Proyecto sin carpeta")?;
    Ok(paths::backups_dir(app)?.join(name))
}

/// El texto `file` dentro de una copia (todo cuelga de la carpeta del proyecto).
pub fn read_from_zip(zip_path: &Path, folder: &str, file: &str) -> Option<String> {
    let f = std::fs::File::open(zip_path).ok()?;
    let mut zip = zip::ZipArchive::new(f).ok()?;
    let wanted = format!("{folder}/{file}");
    let mut entry = zip.by_name(&wanted).ok()?;
    let mut raw = String::new();
    entry.read_to_string(&mut raw).ok()?;
    Some(project::strip_front_matter(&raw).to_string())
}

pub fn collect(root: &Path, backups: &Path, id: &str, file: &str) -> Vec<(Version, String)> {
    let mut out: Vec<(Version, String)> = Vec::new();
    if let Ok(list) = crate::snapshots::snapshot_list(root.display().to_string(), id.to_string()) {
        for s in list {
            if let Ok(body) = crate::snapshots::snapshot_read(root.display().to_string(), id.to_string(), s.stamp.clone()) {
                out.push((Version { source: "snapshot".into(), when: when_of_snapshot(&s.stamp), key: s.stamp, label: s.name, words: s.words }, body));
            }
        }
    }
    let folder = root.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    if let Ok(rd) = std::fs::read_dir(backups) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if !name.ends_with(".zip") {
                continue;
            }
            if let Some(body) = read_from_zip(&e.path(), &folder, file) {
                out.push((Version { source: "backup".into(), when: when_of_backup(&name), key: name, label: String::new(), words: project::count_words(&body) }, body));
            }
        }
    }
    out.sort_by(|a, b| a.0.when.cmp(&b.0.when));
    // Copias seguidas con el mismo texto: solo la primera (las capas siempre se quedan).
    let mut kept: Vec<(Version, String)> = Vec::new();
    for v in out {
        let same = kept.last().is_some_and(|(pv, pb)| *pb == v.1 && (v.0.source == "backup" || pv.source == v.0.source));
        if !same {
            kept.push(v);
        }
    }
    kept
}

#[tauri::command]
pub async fn text_history(app: tauri::AppHandle, root: String, id: String, file: String) -> Result<Vec<Version>, String> {
    project::text_path(Path::new(&root), &file)?;
    let backups = backups_of(&app, Path::new(&root))?;
    tauri::async_runtime::spawn_blocking(move || collect(Path::new(&root), &backups, &id, &file).into_iter().map(|(v, _)| v).collect())
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn text_history_read(app: tauri::AppHandle, root: String, id: String, file: String, source: String, key: String) -> Result<String, String> {
    project::text_path(Path::new(&root), &file)?;
    check_name(&key)?;
    if source == "snapshot" {
        return crate::snapshots::snapshot_read(root, id, key);
    }
    let backups = backups_of(&app, Path::new(&root))?;
    let folder = Path::new(&root).file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || read_from_zip(&backups.join(&key), &folder, &file).ok_or_else(|| "Esa copia no tiene este texto.".to_string()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_layers_and_backups_without_repeats() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("Faro");
        std::fs::create_dir_all(root.join("texto")).unwrap();
        let file = "texto/a.md";
        let write = |body: &str| std::fs::write(root.join(file), project::with_front_matter("x1", "A", body)).unwrap();
        let backups = t.path().join("copias");
        write("uno");
        crate::backup::backup_to(&root, &backups, "2026-10-01_10-00-00", 10).unwrap();
        crate::backup::backup_to(&root, &backups, "2026-10-02_10-00-00", 10).unwrap(); // igual: no cuenta
        write("uno dos");
        crate::backup::backup_to(&root, &backups, "2026-10-03_10-00-00", 10).unwrap();
        crate::snapshots::snapshot_create(root.display().to_string(), "x1".into(), "Antes de reescribir".into(), "capa".into()).unwrap();
        let list = collect(&root, &backups, "x1", file);
        let kinds: Vec<_> = list.iter().map(|(v, b)| (v.source.as_str(), b.trim())).collect();
        assert_eq!(kinds, vec![("backup", "uno"), ("backup", "uno dos"), ("snapshot", "capa")]);
        assert_eq!(list[0].0.when, "2026-10-01 10:00:00");
        assert_eq!(read_from_zip(&backups.join("2026-10-03_10-00-00.zip"), "Faro", file).unwrap().trim(), "uno dos");
        assert_eq!(when_of_snapshot("20261010-153000"), "2026-10-10 15:30:00");
    }
}
