//! Incrusta Escribania.exe (compilado antes con `tauri build`) en el instalador.
//! La versión es la de src-tauri/tauri.conf.json.
use std::path::PathBuf;

fn main() {
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).parent().unwrap().to_path_buf();
    let conf_path = root.join("src-tauri").join("tauri.conf.json");
    println!("cargo:rerun-if-changed={}", conf_path.display());
    let conf: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&conf_path).unwrap()).unwrap();
    let version = conf["version"].as_str().unwrap().to_string();
    println!("cargo:rustc-env=APP_VERSION={version}");

    let exe = root.join("src-tauri/target/release/Escribania.exe");
    println!("cargo:rerun-if-changed={}", exe.display());
    let out = PathBuf::from(std::env::var("OUT_DIR").unwrap()).join("payload.exe");
    if exe.exists() {
        std::fs::copy(&exe, &out).unwrap();
    } else if std::env::var("PROFILE").as_deref() == Ok("release") {
        panic!("Falta {}: compila Escribanía antes (npm run tauri build)", exe.display());
    } else {
        std::fs::write(&out, b"").unwrap(); // desarrollo: sin programa dentro
    }

    // Propiedades del ejecutable (Detalles en Windows): versión, editor y copyright de la app.
    let merge = serde_json::json!({
        "version": version,
        "productName": "Instalar Escribanía",
        "bundle": {
            "publisher": conf["bundle"]["publisher"],
            "copyright": conf["bundle"]["copyright"],
        },
    });
    std::env::set_var("TAURI_CONFIG", merge.to_string());
    tauri_build::build();
}
