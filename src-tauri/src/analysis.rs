//! Pulso: números de cada texto para ver el ritmo del libro.

use crate::project;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Serialize, Default, Debug, PartialEq)]
pub struct TextStats {
    pub words: usize,
    /// Palabras en párrafos de diálogo (empiezan por raya o comillas).
    pub dialogue: usize,
    pub sentences: usize,
    pub paragraphs: usize,
    /// Palabras de la frase más larga.
    pub longest: usize,
}

/// Quita las marcas de Markdown, comentarios y cambios rechazables del texto.
pub fn plain(md: &str) -> String {
    let mut s = md.to_string();
    // Lápiz rojo: lo borrado no cuenta; lo insertado sí.
    while let Some(a) = s.find("{--") {
        match s[a..].find("--}") {
            Some(b) => s.replace_range(a..a + b + 3, ""),
            None => break,
        }
    }
    for m in ["{++", "++}", "{{/c}}", "**", "~~", "\\"] {
        s = s.replace(m, "");
    }
    let re = regex::Regex::new(r"\{\{c:[a-z0-9]{1,20}\}\}").unwrap();
    re.replace_all(&s, "").replace('*', "")
}

pub fn stats(md: &str) -> TextStats {
    let text = plain(md);
    let mut st = TextStats::default();
    let sentence_end = regex::Regex::new(r"[.!?…]+[»”\x22)]*(\s|$)").unwrap();
    for para in text.split("\n\n").map(str::trim).filter(|p| !p.is_empty() && *p != "* * *") {
        let words = project::count_words(para);
        if words == 0 {
            continue;
        }
        st.paragraphs += 1;
        st.words += words;
        let first = para.trim_start_matches(['>', '#', ' ']).chars().next().unwrap_or(' ');
        if matches!(first, '—' | '–' | '«' | '"' | '“' | '-') {
            st.dialogue += words;
        }
        let mut last = 0;
        for m in sentence_end.find_iter(para) {
            let n = project::count_words(&para[last..m.end()]);
            if n > 0 {
                st.sentences += 1;
                st.longest = st.longest.max(n);
            }
            last = m.end();
        }
        let n = project::count_words(&para[last..]);
        if n > 0 {
            st.sentences += 1;
            st.longest = st.longest.max(n);
        }
    }
    st
}

#[tauri::command]
pub fn texts_stats(root: String, files: Vec<String>) -> Result<BTreeMap<String, TextStats>, String> {
    let root = Path::new(&root);
    let mut out = BTreeMap::new();
    for f in files {
        let Ok(p) = project::text_path(root, &f) else { continue };
        let raw = std::fs::read_to_string(&p).unwrap_or_default();
        out.insert(f, stats(project::strip_front_matter(&raw)));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts_dialogue_and_sentences() {
        let md = "La marea subió. Elena miró el puerto.\n\n—No puede ser —dijo ella—. ¿Quién la escribió?\n\n* * *\n\n{--Borrado.--} {++Nuevo++} final";
        let s = stats(md);
        assert_eq!(s.paragraphs, 3);
        assert_eq!(s.dialogue, 8);
        assert_eq!(s.words, 7 + 8 + 2);
        assert_eq!(s.sentences, 2 + 2 + 1);
        assert_eq!(s.longest, 5);
    }
}
