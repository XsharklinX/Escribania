//! Recursos del proyecto (retratos, imágenes del Mural, PDF y páginas web del
//! Archivo) y archivos de datos (bitácora, cuaderno).

use crate::{fsx, paths, project};
use base64::Engine;
use serde::Serialize;
use std::path::Path;

/// Carpetas del proyecto donde se pueden copiar archivos.
const ASSET_DIRS: [&str; 2] = ["recursos", "investigacion"];
const MAX_READ: u64 = 80 * 1024 * 1024;

fn mime_of(path: &str) -> &'static str {
    match path.rsplit('.').next().map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("bmp") => "image/bmp",
        Some("pdf") => "application/pdf",
        Some("html" | "htm") => "text/html",
        Some("txt" | "md") => "text/plain",
        _ => "application/octet-stream",
    }
}

fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        let c = match c {
            'á' | 'à' | 'ä' | 'Á' => 'a',
            'é' | 'è' | 'ë' | 'É' => 'e',
            'í' | 'ì' | 'ï' | 'Í' => 'i',
            'ó' | 'ò' | 'ö' | 'Ó' => 'o',
            'ú' | 'ù' | 'ü' | 'Ú' => 'u',
            'ñ' | 'Ñ' => 'n',
            c => c,
        };
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    let s: String = out.trim_matches('-').chars().take(40).collect();
    if s.is_empty() { "archivo".into() } else { s }
}

fn unique_name(root: &Path, dir: &str, stem: &str, ext: &str) -> String {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    let mut n = nanos % 46656;
    loop {
        let rel = format!("{dir}/{}-{}.{ext}", slug(stem), radix36(n));
        if !root.join(&rel).exists() {
            return rel;
        }
        n += 1;
    }
}

