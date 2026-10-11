//! Imprenta: libro electrónico EPUB 3 (con toc.ncx para lectores antiguos).
//!
//! La interfaz manda cada capítulo ya convertido a XHTML; aquí se arma el
//! paquete: mimetype sin comprimir, contenedor, OPF, índice y portada.

use crate::{fsx, project};
use serde::Deserialize;
use std::io::Write;
use std::path::Path;

#[derive(Deserialize)]
pub struct Chapter {
    pub title: String,
    /// Contenido del `<body>` en XHTML.
    pub body: String,
    #[serde(default = "yes")]
    pub in_toc: bool,
    /// `epub:type` del `<body>` (bodymatter, frontmatter, backmatter…).
    #[serde(default)]
    pub kind: String,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize)]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: String,
    pub lang: String,
    #[serde(default)]
    pub publisher: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub isbn: String,
    pub css: String,
    pub chapters: Vec<Chapter>,
    /// Imagen de portada, ruta relativa dentro del proyecto.
    #[serde(default)]
    pub cover: Option<String>,
    #[serde(default = "toc_title")]
    pub toc_title: String,
}

fn toc_title() -> String {
    "Índice".into()
}

pub fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn page(lang: &str, title: &str, kind: &str, body: &str) -> String {
    let kind = if kind.is_empty() { "bodymatter" } else { kind };
    format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" lang=\"{l}\" xml:lang=\"{l}\">\n<head>\n<meta charset=\"utf-8\"/>\n<title>{t}</title>\n<link rel=\"stylesheet\" type=\"text/css\" href=\"../style.css\"/>\n</head>\n<body epub:type=\"{k}\">\n{b}\n</body>\n</html>\n",
        l = esc(lang),
        t = esc(title),
        k = esc(kind),
        b = body
    )
}

pub fn build(book: &Book, cover: Option<(Vec<u8>, String)>) -> Result<Vec<u8>, String> {
    let mut buf = std::io::Cursor::new(Vec::new());
    {
        let mut z = zip::ZipWriter::new(&mut buf);
        let stored = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        let deflated = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let put = |z: &mut zip::ZipWriter<&mut std::io::Cursor<Vec<u8>>>, name: &str, data: &[u8], opts| -> Result<(), String> {
            z.start_file(name, opts).map_err(|e| e.to_string())?;
            z.write_all(data).map_err(|e| e.to_string())
        };

        put(&mut z, "mimetype", b"application/epub+zip", stored)?;
        put(
            &mut z,
            "META-INF/container.xml",
            br#"<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
"#,
            deflated,
        )?;
        put(&mut z, "OEBPS/style.css", book.css.as_bytes(), deflated)?;

        let mut manifest = String::new();
        let mut spine = String::new();
        let mut nav = String::new();
        let mut ncx = String::new();

        if let Some((data, ext)) = &cover {
            let mime = match ext.as_str() {
                "png" => "image/png",
                "webp" => "image/webp",
                _ => "image/jpeg",
            };
            put(&mut z, &format!("OEBPS/images/cover.{ext}"), data, stored)?;
            manifest.push_str(&format!("    <item id=\"cover-image\" href=\"images/cover.{ext}\" media-type=\"{mime}\" properties=\"cover-image\"/>\n"));
            let body = format!("<section epub:type=\"cover\" class=\"cover\"><img src=\"../images/cover.{ext}\" alt=\"{}\"/></section>", esc(&book.title));
            put(&mut z, "OEBPS/text/cover.xhtml", page(&book.lang, &book.title, "cover", &body).as_bytes(), deflated)?;
            manifest.push_str("    <item id=\"cover\" href=\"text/cover.xhtml\" media-type=\"application/xhtml+xml\"/>\n");
            spine.push_str("    <itemref idref=\"cover\" linear=\"yes\"/>\n");
        }

        let mut play = 0;
        for (i, ch) in book.chapters.iter().enumerate() {
            let id = format!("c{:03}", i + 1);
            let href = format!("text/{id}.xhtml");
            put(&mut z, &format!("OEBPS/{href}"), page(&book.lang, &ch.title, &ch.kind, &ch.body).as_bytes(), deflated)?;
            manifest.push_str(&format!("    <item id=\"{id}\" href=\"{href}\" media-type=\"application/xhtml+xml\"/>\n"));
            spine.push_str(&format!("    <itemref idref=\"{id}\"/>\n"));
            if ch.in_toc && !ch.title.trim().is_empty() {
                play += 1;
                nav.push_str(&format!("      <li><a href=\"{href}\">{}</a></li>\n", esc(&ch.title)));
                ncx.push_str(&format!(
                    "    <navPoint id=\"n{play}\" playOrder=\"{play}\"><navLabel><text>{}</text></navLabel><content src=\"{href}\"/></navPoint>\n",
                    esc(&ch.title)
                ));
            }
        }

        let nav_doc = format!(
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<!DOCTYPE html>\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" lang=\"{l}\" xml:lang=\"{l}\">\n<head><meta charset=\"utf-8\"/><title>{t}</title><link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\"/></head>\n<body>\n  <nav epub:type=\"toc\" id=\"toc\">\n    <h1>{t}</h1>\n    <ol>\n{nav}    </ol>\n  </nav>\n</body>\n</html>\n",
            l = esc(&book.lang),
            t = esc(&book.toc_title)
        );
        put(&mut z, "OEBPS/nav.xhtml", nav_doc.as_bytes(), deflated)?;
        let ncx_doc = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<ncx xmlns=\"http://www.daisy.org/z3986/2005/ncx/\" version=\"2005-1\">\n  <head><meta name=\"dtb:uid\" content=\"{id}\"/></head>\n  <docTitle><text>{t}</text></docTitle>\n  <navMap>\n{ncx}  </navMap>\n</ncx>\n",
            id = esc(&book.id),
            t = esc(&book.title)
        );
        put(&mut z, "OEBPS/toc.ncx", ncx_doc.as_bytes(), deflated)?;

        let modified = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
        let mut meta = format!(
            "    <dc:identifier id=\"bookid\">{}</dc:identifier>\n    <dc:title>{}</dc:title>\n    <dc:creator>{}</dc:creator>\n    <dc:language>{}</dc:language>\n    <meta property=\"dcterms:modified\">{modified}</meta>\n",
            esc(&if book.isbn.trim().is_empty() { format!("urn:uuid:{}", book.id) } else { format!("urn:isbn:{}", book.isbn.trim()) }),
            esc(&book.title),
            esc(&book.author),
            esc(&book.lang)
        );
        if !book.publisher.trim().is_empty() {
            meta.push_str(&format!("    <dc:publisher>{}</dc:publisher>\n", esc(&book.publisher)));
        }
        if !book.description.trim().is_empty() {
            meta.push_str(&format!("    <dc:description>{}</dc:description>\n", esc(&book.description)));
        }
        if cover.is_some() {
            meta.push_str("    <meta name=\"cover\" content=\"cover-image\"/>\n");
        }
        let opf = format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"bookid\" xml:lang=\"{l}\">\n  <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n{meta}  </metadata>\n  <manifest>\n    <item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n    <item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>\n    <item id=\"css\" href=\"style.css\" media-type=\"text/css\"/>\n{manifest}  </manifest>\n  <spine toc=\"ncx\">\n{spine}  </spine>\n</package>\n",
            l = esc(&book.lang)
        );
        put(&mut z, "OEBPS/content.opf", opf.as_bytes(), deflated)?;
        z.finish().map_err(|e| e.to_string())?;
    }
    Ok(buf.into_inner())
}

