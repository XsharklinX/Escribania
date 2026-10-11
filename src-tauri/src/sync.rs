//! Sincronía por carpeta: proyectos dentro de Dropbox, OneDrive, Google Drive o
//! Syncthing. Escribanía no sincroniza nada por su cuenta; se encarga de que la
//! sincronización no destroce el trabajo:
//! - Un candado (`.escribania-abierto`) avisa si el proyecto está abierto en otro equipo.
//! - Las fechas de los archivos dicen qué ha cambiado desde fuera.
//! - Se reconocen las copias en conflicto que crean los servicios en la nube.

use crate::{fsx, project};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const LOCK: &str = ".escribania-abierto";
/// Un candado sin renovar en este tiempo se da por abandonado (el otro equipo se apagó).
const STALE_MS: u64 = 10 * 60 * 1000;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn machine() -> String {
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "este equipo".into())
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Lock {
    pub machine: String,
    pub user: String,
    pub pid: u32,
    pub since: u64,
    pub beat: u64,
}

fn mine() -> Lock {
    let user = std::env::var("USERNAME").or_else(|_| std::env::var("USER")).unwrap_or_default();
    Lock { machine: machine(), user, pid: std::process::id(), since: now_ms(), beat: now_ms() }
}

fn read_lock(root: &Path) -> Option<Lock> {
    serde_json::from_str(&std::fs::read_to_string(root.join(LOCK)).ok()?).ok()
}

/// ¿Lo tiene abierto otro equipo (u otra Escribanía en este)? Si no, el candado pasa a ser nuestro.
pub fn acquire(root: &Path) -> Result<Option<Lock>, String> {
    if let Some(l) = read_lock(root) {
        let other = l.machine != machine() || l.pid != std::process::id();
        if other && now_ms().saturating_sub(l.beat) < STALE_MS {
            return Ok(Some(l));
        }
    }
    let l = mine();
    fsx::write_atomic(&root.join(LOCK), serde_json::to_string(&l).unwrap().as_bytes())?;
    Ok(None)
}

#[tauri::command]
pub fn lock_acquire(root: String, force: bool) -> Result<Option<Lock>, String> {
    let root = Path::new(&root);
    if force {
        fsx::write_atomic(&root.join(LOCK), serde_json::to_string(&mine()).unwrap().as_bytes())?;
        return Ok(None);
    }
    acquire(root)
}

/// Renueva el candado. Devuelve el de otro equipo si nos lo ha quitado.
#[tauri::command]
pub fn lock_refresh(root: String) -> Result<Option<Lock>, String> {
    let root = Path::new(&root);
    match read_lock(root) {
        Some(l) if l.machine != machine() || l.pid != std::process::id() => Ok(Some(l)),
        Some(mut l) => {
            l.beat = now_ms();
            fsx::write_atomic(&root.join(LOCK), serde_json::to_string(&l).unwrap().as_bytes())?;
            Ok(None)
        }
        None => acquire(root),
    }
}

#[tauri::command]
pub fn lock_release(root: String) -> Result<(), String> {
    let root = Path::new(&root);
    if read_lock(root).is_some_and(|l| l.machine == machine() && l.pid == std::process::id()) {
        let _ = std::fs::remove_file(root.join(LOCK));
    }
    Ok(())
}

fn walk(root: &Path, dir: &Path, out: &mut HashMap<String, u64>) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            walk(root, &p, out);
        } else if p.extension().is_some_and(|x| x == "md" || x == project::EXT) {
            let Ok(meta) = e.metadata() else { continue };
            let ms = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
            let rel = p.strip_prefix(root).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default();
            out.insert(rel, ms);
        }
    }
}

/// Fecha de modificación (ms) de los textos, las fichas y el manifiesto.
#[tauri::command]
pub fn project_mtimes(root: String) -> HashMap<String, u64> {
    let root = Path::new(&root);
    let mut out = HashMap::new();
    for d in ["texto", "codice"] {
        walk(root, &root.join(d), &mut out);
    }
    if let Ok(rd) = std::fs::read_dir(root) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_file() && p.extension().is_some_and(|x| x == project::EXT) {
                let ms = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
                out.insert(e.file_name().to_string_lossy().to_string(), ms);
            }
        }
    }
    out
}

