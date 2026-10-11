//! Instalador de Escribanía con interfaz propia («Hoja en blanco»).
//!
//! Lleva dentro Escribania.exe y lo instala para el usuario, sin pedir
//! administrador, en `%LOCALAPPDATA%\Programs\Escribania` (o en la carpeta que
//! se elija), o lo deja portable en un USB. Se copia a sí mismo como
//! `desinstalar.exe`: el mismo programa desinstala y repara con la misma estética.
//!
//! Argumentos:
//!   (ninguno)        instalar con ventana
//!   /S               instalar en silencio (con /D=carpeta y /portable opcionales)
//!   --desinstalar    desinstalar (con /S, en silencio y conservando los datos)
//!   --reparar        reparar la instalación
//!
//! Solo para Windows: en Linux se distribuye AppImage y .deb.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::Emitter;

const PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.exe"));
const VERSION: &str = env!("APP_VERSION");
const LICENSE: &str = include_str!("../../LICENSE");
const APP_EXE: &str = "Escribania.exe";
const OLD_EXE: &str = "Escribania.old.exe";
const PREVIOUS: &str = "version-anterior.txt";
const UNINSTALLER: &str = "desinstalar.exe";
const UNINSTALL_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Escribania";
const PROG_ID: &str = "Escribania.Proyecto";
/// Carpeta de datos de la app instalada (la de Tauri: %APPDATA%\<identificador>).
const IDENTIFIER: &str = "com.escribania.desktop";
const NO_WINDOW: u32 = 0x0800_0000;
const PORTABLE_NOTE: &str = "Este archivo activa el modo portable de Escribanía.\r\nMientras esté junto a Escribania.exe, los ajustes, las copias de seguridad y el\r\ncuaderno se guardan en la carpeta Datos, al lado del programa.\r\nBórralo si prefieres que Escribanía guarde sus datos en este equipo.\r\n";

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Mode {
    Install,
    Uninstall,
    Repair,
}

fn arg(name: &str) -> bool {
    std::env::args().skip(1).any(|a| a.eq_ignore_ascii_case(name))
}

fn arg_value(prefix: &str) -> Option<String> {
    std::env::args().skip(1).find_map(|a| a.strip_prefix(prefix).map(str::to_string))
}

fn mode() -> Mode {
    if arg("--desinstalar") {
        Mode::Uninstall
    } else if arg("--reparar") {
        Mode::Repair
    } else if std::env::current_exe().ok().and_then(|e| e.file_name().map(|n| n.eq_ignore_ascii_case(UNINSTALLER))).unwrap_or(false) {
        Mode::Uninstall
    } else {
        Mode::Install
    }
}

fn env_path(var: &str, fallback: &str) -> PathBuf {
    std::env::var(var).map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(fallback))
}

fn default_dir() -> PathBuf {
    env_path("LOCALAPPDATA", r"C:\Users\Public").join("Programs").join("Escribania")
}

/// Para el modo portable: junto al instalador (el USB desde el que se abre).
fn default_portable_dir() -> PathBuf {
    std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("Escribania"))).unwrap_or_else(default_dir)
}

/// Versión y carpeta de la instalación registrada para este usuario.
fn installed() -> Option<(String, PathBuf)> {
    use winreg::enums::*;
    let key = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(UNINSTALL_KEY, KEY_READ).ok()?;
    let version: String = key.get_value("DisplayVersion").ok()?;
    let dir: String = key.get_value("InstallLocation").ok()?;
    Some((version, PathBuf::from(dir.trim_end_matches('\\'))))
}

fn parse_version(v: &str) -> Vec<u64> {
    v.split(['.', '-']).map(|p| p.parse().unwrap_or(0)).collect()
}

fn app_running() -> bool {
    let mut sys = sysinfo::System::new();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    sys.processes().values().any(|p| p.name().eq_ignore_ascii_case(APP_EXE))
}

/// Cierra Escribanía: primero con educación (la app guarda y hace copia al
/// cerrarse) y, si no responde, a la fuerza.
fn stop_app() {
    if !app_running() {
        return;
    }
    let _ = std::process::Command::new("taskkill.exe").args(["/IM", APP_EXE]).creation_flags(NO_WINDOW).status();
    let start = Instant::now();
    while app_running() && start.elapsed() < Duration::from_secs(10) {
        std::thread::sleep(Duration::from_millis(250));
    }
    if app_running() {
        let _ = std::process::Command::new("taskkill.exe").args(["/F", "/T", "/IM", APP_EXE]).creation_flags(NO_WINDOW).status();
        std::thread::sleep(Duration::from_millis(800));
    }
}