fn radix36(mut n: u32) -> String {
    let digits = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut s = Vec::new();
    loop {
        s.push(digits[(n % 36) as usize]);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    while s.len() < 3 {
        s.push(b'0');
    }
    s.reverse();
    String::from_utf8(s).unwrap_or_default()
}

#[derive(Serialize)]
pub struct Imported {
    pub rel: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
}

/// Copia un archivo del usuario dentro del proyecto (`recursos/` o `investigacion/`).
#[tauri::command]
pub fn asset_import(root: String, src: String, dir: String) -> Result<Imported, String> {
    if !ASSET_DIRS.contains(&dir.as_str()) {
        return Err(format!("Carpeta no permitida: {dir}"));
    }
    let root = Path::new(&root);
    let src = Path::new(&src);
    let name = src.file_name().map(|s| s.to_string_lossy().to_string()).ok_or("Archivo no válido")?;
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = src.extension().map(|s| s.to_string_lossy().to_ascii_lowercase()).unwrap_or_else(|| "bin".into());
    let rel = unique_name(root, &dir, &stem, &ext);
    let dest = root.join(&rel);
    std::fs::create_dir_all(dest.parent().unwrap()).map_err(|e| e.to_string())?;
    let size = std::fs::copy(src, &dest).map_err(|e| format!("No se pudo copiar {name}: {e}"))?;
    Ok(Imported { mime: mime_of(&rel).into(), rel, name, size })
}

/// Lee un recurso como `data:` URL para mostrarlo en la interfaz.
#[tauri::command]
pub fn asset_read(root: String, rel: String) -> Result<String, String> {
    let p = project::rel_path(Path::new(&root), &rel)?;
    let len = std::fs::metadata(&p).map_err(|e| format!("No se encuentra {rel}: {e}"))?.len();
    if len > MAX_READ {
        return Err("El archivo es demasiado grande para mostrarlo.".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    Ok(format!("data:{};base64,{}", mime_of(&rel), base64::engine::general_purpose::STANDARD.encode(bytes)))
}

#[tauri::command]
pub fn asset_read_text(root: String, rel: String) -> Result<String, String> {
    let p = project::rel_path(Path::new(&root), &rel)?;
    std::fs::read_to_string(&p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn asset_write_text(root: String, dir: String, stem: String, ext: String, text: String) -> Result<String, String> {
    if !ASSET_DIRS.contains(&dir.as_str()) || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Destino no permitido".into());
    }
    let root = Path::new(&root);
    let rel = unique_name(root, &dir, &stem, &ext);
    fsx::write_atomic(&root.join(&rel), text.as_bytes())?;
    Ok(rel)
}

#[tauri::command]
pub fn asset_delete(root: String, rel: String) -> Result<(), String> {
    let p = project::rel_path(Path::new(&root), &rel)?;
    match std::fs::remove_file(p) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

#[derive(Serialize)]
pub struct WebPage {
    pub title: String,
    pub html: String,
    pub url: String,
}

/// Quita los `<script>` de una página guardada: se muestra sin ejecutar nada.
pub fn strip_scripts(html: &str) -> String {
    let re = regex::RegexBuilder::new(r"<script\b.*?</script\s*>|<script\b[^>]*/>").case_insensitive(true).dot_matches_new_line(true).build().unwrap();
    re.replace_all(html, "").into_owned()
}

pub fn title_of(html: &str) -> String {
    let re = regex::RegexBuilder::new(r"<title[^>]*>(.*?)</title>").case_insensitive(true).dot_matches_new_line(true).build().unwrap();
    re.captures(html).map(|c| c[1].split_whitespace().collect::<Vec<_>>().join(" ")).unwrap_or_default()
}

/// Descarga una página web para leerla sin conexión dentro del Archivo.
#[tauri::command]
pub async fn web_fetch(url: String) -> Result<WebPage, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("La dirección debe empezar por http:// o https://".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(std::time::Duration::from_secs(25))).build().into();
        let mut res = agent.get(&url).header("User-Agent", "Mozilla/5.0 (Escribania)").call().map_err(|e| format!("No se pudo descargar: {e}"))?;
        let html = res.body_mut().with_config().limit(20 * 1024 * 1024).read_to_string().map_err(|e| format!("No se pudo leer la página: {e}"))?;
        let title = title_of(&html);
        Ok(WebPage { title, html: strip_scripts(&html), url })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn check_json_name(name: &str) -> Result<(), String> {
    let ok = name.ends_with(".json") && name.len() < 60 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if ok && !name.contains("..") { Ok(()) } else { Err(format!("Nombre no válido: {name}")) }
}

fn read_json(p: &Path) -> serde_json::Value {
    std::fs::read_to_string(p).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(serde_json::Value::Null)
}

/// Datos del proyecto que no son el árbol (bitácora de sesiones, retos).
#[tauri::command]
pub fn project_json_read(root: String, name: String) -> Result<serde_json::Value, String> {
    check_json_name(&name)?;
    Ok(read_json(&Path::new(&root).join(name)))
}

#[tauri::command]
pub fn project_json_write(root: String, name: String, value: serde_json::Value) -> Result<(), String> {
    check_json_name(&name)?;
    fsx::write_atomic(&Path::new(&root).join(name), serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?.as_bytes())
}

/// Datos de la app, fuera de los proyectos (Cuaderno de ideas).
#[tauri::command]
pub fn app_json_read(app: tauri::AppHandle, name: String) -> Result<serde_json::Value, String> {
    check_json_name(&name)?;
    Ok(read_json(&paths::data_dir(&app)?.join(name)))
}

#[tauri::command]
pub fn app_json_write(app: tauri::AppHandle, name: String, value: serde_json::Value) -> Result<(), String> {
    check_json_name(&name)?;
    fsx::write_atomic(&paths::data_dir(&app)?.join(name), serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_read_delete() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("Foto del Faro.PNG");
        std::fs::write(&src, [137u8, 80, 78, 71]).unwrap();
        let root = t.path().join("proj");
        std::fs::create_dir_all(&root).unwrap();
        let r = root.display().to_string();
        let a = asset_import(r.clone(), src.display().to_string(), "recursos".into()).unwrap();
        assert!(a.rel.starts_with("recursos/foto-del-faro-") && a.rel.ends_with(".png"), "{}", a.rel);
        assert_eq!(asset_read(r.clone(), a.rel.clone()).unwrap(), "data:image/png;base64,iVBORw==");
        assert!(asset_import(r.clone(), src.display().to_string(), "../fuera".into()).is_err());
        asset_delete(r.clone(), a.rel.clone()).unwrap();
        assert!(asset_read(r, a.rel).is_err());
    }

    #[test]
    fn cleans_pages_and_checks_names() {
        let html = "<html><head><title>  El  faro </title><script>alert(1)</script></head><body><SCRIPT src=x></SCRIPT>Hola</body></html>";
        assert_eq!(title_of(html), "El faro");
        assert_eq!(strip_scripts(html), "<html><head><title>  El  faro </title></head><body>Hola</body></html>");
        assert!(check_json_name("bitacora.json").is_ok());
        assert!(check_json_name("../x.json").is_err());
        assert!(check_json_name("a/b.json").is_err());
    }
}
