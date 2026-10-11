//! Buscar y reemplazar en todo el proyecto, y menciones del Códice (Ecos).
//!
//! Se busca en el Markdown de cada texto, sin la cabecera YAML. La interfaz
//! escapa la consulta igual que escapa el texto al guardarlo, así que un
//! asterisco escrito por el usuario se encuentra aunque en disco sea `\*`.

use crate::{fsx, project};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Deserialize, Clone)]
pub struct Query {
    pub query: String,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case: bool,
    #[serde(default)]
    pub word: bool,
}

pub fn build(q: &Query) -> Result<regex::Regex, String> {
    let mut pat = if q.regex { q.query.clone() } else { regex::escape(&q.query) };
    if q.word {
        pat = format!(r"\b(?:{pat})\b");
    }
    regex::RegexBuilder::new(&pat)
        .case_insensitive(!q.case)
        .multi_line(true)
        .size_limit(1 << 22)
        .build()
        .map_err(|e| format!("Expresión no válida: {e}"))
}

#[derive(Serialize)]
pub struct Hit {
    /// Orden de la coincidencia dentro del texto (0, 1, 2…).
    pub index: usize,
    pub before: String,
    pub matched: String,
    pub after: String,
}

#[derive(Serialize)]
pub struct FileHits {
    pub file: String,
    pub count: usize,
    pub hits: Vec<Hit>,
}

fn snippet_left(s: &str, n: usize) -> String {
    let chars: Vec<char> = s.chars().collect();
    let start = chars.len().saturating_sub(n);
    let t: String = chars[start..].iter().collect();
    let t = t.rsplit('\n').next().unwrap_or("").to_string();
    if start > 0 && !t.is_empty() { format!("…{}", t.trim_start()) } else { t }
}

fn snippet_right(s: &str, n: usize) -> String {
    let t: String = s.chars().take(n).collect();
    t.split('\n').next().unwrap_or("").to_string()
}

pub fn search_text(re: &regex::Regex, body: &str, max_hits: usize) -> (usize, Vec<Hit>) {
    let mut hits = Vec::new();
    let mut count = 0;
    for m in re.find_iter(body) {
        if m.as_str().is_empty() {
            continue;
        }
        if hits.len() < max_hits {
            hits.push(Hit {
                index: count,
                before: snippet_left(&body[..m.start()], 50),
                matched: m.as_str().to_string(),
                after: snippet_right(&body[m.end()..], 60),
            });
        }
        count += 1;
    }
    (count, hits)
}

/// Separa la cabecera YAML del cuerpo, para tocar solo el cuerpo.
fn split_front(raw: &str) -> (&str, &str) {
    let body = project::strip_front_matter(raw);
    (&raw[..raw.len() - body.len()], body)
}

#[tauri::command]
pub fn project_search(root: String, files: Vec<String>, q: Query) -> Result<Vec<FileHits>, String> {
    if q.query.is_empty() {
        return Ok(vec![]);
    }
    let re = build(&q)?;
    let root = Path::new(&root);
    let mut out = Vec::new();
    for f in files {
        let Ok(p) = project::text_path(root, &f) else { continue };
        let Ok(raw) = std::fs::read_to_string(&p) else { continue };
        let (count, hits) = search_text(&re, split_front(&raw).1, 200);
        if count > 0 {
            out.push(FileHits { file: f, count, hits });
        }
    }
    Ok(out)
}

pub fn replace_body(re: &regex::Regex, body: &str, with: &str, regex_mode: bool) -> (String, usize) {
    let count = re.find_iter(body).filter(|m| !m.as_str().is_empty()).count();
    let out = if regex_mode { re.replace_all(body, with) } else { re.replace_all(body, regex::NoExpand(with)) };
    (out.into_owned(), count)
}

/// Reemplaza en los archivos dados. Devuelve cuántos cambios hubo en cada uno.
#[tauri::command]
pub fn project_replace(root: String, files: Vec<String>, q: Query, with: String) -> Result<BTreeMap<String, usize>, String> {
    if q.query.is_empty() {
        return Ok(BTreeMap::new());
    }
    let re = build(&q)?;
    let root = Path::new(&root);
    let mut out = BTreeMap::new();
    for f in files {
        let p = project::text_path(root, &f)?;
        let Ok(raw) = std::fs::read_to_string(&p) else { continue };
        let (front, body) = split_front(&raw);
        let (new_body, n) = replace_body(&re, body, &with, q.regex);
        if n > 0 {
            fsx::write_atomic(&p, format!("{front}{new_body}").as_bytes())?;
            out.insert(f, n);
        }
    }
    Ok(out)
}