fn validate_dir(dir: &str) -> Result<PathBuf, String> {
    let p = PathBuf::from(dir.trim());
    let windows = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into()).to_lowercase();
    let lower = p.display().to_string().to_lowercase();
    if !p.is_absolute() || p.components().count() < 2 || p.parent().is_none() {
        return Err("Elige una carpeta, no la raíz de un disco.".into());
    }
    if lower.starts_with(&windows) || dir.contains(['"', '\n', '\r', '*', '?', '<', '>', '|']) {
        return Err("Esa carpeta no es válida para instalar programas.".into());
    }
    Ok(p)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetupInfo {
    version: String,
    mode: Mode,
    installed_version: Option<String>,
    install_dir: String,
    portable_dir: String,
    app_running: bool,
    /// Tamaño del programa en MB, para la bienvenida.
    size_mb: f64,
    /// La versión instalada es más nueva que esta.
    downgrade: bool,
    has_desktop_shortcut: bool,
}

#[tauri::command]
fn setup_info() -> SetupInfo {
    let current = installed().filter(|(_, d)| d.join(APP_EXE).is_file());
    let dir = arg_value("--dir=").map(PathBuf::from).or_else(|| current.as_ref().map(|(_, d)| d.clone())).unwrap_or_else(default_dir);
    SetupInfo {
        version: VERSION.into(),
        mode: mode(),
        downgrade: current.as_ref().is_some_and(|(v, _)| parse_version(v) > parse_version(VERSION)),
        installed_version: current.map(|(v, _)| v),
        install_dir: dir.display().to_string(),
        portable_dir: default_portable_dir().display().to_string(),
        app_running: app_running(),
        size_mb: (PAYLOAD.len() as f64 / 1024.0 / 1024.0 * 10.0).round() / 10.0,
        has_desktop_shortcut: desktop_dir().join("Escribanía.lnk").is_file(),
    }
}

fn desktop_dir() -> PathBuf {
    env_path("USERPROFILE", r"C:\Users\Public").join("Desktop")
}

#[tauri::command(async)]
fn pick_dir(app: tauri::AppHandle) -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog().file().blocking_pick_folder().and_then(|p| p.into_path().ok()).map(|p| p.join("Escribania").display().to_string())
}

#[derive(Serialize, Clone)]
struct Progress {
    percent: u32,
    /// Paso en curso: close, copy, keep, links, register, check.
    step: &'static str,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Options {
    dir: String,
    portable: bool,
    desktop: bool,
    associate: bool,
    /// "stable", "beta" u "off": se escribe en los ajustes de la app ("" no los toca).
    updates: String,
}

/// Escribe el programa por trozos, para que la barra avance de verdad.
fn write_payload(dest: &Path, emit: &dyn Fn(u32, &'static str)) -> Result<(), String> {
    let tmp = dest.with_extension("nuevo");
    let mut f = std::fs::File::create(&tmp).map_err(|e| format!("No se puede escribir en {}: {e}", tmp.display()))?;
    let chunk = 512 * 1024;
    for (i, part) in PAYLOAD.chunks(chunk).enumerate() {
        f.write_all(part).map_err(|e| format!("No se pudo copiar el programa: {e}"))?;
        let done = ((i + 1) * chunk).min(PAYLOAD.len()) as f64 / PAYLOAD.len().max(1) as f64;
        emit(15 + (done * 55.0) as u32, "copy");
    }
    f.sync_all().map_err(|e| e.to_string())?;
    drop(f);
    let _ = std::fs::remove_file(dest);
    std::fs::rename(&tmp, dest).map_err(|e| format!("No se pudo colocar el programa (¿sigue abierto?): {e}"))
}

/// Ejecuta un PowerShell corto con los datos en variables de entorno (sin
/// problemas de comillas ni de tildes en las rutas).
fn powershell(script: &str, vars: &[(&str, String)]) -> bool {
    let mut cmd = std::process::Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]).creation_flags(NO_WINDOW);
    for (k, v) in vars {
        cmd.env(k, v);
    }
    cmd.status().is_ok_and(|s| s.success())
}

