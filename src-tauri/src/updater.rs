//! Actualizaciones desde GitHub Releases, sin servidor propio.
//!
//! 1. Una vez al día la interfaz pide `latest.json` de la última versión publicada
//!    (en el canal beta, la más reciente aunque sea preliminar).
//! 2. Si hay una más nueva, el ejecutable se descarga en segundo plano a la
//!    carpeta de datos y se comprueban su SHA-256 y su firma ed25519 con la clave
//!    pública que lleva esta build (`firma.pub`). Si algo no coincide, se borra.
//! 3. Al aceptar, el ejecutable en uso se renombra a `Escribania.old.exe` (Windows
//!    deja renombrar un programa abierto) y el nuevo ocupa su sitio. Así funciona
//!    igual instalada que portable, y sin pedir administrador.
//! 4. La versión nueva arranca con un marcador; si no llega a confirmarlo (se
//!    cierra o falla antes de mostrar la interfaz) el siguiente arranque vuelve
//!    solo a la anterior. Desde Ajustes también se puede volver a mano.

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::Emitter;

const PUBLIC_KEY: &str = include_str!("../firma.pub");
const CONFIG: &str = include_str!("../actualizaciones.json");
const VERSION: &str = env!("CARGO_PKG_VERSION");
const PENDING: &str = "arranque-pendiente";
const PREVIOUS: &str = "version-anterior.txt";
#[cfg(windows)]
const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Escribania";

#[cfg(all(windows, target_arch = "x86_64"))]
const PLATFORM: &str = "windows-x86_64";
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
const PLATFORM: &str = "linux-x86_64";
#[cfg(not(any(all(windows, target_arch = "x86_64"), all(target_os = "linux", target_arch = "x86_64"))))]
const PLATFORM: &str = "otra";

fn repo() -> String {
    serde_json::from_str::<serde_json::Value>(CONFIG).ok().and_then(|v| v["repo"].as_str().map(str::to_string)).unwrap_or_default()
}

/// Versión como (números, preliminar). «0.8.0-beta.2» < «0.8.0».
fn parse_version(v: &str) -> (Vec<u64>, Option<Vec<u64>>) {
    let v = v.trim().trim_start_matches('v');
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (v, None),
    };
    let nums = |s: &str| s.split('.').map(|p| p.chars().filter(|c| c.is_ascii_digit()).collect::<String>().parse().unwrap_or(0)).collect::<Vec<u64>>();
    let mut c = nums(core);
    c.resize(3, 0);
    (c, pre.map(nums))
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    let (a, ap) = parse_version(candidate);
    let (b, bp) = parse_version(current);
    if a != b {
        return a > b;
    }
    match (ap, bp) {
        (None, Some(_)) => true,
        (Some(x), Some(y)) => x > y,
        _ => false,
    }
}

/// El ejecutable que se reemplaza: el AppImage en Linux, el .exe en Windows.
fn target_exe() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("APPIMAGE") {
        return Some(PathBuf::from(p));
    }
    std::env::current_exe().ok()
}

fn old_exe(exe: &Path) -> PathBuf {
    let stem = exe.file_stem().and_then(|s| s.to_str()).unwrap_or("Escribania");
    match exe.extension().and_then(|e| e.to_str()) {
        Some(ext) => exe.with_file_name(format!("{stem}.old.{ext}")),
        None => exe.with_file_name(format!("{stem}.old")),
    }
}

fn writable(dir: &Path) -> bool {
    let probe = dir.join(".escribania-prueba");
    let ok = std::fs::write(&probe, b"").is_ok();
    let _ = std::fs::remove_file(&probe);
    ok
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    version: String,
    /// Hay repositorio y clave: se pueden buscar versiones.
    configured: bool,
    /// Se puede reemplazar el ejecutable (si no, solo se avisa con enlace).
    can_apply: bool,
    /// Versión a la que se puede volver, si se guardó la anterior.
    previous: Option<String>,
    releases_url: String,
}