#[derive(Deserialize)]
pub struct MentionTerm {
    pub id: String,
    pub names: Vec<String>,
}

/// Para cada ficha del Códice, en qué textos aparece y cuántas veces.
#[tauri::command]
pub fn codex_mentions(root: String, files: Vec<String>, terms: Vec<MentionTerm>) -> Result<BTreeMap<String, BTreeMap<String, usize>>, String> {
    let root = Path::new(&root);
    let mut compiled = Vec::new();
    for t in terms {
        let names: Vec<String> = t.names.iter().map(|n| n.trim()).filter(|n| n.chars().count() >= 2).map(regex::escape).collect();
        if names.is_empty() {
            continue;
        }
        if let Ok(re) = regex::RegexBuilder::new(&format!(r"\b(?:{})\b", names.join("|"))).case_insensitive(true).build() {
            compiled.push((t.id, re));
        }
    }
    let mut out: BTreeMap<String, BTreeMap<String, usize>> = BTreeMap::new();
    for f in files {
        let Ok(p) = project::text_path(root, &f) else { continue };
        let Ok(raw) = std::fs::read_to_string(&p) else { continue };
        let body = project::strip_front_matter(&raw);
        for (id, re) in &compiled {
            let n = re.find_iter(body).count();
            if n > 0 {
                out.entry(id.clone()).or_default().insert(f.clone(), n);
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn q(s: &str, case: bool, word: bool) -> Query {
        Query { query: s.into(), regex: false, case, word }
    }

    #[test]
    fn finds_with_options() {
        let body = "Elena miró a Elena. elenas no. ELENA sí.";
        assert_eq!(search_text(&build(&q("elena", false, false)).unwrap(), body, 10).0, 4);
        assert_eq!(search_text(&build(&q("elena", false, true)).unwrap(), body, 10).0, 3);
        assert_eq!(search_text(&build(&q("Elena", true, true)).unwrap(), body, 10).0, 2);
        let (_, hits) = search_text(&build(&q("miró", true, false)).unwrap(), body, 10);
        assert_eq!(hits[0].before, "Elena ");
        assert_eq!(hits[0].after, " a Elena. elenas no. ELENA sí.");
    }

    #[test]
    fn replaces_only_the_body() {
        let t = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(t.path().join("texto")).unwrap();
        std::fs::write(t.path().join("texto/a.md"), "---\nid: \"a\"\ntitle: \"Tomás\"\n---\nTomás llegó. Tomás se fue.\n").unwrap();
        let root = t.path().display().to_string();
        let r = project_replace(root.clone(), vec!["texto/a.md".into()], q("Tomás", true, true), "Andrés".into()).unwrap();
        assert_eq!(r.get("texto/a.md"), Some(&2));
        let raw = std::fs::read_to_string(t.path().join("texto/a.md")).unwrap();
        assert_eq!(raw, "---\nid: \"a\"\ntitle: \"Tomás\"\n---\nAndrés llegó. Andrés se fue.\n");

        let m = codex_mentions(root, vec!["texto/a.md".into()], vec![MentionTerm { id: "x".into(), names: vec!["andrés".into(), "el pescador".into()] }]).unwrap();
        assert_eq!(m["x"]["texto/a.md"], 2);
    }

    #[test]
    fn regex_mode_and_bad_regex() {
        assert!(build(&Query { query: "(".into(), regex: true, case: false, word: false }).is_err());
        let re = build(&Query { query: r"(\w+) y (\w+)".into(), regex: true, case: false, word: false }).unwrap();
        assert_eq!(replace_body(&re, "pan y vino", "$2 y $1", true).0, "vino y pan");
        let lit = build(&q("$", true, false)).unwrap();
        assert_eq!(replace_body(&lit, "5$", "€", false).0, "5€");
    }
}