const LINKS_PS: &str = r#"
$sh = New-Object -ComObject WScript.Shell
$targets = @([Environment]::GetFolderPath('Programs'))
if ($env:ESC_DESKTOP -eq '1') { $targets += [Environment]::GetFolderPath('Desktop') }
foreach ($d in $targets) {
  $l = $sh.CreateShortcut((Join-Path $d ($env:ESC_NAME + '.lnk')))
  $l.TargetPath = $env:ESC_EXE
  $l.WorkingDirectory = $env:ESC_DIR
  $l.IconLocation = $env:ESC_EXE + ',0'
  $l.Description = $env:ESC_DESC
  $l.Save()
}
if ($env:ESC_DESKTOP -ne '1') { Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) ($env:ESC_NAME + '.lnk')) -ErrorAction SilentlyContinue }
"#;

const UNLINK_PS: &str = r#"
foreach ($d in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
  Remove-Item (Join-Path $d ($env:ESC_NAME + '.lnk')) -ErrorAction SilentlyContinue
}
"#;

fn create_links(dir: &Path, desktop: bool) {
    let exe = dir.join(APP_EXE);
    powershell(
        LINKS_PS,
        &[
            ("ESC_NAME", "Escribanía".into()),
            ("ESC_EXE", exe.display().to_string()),
            ("ESC_DIR", dir.display().to_string()),
            ("ESC_DESKTOP", if desktop { "1".into() } else { "0".into() }),
            ("ESC_DESC", "Escribe, estructura y termina tu libro".into()),
        ],
    );
}

fn remove_links() {
    powershell(UNLINK_PS, &[("ESC_NAME", "Escribanía".into())]);
}

fn notify_shell() {
    use windows_sys::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};
    unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED as i32, SHCNF_IDLIST, std::ptr::null(), std::ptr::null()) };
}

fn associate(dir: &Path) -> std::io::Result<()> {
    use winreg::enums::*;
    let classes = winreg::RegKey::predef(HKEY_CURRENT_USER).create_subkey(r"Software\Classes")?.0;
    let exe = dir.join(APP_EXE).display().to_string();
    let (ext, _) = classes.create_subkey(".escribania")?;
    ext.set_value("", &PROG_ID)?;
    let (prog, _) = classes.create_subkey(PROG_ID)?;
    prog.set_value("", &"Proyecto de Escribanía")?;
    prog.create_subkey("DefaultIcon")?.0.set_value("", &format!("\"{exe}\",0"))?;
    prog.create_subkey(r"shell\open\command")?.0.set_value("", &format!("\"{exe}\" \"%1\""))?;
    Ok(())
}

fn unassociate() {
    use winreg::enums::*;
    let Ok(classes) = winreg::RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(r"Software\Classes", KEY_ALL_ACCESS) else { return };
    let ours = classes.open_subkey(".escribania").ok().and_then(|k| k.get_value::<String, _>("").ok()).is_some_and(|v| v == PROG_ID);
    if ours {
        let _ = classes.delete_subkey_all(".escribania");
    }
    let _ = classes.delete_subkey_all(PROG_ID);
}

fn register(dir: &Path) -> std::io::Result<()> {
    use winreg::enums::*;
    let (key, _) = winreg::RegKey::predef(HKEY_CURRENT_USER).create_subkey(UNINSTALL_KEY)?;
    let exe = dir.join(APP_EXE).display().to_string();
    let un = dir.join(UNINSTALLER).display().to_string();
    key.set_value("DisplayName", &"Escribanía")?;
    key.set_value("DisplayVersion", &VERSION)?;
    key.set_value("Publisher", &"David Bonilla")?;
    key.set_value("DisplayIcon", &format!("\"{exe}\",0"))?;
    key.set_value("InstallLocation", &dir.display().to_string())?;
    key.set_value("UninstallString", &format!("\"{un}\" --desinstalar"))?;
    key.set_value("QuietUninstallString", &format!("\"{un}\" --desinstalar /S"))?;
    key.set_value("ModifyPath", &format!("\"{un}\" --reparar"))?;
    key.set_value("Comments", &"Software libre para escritores (GPL-3.0)")?;
    key.set_value("EstimatedSize", &((PAYLOAD.len() / 1024) as u32 + 200))?;
    key.set_value("NoRepair", &1u32)?;
    Ok(())
}