#[tauri::command]
pub fn update_status() -> UpdateStatus {
    let exe = target_exe();
    let dir = exe.as_ref().and_then(|e| e.parent().map(PathBuf::from));
    let previous = exe.as_ref().filter(|e| old_exe(e).is_file()).and_then(|e| {
        let v = std::fs::read_to_string(e.with_file_name(PREVIOUS)).unwrap_or_default();
        Some(if v.trim().is_empty() { "?".to_string() } else { v.trim().to_string() })
    });
    let repo = repo();
    UpdateStatus {
        version: VERSION.into(),
        configured: !repo.is_empty() && !PUBLIC_KEY.trim().is_empty() && PLATFORM != "otra",
        can_apply: dir.as_deref().is_some_and(writable) && (cfg!(windows) || std::env::var("APPIMAGE").is_ok()),
        previous,
        releases_url: if repo.is_empty() { String::new() } else { format!("https://github.com/{repo}/releases") },
    }
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Notes {
    #[serde(default)]
    nuevo: Vec<String>,
    #[serde(default)]
    mejorado: Vec<String>,
    #[serde(default)]
    corregido: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Asset {
    url: String,
    #[serde(default)]
    size: u64,
    sha256: String,
    signature: String,
}

#[derive(Deserialize)]
struct Latest {
    version: String,
    #[serde(default)]
    date: String,
    #[serde(default)]
    notes: HashMap<String, Notes>,
    #[serde(default)]
    platforms: HashMap<String, Asset>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Release {
    version: String,
    date: String,
    notes: HashMap<String, Notes>,
    asset: Option<Asset>,
}

fn agent(secs: u64) -> ureq::Agent {
    ureq::Agent::config_builder().timeout_global(Some(std::time::Duration::from_secs(secs))).build().into()
}

fn get_text(url: &str) -> Result<String, String> {
    let mut res = agent(30)
        .get(url)
        .header("User-Agent", "Escribania-Actualizador")
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| format!("Sin conexión con GitHub: {e}"))?;
    res.body_mut().with_config().limit(4 * 1024 * 1024).read_to_string().map_err(|e| e.to_string())
}

/// URL de `latest.json` de la versión que toca según el canal.
fn latest_url(repo: &str, beta: bool) -> Result<String, String> {
    if !beta {
        return Ok(format!("https://github.com/{repo}/releases/latest/download/latest.json"));
    }
    let list: serde_json::Value = serde_json::from_str(&get_text(&format!("https://api.github.com/repos/{repo}/releases?per_page=15"))?).map_err(|e| e.to_string())?;
    list.as_array()
        .into_iter()
        .flatten()
        .filter(|r| !r["draft"].as_bool().unwrap_or(false))
        .find_map(|r| r["assets"].as_array()?.iter().find(|a| a["name"] == "latest.json")?["browser_download_url"].as_str().map(str::to_string))
        .ok_or_else(|| "No hay versiones publicadas.".into())
}

#[tauri::command]
pub async fn update_check(channel: String) -> Result<Option<Release>, String> {
    let repo = repo();
    if repo.is_empty() {
        return Err("Las actualizaciones no están configuradas en esta build.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let url = latest_url(&repo, channel == "beta")?;
        let latest: Latest = serde_json::from_str(&get_text(&url)?).map_err(|e| format!("latest.json no es válido: {e}"))?;
        if !is_newer(&latest.version, VERSION) {
            return Ok(None);
        }
        Ok(Some(Release { asset: latest.platforms.get(PLATFORM).cloned(), version: latest.version, date: latest.date, notes: latest.notes }))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Comprueba huella y firma. La firma es sobre el archivo completo.
pub fn verify(data: &[u8], sha256: &str, signature: &str, public_key: &str) -> Result<(), String> {
    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    use sha2::Digest;
    if !hex(&sha2::Sha256::digest(data)).eq_ignore_ascii_case(sha256.trim()) {
        return Err("La descarga está incompleta o dañada (la huella no coincide).".into());
    }
    let key: [u8; 32] = STANDARD.decode(public_key.trim()).ok().and_then(|b| b.try_into().ok()).ok_or("Esta build no tiene clave de firma.")?;
    let key = VerifyingKey::from_bytes(&key).map_err(|e| e.to_string())?;
    let sig = STANDARD.decode(signature.trim()).map_err(|_| "Firma ilegible.".to_string())?;
    let sig = Signature::from_slice(&sig).map_err(|_| "Firma ilegible.".to_string())?;
    key.verify(data, &sig).map_err(|_| "La firma no es de Escribanía: no se instala.".to_string())
}

#[derive(Serialize, Clone)]
struct Progress {
    done: u64,
    total: u64,
}

#[tauri::command]
pub async fn update_download(app: tauri::AppHandle, release: Release) -> Result<String, String> {
    let asset = release.asset.clone().ok_or("Esta versión no trae descarga para tu sistema.")?;
    if !asset.url.starts_with("https://") {
        return Err("La descarga no es segura (no usa https).".into());
    }
    let dir = crate::paths::data_dir(&app)?.join("actualizacion");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ext = if cfg!(windows) { "exe" } else { "AppImage" };
    let dest = dir.join(format!("Escribania-{}.{ext}", release.version));
    tauri::async_runtime::spawn_blocking(move || {
        // Ya descargada y válida (otro día, o «Más tarde»): no se repite.
        if let Ok(data) = std::fs::read(&dest) {
            if verify(&data, &asset.sha256, &asset.signature, PUBLIC_KEY).is_ok() {
                return Ok(dest.display().to_string());
            }
        }
        let mut res = agent(1800).get(&asset.url).header("User-Agent", "Escribania-Actualizador").call().map_err(|e| format!("No se pudo descargar: {e}"))?;
        let total = res.headers().get("content-length").and_then(|v| v.to_str().ok()?.parse().ok()).unwrap_or(asset.size);
        let mut reader = res.body_mut().with_config().limit(400 * 1024 * 1024).reader();
        let mut data = Vec::with_capacity(total as usize);
        let mut buf = vec![0u8; 64 * 1024];
        let mut last = 0u64;
        loop {
            let n = reader.read(&mut buf).map_err(|e| format!("Descarga interrumpida: {e}"))?;
            if n == 0 {
                break;
            }
            data.extend_from_slice(&buf[..n]);
            let done = data.len() as u64;
            if done - last > 256 * 1024 {
                last = done;
                let _ = app.emit("update-progress", Progress { done, total });
            }
        }
        let _ = app.emit("update-progress", Progress { done: data.len() as u64, total });
        verify(&data, &asset.sha256, &asset.signature, PUBLIC_KEY)?;
        let part = dest.with_extension("part");
        let mut f = std::fs::File::create(&part).map_err(|e| e.to_string())?;
        f.write_all(&data).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
        drop(f);
        std::fs::rename(&part, &dest).map_err(|e| e.to_string())?;
        // Las descargas de versiones anteriores ya no sirven.
        for e in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
            if e.path() != dest {
                let _ = std::fs::remove_file(e.path());
            }
        }
        Ok(dest.display().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn set_registered_version(dir: &Path, version: &str) {
    use winreg::enums::*;
    let Ok(key) = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(UNINSTALL_KEY, KEY_READ | KEY_WRITE) else { return };
    let loc: String = key.get_value("InstallLocation").unwrap_or_default();
    if Path::new(loc.trim_end_matches('\\')) == dir {
        let _ = key.set_value("DisplayVersion", &version.to_string());
    }
}

#[cfg(not(windows))]
fn set_registered_version(_: &Path, _: &str) {}

/// Pone `new` en el sitio de `exe` y guarda el actual como `.old`.
fn swap_in(exe: &Path, new: &Path) -> Result<(), String> {
    let old = old_exe(exe);
    let _ = std::fs::remove_file(&old);
    std::fs::rename(exe, &old).map_err(|e| format!("No se pudo apartar la versión actual: {e}"))?;
    if let Err(e) = std::fs::copy(new, exe) {
        let _ = std::fs::rename(&old, exe);
        return Err(format!("No se pudo colocar la versión nueva: {e}"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(exe, std::fs::Permissions::from_mode(0o755));
    }
    Ok(())
}

fn relaunch(app: &tauri::AppHandle, exe: &Path) -> Result<(), String> {
    std::process::Command::new(exe).spawn().map_err(|e| format!("No se pudo abrir la versión nueva: {e}"))?;
    app.exit(0);
    Ok(())
}

/// Instala la versión descargada. Con `relaunch` cierra y abre la nueva; si no,
/// la nueva queda en su sitio y se usará la próxima vez que se abra Escribanía.
#[tauri::command]
pub fn update_apply(app: tauri::AppHandle, path: String, version: String, relaunch_now: bool) -> Result<(), String> {
    let exe = target_exe().ok_or("No se sabe dónde está Escribanía.")?;
    let dir = exe.parent().ok_or("Carpeta desconocida")?.to_path_buf();
    let new = PathBuf::from(&path);
    // Solo se instala lo que acaba de comprobar update_download, en la carpeta de datos.
    if !new.is_file() || new.parent().and_then(|p| p.file_name()) != Some(std::ffi::OsStr::new("actualizacion")) {
        return Err("No hay ninguna actualización descargada.".into());
    }
    swap_in(&exe, &new)?;
    let _ = std::fs::write(dir.join(PREVIOUS), VERSION);
    let _ = std::fs::write(dir.join(PENDING), "0");
    let _ = std::fs::remove_file(&new);
    set_registered_version(&dir, &version);
    if relaunch_now {
        relaunch(&app, &exe)?;
    }
    Ok(())
}

/// Intercambia la versión actual con la guardada. Devuelve la versión restaurada.
fn swap_back(exe: &Path) -> Result<String, String> {
    let old = old_exe(exe);
    if !old.is_file() {
        return Err("No hay versión anterior guardada.".into());
    }
    let dir = exe.parent().unwrap_or(Path::new("."));
    let previous = std::fs::read_to_string(dir.join(PREVIOUS)).unwrap_or_default().trim().to_string();
    let tmp = exe.with_extension("swap");
    let _ = std::fs::remove_file(&tmp);
    std::fs::rename(exe, &tmp).map_err(|e| e.to_string())?;
    if let Err(e) = std::fs::rename(&old, exe) {
        let _ = std::fs::rename(&tmp, exe);
        return Err(e.to_string());
    }
    let _ = std::fs::rename(&tmp, &old);
    let _ = std::fs::write(dir.join(PREVIOUS), VERSION);
    let _ = std::fs::remove_file(dir.join(PENDING));
    set_registered_version(dir, &previous);
    Ok(previous)
}

#[tauri::command]
pub fn update_rollback(app: tauri::AppHandle) -> Result<(), String> {
    let exe = target_exe().ok_or("No se sabe dónde está Escribanía.")?;
    swap_back(&exe)?;
    relaunch(&app, &exe)
}

/// La interfaz se ha mostrado bien: la versión nueva se queda.
#[tauri::command]
pub fn update_confirm_start() {
    if let Some(dir) = target_exe().and_then(|e| e.parent().map(PathBuf::from)) {
        let _ = std::fs::remove_file(dir.join(PENDING));
    }
}

/// Se llama al arrancar, antes de abrir la ventana. Si la versión nueva ya
/// arrancó una vez sin llegar a confirmar, se vuelve a la anterior y se abre esa.
pub fn startup_guard() {
    let Some(exe) = target_exe() else { return };
    let Some(dir) = exe.parent() else { return };
    let marker = dir.join(PENDING);
    let Ok(count) = std::fs::read_to_string(&marker) else { return };
    if count.trim() == "0" {
        let _ = std::fs::write(&marker, "1");
        return;
    }
    if swap_back(&exe).is_ok() && std::process::Command::new(&exe).spawn().is_ok() {
        std::process::exit(0);
    }
    let _ = std::fs::remove_file(&marker);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert!(is_newer("0.8.0", "0.7.0"));
        assert!(is_newer("v1.0.0", "0.99.9"));
        assert!(!is_newer("0.7.0", "0.7.0"));
        assert!(is_newer("0.8.0", "0.8.0-beta.2"));
        assert!(is_newer("0.8.0-beta.3", "0.8.0-beta.2"));
        assert!(!is_newer("0.8.0-beta.1", "0.8.0"));
        assert!(!is_newer("0.6.9", "0.7.0"));
    }

    #[test]
    fn signature_must_match() {
        use ed25519_dalek::{Signer, SigningKey};
        use sha2::Digest;
        let key = SigningKey::from_bytes(&[7u8; 32]);
        let public = STANDARD.encode(key.verifying_key().to_bytes());
        let data = b"Escribania.exe de prueba".to_vec();
        let sha = hex(&sha2::Sha256::digest(&data));
        let sig = STANDARD.encode(key.sign(&data).to_bytes());
        assert!(verify(&data, &sha, &sig, &public).is_ok());
        // Otro contenido con la huella falsificada: la firma lo delata.
        let mut evil = data.clone();
        evil[0] = b'X';
        let evil_sha = hex(&sha2::Sha256::digest(&evil));
        assert!(verify(&evil, &evil_sha, &sig, &public).is_err());
        // Huella que no cuadra.
        assert!(verify(&data, &evil_sha, &sig, &public).is_err());
        // Sin clave en la build.
        assert!(verify(&data, &sha, &sig, "").is_err());
    }

    #[test]
    fn swap_and_back() {
        let t = tempfile::tempdir().unwrap();
        let exe = t.path().join("Escribania.exe");
        let new = t.path().join("nueva.exe");
        std::fs::write(&exe, "vieja").unwrap();
        std::fs::write(&new, "nueva").unwrap();
        swap_in(&exe, &new).unwrap();
        assert_eq!(std::fs::read_to_string(&exe).unwrap(), "nueva");
        assert_eq!(std::fs::read_to_string(old_exe(&exe)).unwrap(), "vieja");
        assert_eq!(old_exe(&exe).file_name().unwrap(), "Escribania.old.exe");
        std::fs::write(t.path().join(PREVIOUS), "0.7.0").unwrap();
        assert_eq!(swap_back(&exe).unwrap(), "0.7.0");
        assert_eq!(std::fs::read_to_string(&exe).unwrap(), "vieja");
        assert_eq!(std::fs::read_to_string(old_exe(&exe)).unwrap(), "nueva");
    }
}
