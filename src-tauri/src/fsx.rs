//! Escritura segura: nunca se deja un archivo a medias.
//!
//! Se escribe en `<nombre>.tmp`, se fuerza al disco y se renombra encima del
//! original. Si se va la luz a mitad, queda el archivo anterior intacto.

use std::io::Write;
use std::path::Path;

pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("No se puede crear {}: {e}", parent.display()))?;
    }
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = std::path::PathBuf::from(tmp);
    {
        let mut f = std::fs::File::create(&tmp).map_err(|e| format!("No se puede escribir {}: {e}", tmp.display()))?;
        f.write_all(bytes).map_err(|e| e.to_string())?;
        f.sync_all().map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|e| format!("No se puede guardar {}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_and_leaves_no_tmp() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("a").join("b.md");
        write_atomic(&p, b"uno").unwrap();
        write_atomic(&p, "dos ñ".as_bytes()).unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "dos ñ");
        assert!(!t.path().join("a").join("b.md.tmp").exists());
    }
}