fn data_dir(dir: &Path, portable: bool) -> PathBuf {
    if portable {
        dir.join("Datos")
    } else {
        env_path("APPDATA", r"C:\Users\Public").join(IDENTIFIER)
    }
}

/// Mezcla valores en los ajustes de la app sin tocar el resto.
fn merge_settings(data: &Path, values: serde_json::Value) -> Result<(), String> {
    std::fs::create_dir_all(data).map_err(|e| e.to_string())?;
    let path = data.join("ajustes.json");
    let mut cur: serde_json::Value = std::fs::read_to_string(&path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_else(|| serde_json::json!({}));
    if !cur.is_object() {
        cur = serde_json::json!({});
    }
    if let (Some(obj), Some(new)) = (cur.as_object_mut(), values.as_object()) {
        for (k, v) in new {
            obj.insert(k.clone(), v.clone());
        }
    }
    std::fs::write(&path, serde_json::to_string_pretty(&cur).unwrap()).map_err(|e| e.to_string())
}

fn install_files(dir: &Path, opts: &Options, emit: &dyn Fn(u32, &'static str)) -> Result<(), String> {
    if PAYLOAD.is_empty() {
        return Err("Este instalador se compiló sin Escribanía dentro.".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| format!("No se puede crear {}: {e}", dir.display()))?;
    emit(6, "close");
    stop_app();

    // La versión que había se guarda: Ajustes › Datos permite volver a ella.
    emit(12, "keep");
    let exe = dir.join(APP_EXE);
    if exe.is_file() {
        let same = std::fs::metadata(&exe).map(|m| m.len() == PAYLOAD.len() as u64).unwrap_or(false) && std::fs::read(&exe).map(|b| b == PAYLOAD).unwrap_or(false);
        if !same {
            let prev = installed().map(|(v, _)| v).unwrap_or_default();
            let _ = std::fs::remove_file(dir.join(OLD_EXE));
            std::fs::rename(&exe, dir.join(OLD_EXE)).map_err(|e| format!("Escribanía sigue abierta y no se puede reemplazar: {e}"))?;
            let _ = std::fs::write(dir.join(PREVIOUS), prev);
        }
    }
    emit(15, "copy");
    write_payload(&exe, emit)?;
    let _ = std::fs::write(dir.join("LICENSE.txt"), LICENSE);
    let _ = std::fs::remove_file(dir.join("arranque-pendiente"));

    emit(74, "links");
    if opts.portable {
        std::fs::write(dir.join("portable"), PORTABLE_NOTE).map_err(|e| e.to_string())?;
    } else {
        let _ = std::fs::remove_file(dir.join("portable"));
        // El desinstalador es este mismo programa.
        if let Ok(me) = std::env::current_exe() {
            if me != dir.join(UNINSTALLER) {
                std::fs::copy(&me, dir.join(UNINSTALLER)).map_err(|e| format!("No se pudo copiar el desinstalador: {e}"))?;
            }
        }
        create_links(dir, opts.desktop);
        if opts.associate {
            associate(dir).map_err(|e| format!("No se pudo asociar .escribania: {e}"))?;
        }
        emit(86, "register");
        register(dir).map_err(|e| format!("No se pudo registrar en Windows: {e}"))?;
        notify_shell();
    }
    // Vacío (al reparar): se respeta lo que el usuario tenga elegido.
    if ["stable", "beta", "off"].contains(&opts.updates.as_str()) {
        let _ = merge_settings(&data_dir(dir, opts.portable), serde_json::json!({ "updates": opts.updates }));
    }

    emit(94, "check");
    if std::fs::read(&exe).map(|b| b != PAYLOAD).unwrap_or(true) {
        return Err("El programa copiado no coincide con el del instalador. Vuelve a intentarlo.".into());
    }
    emit(100, "check");
    Ok(())
}

#[tauri::command(async)]
fn install(app: tauri::AppHandle, opts: Options) -> Result<String, String> {
    let dir = validate_dir(&opts.dir)?;
    let emit = |percent: u32, step: &'static str| {
        let _ = app.emit("progress", Progress { percent, step });
    };
    install_files(&dir, &opts, &emit)?;
    Ok(dir.display().to_string())
}

/// Tema e idioma elegidos en la última pantalla.
#[tauri::command]
fn set_prefs(dir: String, portable: bool, theme: String, lang: String) -> Result<(), String> {
    let theme = if ["algodon", "tinta", "olivetti", "pizarra"].contains(&theme.as_str()) { theme } else { "algodon".into() };
    let lang = if lang == "en" { "en" } else { "es" };
    merge_settings(&data_dir(Path::new(&dir), portable), serde_json::json!({ "theme": theme, "lang": lang }))
}

#[tauri::command]
fn launch(dir: String, sample: bool, tour: bool) -> Result<(), String> {
    let exe = Path::new(&dir).join(APP_EXE);
    let mut cmd = std::process::Command::new(&exe);
    cmd.current_dir(&dir);
    if sample {
        cmd.arg("--ejemplo");
    }
    if tour {
        cmd.arg("--recorrido");
    }
    cmd.spawn().map(|_| ()).map_err(|e| format!("No se pudo abrir Escribanía: {e}"))
}

fn remove_tree(p: &Path) {
    let _ = std::fs::remove_dir_all(p);
}

fn uninstall_files(dir: &Path, keep_data: bool, emit: &dyn Fn(u32, &'static str)) -> Result<(), String> {
    emit(8, "close");
    stop_app();
    emit(30, "links");
    remove_links();
    unassociate();
    emit(50, "register");
    {
        use winreg::enums::*;
        let _ = winreg::RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(UNINSTALL_KEY);
    }
    notify_shell();
    emit(70, "copy");
    let mut left = Vec::new();
    for name in [APP_EXE, OLD_EXE, PREVIOUS, UNINSTALLER, "LICENSE.txt", "arranque-pendiente", "Escribania.nuevo", "Escribania.swap"] {
        let p = dir.join(name);
        if p.exists() && std::fs::remove_file(&p).is_err() {
            left.push(name);
        }
    }
    let _ = std::fs::remove_dir(dir); // solo si quedó vacía: nunca se borra nada que no sea nuestro
    if !keep_data {
        emit(85, "keep");
        remove_tree(&data_dir(dir, false));
        // Caché del navegador interno (WebView2).
        remove_tree(&env_path("LOCALAPPDATA", r"C:\Users\Public").join(IDENTIFIER));
    }
    emit(100, "check");
    if left.is_empty() {
        Ok(())
    } else {
        Err(format!("No se pudieron borrar: {}. Ciérralos y bórralos a mano en {}.", left.join(", "), dir.display()))
    }
}

#[tauri::command(async)]
fn uninstall(app: tauri::AppHandle, dir: String, keep_data: bool) -> Result<(), String> {
    let dir = validate_dir(&dir)?;
    if !dir.join(APP_EXE).is_file() && !dir.join(UNINSTALLER).is_file() {
        return Err("En esa carpeta no está Escribanía.".into());
    }
    let emit = |percent: u32, step: &'static str| {
        let _ = app.emit("progress", Progress { percent, step });
    };
    uninstall_files(&dir, keep_data, &emit)
}

#[tauri::command]
fn license() -> &'static str {
    LICENSE
}

/// Si este programa es una copia temporal (para poder borrar desinstalar.exe),
/// se borra solo al salir.
fn schedule_self_delete() {
    if !arg("--temporal") {
        return;
    }
    if let Ok(me) = std::env::current_exe() {
        let _ = std::process::Command::new("cmd.exe")
            .raw_arg(format!("/C ping 127.0.0.1 -n 3 > nul & del /f /q \"{}\"", me.display()))
            .creation_flags(NO_WINDOW)
            .spawn();
    }
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    schedule_self_delete();
    app.exit(0);
}

/// desinstalar.exe no puede borrarse a sí mismo mientras se ejecuta: para
/// desinstalar o reparar se relanza una copia desde la carpeta temporal.
fn relaunch_from_temp() -> bool {
    if arg("--temporal") || mode() == Mode::Install {
        return false;
    }
    let Ok(me) = std::env::current_exe() else { return false };
    let Some(dir) = me.parent() else { return false };
    let tmp = std::env::temp_dir().join(format!("escribania-desinstalar-{}.exe", std::process::id()));
    if std::fs::copy(&me, &tmp).is_err() {
        return false;
    }
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    if mode() == Mode::Uninstall && !args.iter().any(|a| a.eq_ignore_ascii_case("--desinstalar")) {
        args.push("--desinstalar".into());
    }
    args.push("--temporal".into());
    args.push(format!("--dir={}", dir.display()));
    std::process::Command::new(&tmp).args(&args).spawn().is_ok()
}

fn message_box(text: &str, yes_no: bool) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_ICONINFORMATION, MB_OK, MB_YESNO};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let flags = if yes_no { MB_YESNO } else { MB_OK } | MB_ICONINFORMATION;
    unsafe { MessageBoxW(std::ptr::null_mut(), wide(text).as_ptr(), wide("Escribanía").as_ptr(), flags) == IDYES }
}

