//! Capas: instantáneas de un texto antes de reescribirlo.
//!
//! `capas/<id del texto>/<AAAAMMDD-HHMMSS>.md`, con el nombre de la capa en la
//! cabecera YAML. Son Markdown normales: se pueden abrir sin Escribanía.

use crate::{fsx, project};
use serde::Serialize;
use std::path::{Path, PathBuf};

const DIR: &str = "capas";

fn check_id(s: &str) -> Result<(), String> {
    if !s.is_empty() && s.len() <= 40 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        Ok(())
    } else {
        Err(format!("Identificador no válido: {s}"))
    }
}

fn dir_of(root: &Path, id: &str) -> Result<PathBuf, String> {
    check_id(id)?;
    Ok(root.join(DIR).join(id))
}

#[derive(Serialize)]
pub struct Snapshot {
    pub stamp: String,
    pub name: String,
    pub words: usize,
}

fn name_of(raw: &str) -> String {
    raw.lines()
        .take_while(|l| !l.is_empty())
        .find_map(|l| l.strip_prefix("title: "))
        .and_then(|v| serde_json::from_str::<String>(v).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn snapshot_create(root: String, id: String, name: String, body: String) -> Result<Snapshot, String> {
    let dir = dir_of(Path::new(&root), &id)?;
    let mut stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    // Dos capas en el mismo segundo: se numera la segunda.
    let mut n = 1;
    while dir.join(format!("{stamp}.md")).exists() {
        n += 1;
        stamp = format!("{}-{n}", &stamp[..15]);
    }
    fsx::write_atomic(&dir.join(format!("{stamp}.md")), project::with_front_matter(&id, &name, &body).as_bytes())?;
    Ok(Snapshot { stamp, name, words: project::count_words(&body) })
}

#[tauri::command]
pub fn snapshot_list(root: String, id: String) -> Result<Vec<Snapshot>, String> {
    let dir = dir_of(Path::new(&root), &id)?;
    let Ok(rd) = std::fs::read_dir(&dir) else { return Ok(vec![]) };
    let mut out: Vec<Snapshot> = rd
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let stamp = name.strip_suffix(".md")?.to_string();
            let raw = std::fs::read_to_string(e.path()).ok()?;
            Some(Snapshot { stamp, name: name_of(&raw), words: project::count_words(project::strip_front_matter(&raw)) })
        })
        .collect();
    out.sort_by(|a, b| b.stamp.cmp(&a.stamp));
    Ok(out)
}

#[tauri::command]
pub fn snapshot_read(root: String, id: String, stamp: String) -> Result<String, String> {
    check_id(&stamp)?;
    let p = dir_of(Path::new(&root), &id)?.join(format!("{stamp}.md"));
    let raw = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    Ok(project::strip_front_matter(&raw).to_string())
}

#[tauri::command]
pub fn snapshot_delete(root: String, id: String, stamp: String) -> Result<(), String> {
    check_id(&stamp)?;
    let p = dir_of(Path::new(&root), &id)?.join(format!("{stamp}.md"));
    std::fs::remove_file(p).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_list_read_delete() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().display().to_string();
        let a = snapshot_create(root.clone(), "k3f9".into(), "Antes de \"reescribir\"".into(), "uno dos".into()).unwrap();
        let b = snapshot_create(root.clone(), "k3f9".into(), "".into(), "uno dos tres".into()).unwrap();
        assert_ne!(a.stamp, b.stamp);
        let list = snapshot_list(root.clone(), "k3f9".into()).unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].name, "Antes de \"reescribir\"");
        assert_eq!(list[0].words, 3);
        assert_eq!(snapshot_read(root.clone(), "k3f9".into(), a.stamp.clone()).unwrap(), "uno dos\n");
        snapshot_delete(root.clone(), "k3f9".into(), a.stamp).unwrap();
        assert_eq!(snapshot_list(root.clone(), "k3f9".into()).unwrap().len(), 1);
        assert!(snapshot_list(root, "../x".into()).is_err());
    }
}