/// Si el nombre es una copia en conflicto de un servicio en la nube, el nombre del original.
pub fn conflict_original(name: &str) -> Option<String> {
    let (stem, ext) = name.rsplit_once('.')?;
    let lower = stem.to_lowercase();
    // Dropbox: «a (copia en conflicto de PC 2026-10-10).md», «a (conflicted copy …)»; Drive: «a (1).md».
    for marker in [" (copia en conflicto", " (conflicted copy", " (copia de conflicto", " (version en conflicto"] {
        if let Some(i) = lower.find(marker) {
            return Some(format!("{}.{ext}", &stem[..i]));
        }
    }
    // Syncthing: «a.sync-conflict-20261010-101010-ABCDEF.md».
    if let Some(i) = lower.find(".sync-conflict-") {
        return Some(format!("{}.{ext}", &stem[..i]));
    }
    // OneDrive: «a-NOMBREPC.md» (el nombre del equipo en mayúsculas al final).
    if let Some((base, pc)) = stem.rsplit_once('-') {
        if pc.len() >= 3 && pc.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) && pc.chars().any(|c| c.is_ascii_uppercase()) {
            return Some(format!("{base}.{ext}"));
        }
    }
    None
}

#[derive(Serialize)]
pub struct Conflict {
    pub file: String,
    pub original: String,
}

#[tauri::command]
pub fn project_conflicts(root: String) -> Vec<Conflict> {
    let root = Path::new(&root);
    let mut all = HashMap::new();
    walk(root, &root.join("texto"), &mut all);
    walk(root, &root.join("codice"), &mut all);
    let mut out: Vec<Conflict> = all
        .keys()
        .filter_map(|rel| {
            let (dir, name) = rel.rsplit_once('/')?;
            let original = format!("{dir}/{}", conflict_original(name)?);
            // Solo si el original existe: «capitulo-1-BIS» no es una copia de nada.
            all.contains_key(&original).then(|| Conflict { file: rel.clone(), original })
        })
        .collect();
    out.sort_by(|a, b| a.file.cmp(&b.file));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_cloud_conflict_copies() {
        assert_eq!(conflict_original("el-sobre-k3f9 (copia en conflicto de PORTATIL 2026-10-10).md").as_deref(), Some("el-sobre-k3f9.md"));
        assert_eq!(conflict_original("el-sobre-k3f9 (conflicted copy 2026-10-10).md").as_deref(), Some("el-sobre-k3f9.md"));
        assert_eq!(conflict_original("el-sobre-k3f9.sync-conflict-20261010-101010-ABC123.md").as_deref(), Some("el-sobre-k3f9.md"));
        assert_eq!(conflict_original("el-sobre-k3f9-DESKTOP7.md").as_deref(), Some("el-sobre-k3f9.md"));
        assert_eq!(conflict_original("el-sobre-k3f9.md"), None);
    }

    #[test]
    fn lock_warns_about_other_machines() {
        let t = tempfile::tempdir().unwrap();
        assert_eq!(acquire(t.path()).unwrap(), None);
        // Otro equipo lo abre después.
        let other = Lock { machine: "OTRO-PC".into(), user: "ana".into(), pid: 1, since: now_ms(), beat: now_ms() };
        std::fs::write(t.path().join(LOCK), serde_json::to_string(&other).unwrap()).unwrap();
        assert_eq!(acquire(t.path()).unwrap().unwrap().machine, "OTRO-PC");
        // Un candado viejo no cuenta.
        let old = Lock { beat: now_ms() - STALE_MS - 1000, ..other };
        std::fs::write(t.path().join(LOCK), serde_json::to_string(&old).unwrap()).unwrap();
        assert_eq!(acquire(t.path()).unwrap(), None);
    }

    #[test]
    fn lists_conflicts_with_their_originals() {
        let t = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(t.path().join("texto")).unwrap();
        for f in ["a.md", "a (conflicted copy 2026).md", "b-NOTE.md"] {
            std::fs::write(t.path().join("texto").join(f), "x").unwrap();
        }
        let c = project_conflicts(t.path().display().to_string());
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].original, "texto/a.md");
    }
}