/// Instalar o desinstalar sin ventana (`/S`). Devuelve el código de salida.
fn silent() -> i32 {
    let none = |_: u32, _: &'static str| {};
    match mode() {
        Mode::Uninstall => {
            let dir = arg_value("--dir=").map(PathBuf::from).or_else(|| installed().map(|(_, d)| d)).unwrap_or_else(default_dir);
            let code = match uninstall_files(&dir, true, &none) {
                Ok(()) => 0,
                Err(_) => 2,
            };
            schedule_self_delete();
            code
        }
        _ => {
            let portable = arg("/portable");
            let dir = arg_value("/D=").unwrap_or_else(|| installed().map(|(_, d)| d).unwrap_or_else(default_dir).display().to_string());
            let opts = Options { dir: dir.clone(), portable, desktop: !arg("/sinescritorio"), associate: true, updates: "stable".into() };
            match validate_dir(&dir).and_then(|d| install_files(&d, &opts, &none)) {
                Ok(()) => 0,
                Err(e) => {
                    eprintln!("{e}");
                    1
                }
            }
        }
    }
}

fn main() {
    if arg("/S") {
        if relaunch_from_temp() {
            return;
        }
        std::process::exit(silent());
    }
    if relaunch_from_temp() {
        return;
    }
    // Sin WebView2 esta ventana no puede abrirse (en Windows 11 viene siempre).
    if tauri::webview_version().is_err() {
        if message_box("Para mostrar el instalador hace falta Microsoft Edge WebView2, que viene con Windows 11 y se instala gratis en Windows 10.\n\n¿Abrir la página de descarga?", true) {
            let _ = std::process::Command::new("explorer.exe").arg("https://go.microsoft.com/fwlink/p/?LinkId=2124703").spawn();
        }
        return;
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![setup_info, pick_dir, install, set_prefs, launch, uninstall, license, quit])
        .run(tauri::generate_context!())
        .expect("no se pudo abrir el instalador");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dirs() {
        assert!(validate_dir(r"C:\Users\Ana\AppData\Local\Programs\Escribania").is_ok());
        assert!(validate_dir(r"E:\Escribania").is_ok());
        assert!(validate_dir(r"C:\").is_err());
        assert!(validate_dir(r"C:\Windows\Escribania").is_err());
        assert!(validate_dir("Escribania").is_err());
        assert!(validate_dir(r"C:\a|b").is_err());
    }

    #[test]
    fn versions() {
        assert!(parse_version("0.8.0") > parse_version("0.7.9"));
        assert!(parse_version("1.0.0") > parse_version("0.99.0"));
    }

    #[test]
    fn settings_are_merged_not_replaced() {
        let t = tempfile::tempdir().unwrap();
        std::fs::write(t.path().join("ajustes.json"), r#"{"theme":"tinta","fontSize":20}"#).unwrap();
        merge_settings(t.path(), serde_json::json!({ "lang": "en", "theme": "olivetti" })).unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(t.path().join("ajustes.json")).unwrap()).unwrap();
        assert_eq!(v["theme"], "olivetti");
        assert_eq!(v["lang"], "en");
        assert_eq!(v["fontSize"], 20);
        // Ajustes ilegibles: se empieza de cero sin fallar.
        std::fs::write(t.path().join("ajustes.json"), "{roto").unwrap();
        merge_settings(t.path(), serde_json::json!({ "updates": "beta" })).unwrap();
        assert!(std::fs::read_to_string(t.path().join("ajustes.json")).unwrap().contains("beta"));
    }

    #[test]
    fn portable_data_lives_next_to_the_program() {
        assert_eq!(data_dir(Path::new(r"E:\Escribania"), true), PathBuf::from(r"E:\Escribania\Datos"));
        assert!(data_dir(Path::new(r"E:\Escribania"), false).ends_with(IDENTIFIER));
    }
}
