//! Dónde guarda Escribanía sus datos (ajustes, copias de seguridad).
//!
//! - **Instalada**: la carpeta de datos del usuario (`%APPDATA%\com.escribania.desktop`
//!   en Windows, `~/.local/share/com.escribania.desktop` en Linux).
//! - **Portable**: si hay un archivo `portable` junto al ejecutable, todo va a
//!   `<carpeta del exe>/Datos`, para llevar la app en un USB sin dejar rastro.
//!
//! Los proyectos no viven aquí: cada uno es una carpeta que el usuario elige.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tauri::Manager;

pub const MARKER: &str = "portable";
pub const PORTABLE_DIR: &str = "Datos";

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok()?.parent().map(PathBuf::from)
}

/// Carpeta portable si existe el marcador junto a `dir`.
pub fn portable_root_in(dir: &Path) -> Option<PathBuf> {
    dir.join(MARKER).is_file().then(|| dir.join(PORTABLE_DIR))
}

fn portable_root() -> Option<&'static PathBuf> {
    static ROOT: OnceLock<Option<PathBuf>> = OnceLock::new();
    ROOT.get_or_init(|| exe_dir().and_then(|d| portable_root_in(&d))).as_ref()
}

pub fn is_portable() -> bool {
    portable_root().is_some()
}

/// Carpeta de datos, creada si hace falta.
pub fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = match portable_root() {
        Some(p) => p.clone(),
        None => app.path().app_data_dir().map_err(|e| e.to_string())?,
    };
    std::fs::create_dir_all(&dir).map_err(|e| format!("No se puede crear {}: {e}", dir.display()))?;
    Ok(dir)
}

pub fn backups_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let d = data_dir(app)?.join("copias");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

#[derive(Serialize)]
pub struct AppInfo {
    pub version: String,
    pub portable: bool,
    pub data_dir: String,
    pub backups_dir: String,
    /// Proyecto pasado al abrir (doble clic en un `.escribania`).
    pub startup_file: Option<String>,
    /// Opciones de arranque que pasa el instalador (`--ejemplo`, `--recorrido`).
    pub flags: Vec<String>,
}

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> Result<AppInfo, String> {
    let startup_file = std::env::args()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(&format!(".{}", crate::project::EXT)));
    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        portable: is_portable(),
        data_dir: data_dir(&app)?.display().to_string(),
        backups_dir: backups_dir(&app)?.display().to_string(),
        startup_file,
        flags: std::env::args().skip(1).filter(|a| a == "--ejemplo" || a == "--recorrido").collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn marker_turns_on_portable() {
        let t = tempfile::tempdir().unwrap();
        assert_eq!(portable_root_in(t.path()), None);
        std::fs::write(t.path().join(MARKER), "").unwrap();
        assert_eq!(portable_root_in(t.path()), Some(t.path().join(PORTABLE_DIR)));
    }
}
