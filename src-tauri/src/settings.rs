//! Ajustes de la app (`ajustes.json` en la carpeta de datos).
//!
//! El contenido lo define la interfaz; aquí solo se guarda y se lee tal cual,
//! para que añadir un ajuste nuevo no obligue a tocar Rust.

use crate::{fsx, paths};

const FILE: &str = "ajustes.json";

#[tauri::command]
pub fn settings_load(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let p = paths::data_dir(&app)?.join(FILE);
    match std::fs::read_to_string(&p) {
        Ok(t) => Ok(serde_json::from_str(&t).unwrap_or(serde_json::Value::Null)),
        Err(_) => Ok(serde_json::Value::Null),
    }
}

#[tauri::command]
pub fn settings_save(app: tauri::AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let p = paths::data_dir(&app)?.join(FILE);
    let text = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fsx::write_atomic(&p, text.as_bytes())
}