#[tauri::command]
pub fn epub_build(root: String, book: Book, out: String) -> Result<usize, String> {
    let cover = match &book.cover {
        Some(rel) if !rel.is_empty() => {
            let p = project::rel_path(Path::new(&root), rel)?;
            let ext = p.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_else(|| "jpg".into());
            let ext = if ext == "jpeg" { "jpg".to_string() } else { ext };
            Some((std::fs::read(&p).map_err(|e| format!("No se puede leer la portada: {e}"))?, ext))
        }
        _ => None,
    };
    let bytes = build(&book, cover)?;
    fsx::write_atomic(Path::new(&out), &bytes)?;
    Ok(bytes.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn valid_package_layout() {
        let book = Book {
            id: "abc".into(),
            title: "La casa & el faro".into(),
            author: "Ana".into(),
            lang: "es".into(),
            publisher: String::new(),
            description: String::new(),
            isbn: String::new(),
            css: "p{}".into(),
            chapters: vec![
                Chapter { title: "Uno".into(), body: "<h1>Uno</h1><p>Hola</p>".into(), in_toc: true, kind: String::new() },
                Chapter { title: "".into(), body: "<p>Sin título</p>".into(), in_toc: true, kind: String::new() },
            ],
            cover: None,
            toc_title: "Índice".into(),
        };
        let bytes = build(&book, Some((vec![1, 2, 3], "jpg".into()))).unwrap();
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        {
            let first = z.by_index(0).unwrap();
            assert_eq!(first.name(), "mimetype");
            assert_eq!(first.compression(), zip::CompressionMethod::Stored);
        }
        let mut opf = String::new();
        z.by_name("OEBPS/content.opf").unwrap().read_to_string(&mut opf).unwrap();
        assert!(opf.contains("<dc:title>La casa &amp; el faro</dc:title>"));
        assert!(opf.contains("properties=\"cover-image\""));
        assert!(opf.contains("idref=\"c002\""));
        let mut nav = String::new();
        z.by_name("OEBPS/nav.xhtml").unwrap().read_to_string(&mut nav).unwrap();
        assert!(nav.contains(">Uno</a>") && !nav.contains("c002.xhtml"));
    }
}
