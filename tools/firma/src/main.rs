//! Firma las versiones de Escribanía para que el actualizador solo instale lo
//! que sale de aquí.
//!
//!   firma clave              crea la clave (una sola vez) y escribe la pública
//!                            en src-tauri/firma.pub
//!   firma firmar <archivo>   escribe <archivo>.sig (firma ed25519 en base64)
//!   firma comprobar <archivo> comprueba <archivo>.sig con src-tauri/firma.pub
//!
//! La clave privada vive fuera del repositorio, en `%USERPROFILE%\.escribania\firma.key`
//! (o en la ruta de la variable `ESCRIBANIA_FIRMA`). Sin ella no se pueden
//! publicar actualizaciones que acepten las copias ya instaladas: guárdala bien.

use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use std::path::{Path, PathBuf};

fn key_path() -> PathBuf {
    if let Ok(p) = std::env::var("ESCRIBANIA_FIRMA") {
        return PathBuf::from(p);
    }
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join(".escribania").join("firma.key")
}

fn pub_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../src-tauri/firma.pub")
}

fn load_key() -> Result<SigningKey, String> {
    let p = key_path();
    let text = std::fs::read_to_string(&p).map_err(|_| format!("No encuentro la clave en {}. Créala con: firma clave", p.display()))?;
    let bytes = STANDARD.decode(text.trim()).map_err(|e| e.to_string())?;
    let arr: [u8; 32] = bytes.try_into().map_err(|_| "La clave no tiene 32 bytes".to_string())?;
    Ok(SigningKey::from_bytes(&arr))
}

fn load_pub() -> Result<VerifyingKey, String> {
    let text = std::fs::read_to_string(pub_path()).map_err(|e| e.to_string())?;
    let bytes = STANDARD.decode(text.trim()).map_err(|e| e.to_string())?;
    let arr: [u8; 32] = bytes.try_into().map_err(|_| "La clave pública no tiene 32 bytes".to_string())?;
    VerifyingKey::from_bytes(&arr).map_err(|e| e.to_string())
}

fn sig_path(file: &Path) -> PathBuf {
    let mut s = file.as_os_str().to_owned();
    s.push(".sig");
    PathBuf::from(s)
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("clave") => {
            let p = key_path();
            let key = if p.is_file() {
                println!("Ya hay una clave en {}: se usa esa.", p.display());
                load_key()?
            } else {
                let key = SigningKey::generate(&mut rand_core::OsRng);
                std::fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
                std::fs::write(&p, STANDARD.encode(key.to_bytes())).map_err(|e| e.to_string())?;
                println!("Clave nueva en {}. Haz una copia de seguridad: sin ella no se pueden publicar actualizaciones.", p.display());
                key
            };
            let public = STANDARD.encode(key.verifying_key().to_bytes());
            std::fs::write(pub_path(), format!("{public}\n")).map_err(|e| e.to_string())?;
            println!("Clave pública ({}) escrita en src-tauri/firma.pub", public);
            Ok(())
        }
        Some("firmar") => {
            let file = PathBuf::from(args.get(1).ok_or("Falta el archivo")?);
            let data = std::fs::read(&file).map_err(|e| format!("{}: {e}", file.display()))?;
            let sig = load_key()?.sign(&data);
            std::fs::write(sig_path(&file), STANDARD.encode(sig.to_bytes())).map_err(|e| e.to_string())?;
            println!("Firmado: {}", sig_path(&file).display());
            Ok(())
        }
        Some("comprobar") => {
            let file = PathBuf::from(args.get(1).ok_or("Falta el archivo")?);
            let data = std::fs::read(&file).map_err(|e| e.to_string())?;
            let sig = std::fs::read_to_string(sig_path(&file)).map_err(|e| e.to_string())?;
            let bytes = STANDARD.decode(sig.trim()).map_err(|e| e.to_string())?;
            let sig = Signature::from_slice(&bytes).map_err(|e| e.to_string())?;
            load_pub()?.verify(&data, &sig).map_err(|_| "La firma NO coincide".to_string())?;
            use sha2::Digest;
            let hash: String = sha2::Sha256::digest(&data).iter().map(|b| format!("{b:02x}")).collect();
            println!("Firma correcta. SHA-256 {hash}");
            Ok(())
        }
        _ => Err("Uso: firma clave | firma firmar <archivo> | firma comprobar <archivo>".into()),
    }
}

fn main() {
    if let Err(e) = run() {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
