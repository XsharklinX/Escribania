//! Puentes: importar proyectos de otros programas.
//!
//! - **Scrivener** (.scriv / .scrivx, versiones 2 y 3): árbol, textos RTF, sinopsis y notas.
//! - **Manuskript** (.msk, comprimido o carpeta): esquema, resúmenes y personajes.
//! - **Word** (.docx): títulos como capítulos, cursivas y negritas, comentarios y
//!   control de cambios (se convierten a Marginalia y Lápiz rojo).
//! - **Carpeta de Markdown** (Obsidian, Novelcrafter, Ulysses exportados…).
//!
//! Todo se traduce a un árbol común en Markdown que la interfaz guarda en el proyecto.

use quick_xml::events::Event;
use quick_xml::XmlVersion;
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Serialize, Default, Clone, Debug)]
pub struct ImpComment {
    pub id: String,
    pub author: String,
    pub date: String,
    pub text: String,
}

#[derive(Serialize, Default, Clone, Debug)]
pub struct ImpNode {
    /// "folder", "text" o "file".
    pub kind: String,
    pub title: String,
    pub body: String,
    pub synopsis: String,
    pub notes: String,
    pub include: bool,
    pub children: Vec<ImpNode>,
    pub comments: Vec<ImpComment>,
    /// Solo "file": ruta del archivo original para copiarlo a Investigación.
    pub src: String,
}

#[derive(Serialize, Default, Debug)]
pub struct ImpCodex {
    pub kind: String,
    pub name: String,
    pub description: String,
    pub fields: Vec<(String, String)>,
}

#[derive(Serialize, Default, Debug)]
pub struct Imported {
    pub title: String,
    pub author: String,
    pub manuscript: Vec<ImpNode>,
    pub research: Vec<ImpNode>,
    pub notes: Vec<ImpNode>,
    pub codex: Vec<ImpCodex>,
    pub warnings: Vec<String>,
}

fn text(title: &str, body: String) -> ImpNode {
    ImpNode { kind: "text".into(), title: title.into(), body, include: true, ..Default::default() }
}

fn folder(title: &str, children: Vec<ImpNode>) -> ImpNode {
    ImpNode { kind: "folder".into(), title: title.into(), include: true, children, ..Default::default() }
}

// ---------------- texto con formato → Markdown ----------------

#[derive(Clone, Default, PartialEq, Debug)]
pub struct Seg {
    pub text: String,
    pub b: bool,
    pub i: bool,
    pub s: bool,
    pub ins: bool,
    pub del: bool,
    pub comment: Option<String>,
}

impl Seg {
    fn same_style(&self, o: &Seg) -> bool {
        self.b == o.b && self.i == o.i && self.s == o.s && self.ins == o.ins && self.del == o.del && self.comment == o.comment
    }
}

/// Igual que `escapeInline` de la interfaz (src/lib/markdown.ts).
pub fn escape_inline(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if "\\*_~`[]{}".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn escape_line_start(line: &str) -> String {
    let t = line;
    let starts = |p: &str| t.starts_with(p);
    if (starts("#") && t.trim_start_matches('#').starts_with([' ', '\t'])) || starts(">") || starts("- ") || starts("+ ") || t == "-" || t == "+" {
        return format!("\\{t}");
    }
    let digits: String = t.chars().take_while(|c| c.is_ascii_digit()).collect();
    if !digits.is_empty() {
        let rest = &t[digits.len()..];
        if (rest.starts_with(". ") || rest.starts_with(") ") || rest == "." || rest == ")") && digits.len() < 10 {
            return format!("{digits}\\{rest}");
        }
    }
    t.to_string()
}

/// Segmentos de un párrafo → Markdown de Escribanía.
pub fn segs_to_md(segs: &[Seg]) -> String {
    // Unir trozos contiguos con el mismo estilo (Word parte el texto sin motivo).
    let mut merged: Vec<Seg> = Vec::new();
    for s in segs {
        if s.text.is_empty() {
            continue;
        }
        match merged.last_mut() {
            Some(last) if last.same_style(s) && s.text != "\n" && last.text != "\n" => last.text.push_str(&s.text),
            _ => merged.push(s.clone()),
        }
    }
    let mut out = String::new();
    for s in &merged {
        if s.text == "\n" {
            out.push_str("\\\n");
            continue;
        }
        let lead: String = s.text.chars().take_while(|c| c.is_whitespace()).collect();
        let trail: String = s.text.chars().rev().take_while(|c| c.is_whitespace()).collect::<String>().chars().rev().collect();
        let core = s.text.trim();
        if core.is_empty() {
            out.push_str(&s.text);
            continue;
        }
        let mut open = String::new();
        let mut close = String::new();
        if let Some(id) = &s.comment {
            open.push_str(&format!("{{{{c:{id}}}}}"));
            close.insert_str(0, "{{/c}}");
        }
        if s.ins {
            open.push_str("{++");
            close.insert_str(0, "++}");
        } else if s.del {
            open.push_str("{--");
            close.insert_str(0, "--}");
        }
        if s.b {
            open.push_str("**");
            close.insert_str(0, "**");
        }
        if s.i {
            open.push('*');
            close.insert(0, '*');
        }
        if s.s {
            open.push_str("~~");
            close.insert_str(0, "~~");
        }
        out.push_str(&lead);
        out.push_str(&open);
        out.push_str(&escape_inline(core));
        out.push_str(&close);
        out.push_str(&trail);
    }
    let out = out.split("\\\n").map(|l| escape_line_start(l.trim_start())).collect::<Vec<_>>().join("\\\n");
    let t = out.trim().to_string();
    // Separadores de escena habituales.
    if ["***", "* * *", "\\*\\*\\*", "\\* \\* \\*", "#", "\\#", "⁂", "❦", "~", "\\~"].contains(&t.as_str()) {
        return "* * *".into();
    }
    t
}

// ---------------- Word (.docx) ----------------

#[derive(Debug, Default)]
pub struct Para {
    /// 0 = párrafo normal, 1-6 = título; 99 = título del documento.
    pub heading: u8,
    pub md: String,
}

fn attr(e: &quick_xml::events::BytesStart, name: &str) -> Option<String> {
    e.try_get_attribute(name).ok().flatten().and_then(|a| a.normalized_value(XmlVersion::Implicit1_0).ok().map(|v| v.to_string()))
}

fn on(e: &quick_xml::events::BytesStart) -> bool {
    !matches!(attr(e, "w:val").as_deref(), Some("0") | Some("false") | Some("none"))
}

fn heading_level(style: &str) -> u8 {
    let s = style.to_lowercase();
    if s == "title" || s == "ttulo" || s == "titulo" || s == "título" {
        return 99;
    }
    for prefix in ["heading", "ttulo", "titulo", "título", "berschrift", "titre"] {
        if let Some(rest) = s.strip_prefix(prefix) {
            if let Ok(n) = rest.trim().parse::<u8>() {
                return n.clamp(1, 6);
            }
        }
    }
    0
}

fn read_zip_text(z: &mut zip::ZipArchive<std::io::Cursor<Vec<u8>>>, name: &str) -> Option<String> {
    let mut f = z.by_name(name).ok()?;
    let mut s = String::new();
    f.read_to_string(&mut s).ok()?;
    Some(s)
}

fn ref_char(r: &quick_xml::events::BytesRef) -> Option<char> {
    if let Ok(Some(c)) = r.resolve_char_ref() {
        return Some(c);
    }
    match r.xml_content(XmlVersion::Implicit1_0).as_ref() {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        _ => None,
    }
}

fn parse_comments(xml: &str) -> Vec<ImpComment> {
    let mut r = quick_xml::Reader::from_str(xml);
    let mut out = Vec::new();
    let mut cur: Option<ImpComment> = None;
    let mut in_t = false;
    loop {
        match r.read_event() {
            Ok(Event::Start(e)) => match e.name().as_ref() {
                "w:comment" => {
                    cur = Some(ImpComment {
                        id: format!("w{}", attr(&e, "w:id").unwrap_or_default()),
                        author: attr(&e, "w:author").unwrap_or_default(),
                        date: attr(&e, "w:date").unwrap_or_default(),
                        text: String::new(),
                    })
                }
                "w:t" => in_t = true,
                "w:p" => {
                    if let Some(c) = cur.as_mut() {
                        if !c.text.is_empty() {
                            c.text.push('\n');
                        }
                    }
                }
                _ => {}
            },
            Ok(Event::End(e)) => match e.name().as_ref() {
                "w:comment" => {
                    if let Some(mut c) = cur.take() {
                        c.text = c.text.trim().to_string();
                        out.push(c);
                    }
                }
                "w:t" => in_t = false,
                _ => {}
            },
            Ok(Event::Text(t)) if in_t => {
                if let Some(c) = cur.as_mut() {
                    c.text.push_str(&t.xml_content(XmlVersion::Implicit1_0));
                }
            }
            Ok(Event::GeneralRef(rf)) if in_t => {
                if let (Some(c), Some(ch)) = (cur.as_mut(), ref_char(&rf)) {
                    c.text.push(ch);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    out
}

/// Párrafos de un .docx (ya en Markdown) y sus comentarios.
pub fn docx_paragraphs(bytes: Vec<u8>) -> Result<(Vec<Para>, Vec<ImpComment>), String> {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|_| "No es un documento de Word válido.".to_string())?;
    let doc = read_zip_text(&mut z, "word/document.xml").ok_or("El documento no tiene contenido (word/document.xml).")?;
    let comments = read_zip_text(&mut z, "word/comments.xml").map(|x| parse_comments(&x)).unwrap_or_default();

    let mut r = quick_xml::Reader::from_str(&doc);
    let mut paras = Vec::new();
    let mut segs: Vec<Seg> = Vec::new();
    let mut heading = 0u8;
    let mut in_p = false;
    let mut in_rpr = false;
    let mut in_text = false;
    let mut run = Seg::default();
    let mut ins = 0usize;
    let mut del = 0usize;
    let mut open_comments: Vec<String> = Vec::new();
    let mut skip = 0usize; // notas al pie, campos ocultos…

    loop {
        let ev = r.read_event().map_err(|e| format!("El documento está dañado: {e}"))?;
        match ev {
            Event::Start(ref e) | Event::Empty(ref e) => {
                let empty = matches!(ev, Event::Empty(_));
                let name = e.name();
                match name.as_ref() {
                    "w:p" if !empty => {
                        in_p = true;
                        heading = 0;
                        segs.clear();
                    }
                    "w:pStyle" => heading = heading_level(&attr(e, "w:val").unwrap_or_default()),
                    "w:outlineLvl" => {
                        if heading == 0 {
                            if let Some(Ok(n)) = attr(e, "w:val").map(|v| v.parse::<u8>()) {
                                heading = (n + 1).min(6);
                            }
                        }
                    }
                    "w:r" if !empty => {
                        run = Seg { ins: ins > 0, del: del > 0, comment: open_comments.last().cloned(), ..Default::default() };
                    }
                    "w:rPr" if !empty => in_rpr = true,
                    "w:b" if in_rpr => run.b = on(e),
                    "w:i" if in_rpr => run.i = on(e),
                    "w:strike" | "w:dstrike" if in_rpr => run.s = on(e),
                    "w:t" | "w:delText" if !empty => in_text = true,
                    "w:tab" if in_p && !in_rpr => segs.push(Seg { text: " ".into(), ..run.clone() }),
                    "w:br" | "w:cr" if in_p => {
                        if attr(e, "w:type").as_deref() != Some("page") {
                            segs.push(Seg { text: "\n".into(), ..run.clone() });
                        }
                    }
                    "w:ins" if !empty => ins += 1,
                    "w:del" if !empty => del += 1,
                    "w:commentRangeStart" => open_comments.push(format!("w{}", attr(e, "w:id").unwrap_or_default())),
                    "w:commentRangeEnd" => {
                        let id = format!("w{}", attr(e, "w:id").unwrap_or_default());
                        open_comments.retain(|c| c != &id);
                    }
                    "w:footnoteReference" | "w:endnoteReference" => {}
                    "w:instrText" | "w:fldSimple" if !empty => skip += 1,
                    _ => {}
                }
            }
            Event::End(e) => match e.name().as_ref() {
                "w:p" => {
                    in_p = false;
                    let md = segs_to_md(&segs);
                    if !md.is_empty() || heading == 0 {
                        paras.push(Para { heading, md });
                    }
                    segs.clear();
                }
                "w:rPr" => in_rpr = false,
                "w:t" | "w:delText" => in_text = false,
                "w:ins" => ins = ins.saturating_sub(1),
                "w:del" => del = del.saturating_sub(1),
                "w:instrText" | "w:fldSimple" => skip = skip.saturating_sub(1),
                _ => {}
            },
            Event::Text(t) if in_text && skip == 0 => segs.push(Seg { text: t.xml_content(XmlVersion::Implicit1_0).to_string(), ..run.clone() }),
            Event::GeneralRef(rf) if in_text && skip == 0 => {
                if let Some(c) = ref_char(&rf) {
                    segs.push(Seg { text: c.to_string(), ..run.clone() });
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok((paras, comments))
}

/// Párrafos → árbol: con Título 1 y 2, el 1 es carpeta y el 2 texto; con solo
/// Título 1, cada uno es un texto; sin títulos, un único texto.
pub fn paras_to_tree(paras: Vec<Para>, fallback_title: &str, comments: &[ImpComment]) -> (String, Vec<ImpNode>) {
    let mut doc_title = String::new();
    let levels: Vec<u8> = paras.iter().map(|p| p.heading).filter(|h| (1..=6).contains(h)).collect();
    let top = levels.iter().min().copied().unwrap_or(0);
    let second = levels.iter().filter(|&&h| h > top).min().copied().unwrap_or(0);

    let attach = |node: &mut ImpNode| {
        node.comments = comments.iter().filter(|c| node.body.contains(&format!("{{{{c:{}}}}}", c.id))).cloned().collect();
    };
    let plain = |md: &str| md.replace('\\', "").replace("**", "").replace('*', "");

    let mut out: Vec<ImpNode> = Vec::new();
    let mut cur_folder: Option<ImpNode> = None;
    let mut cur_text: Option<ImpNode> = None;
    let mut body: Vec<String> = Vec::new();

    let flush_text = |cur_text: &mut Option<ImpNode>, body: &mut Vec<String>, cur_folder: &mut Option<ImpNode>, out: &mut Vec<ImpNode>| {
        let b = body.join("\n\n");
        body.clear();
        let t = match cur_text.take() {
            Some(mut t) => {
                t.body = b;
                Some(t)
            }
            None if !b.trim().is_empty() => Some(text(fallback_title, b)),
            None => None,
        };
        if let Some(mut t) = t {
            attach(&mut t);
            match cur_folder.as_mut() {
                Some(f) => f.children.push(t),
                None => out.push(t),
            }
        }
    };

    for p in paras {
        if p.heading == 99 {
            if doc_title.is_empty() {
                doc_title = plain(&p.md);
            }
            continue;
        }
        if top > 0 && p.heading == top {
            flush_text(&mut cur_text, &mut body, &mut cur_folder, &mut out);
            if second > 0 {
                if let Some(f) = cur_folder.take() {
                    out.push(f);
                }
                cur_folder = Some(folder(&plain(&p.md), vec![]));
            } else {
                cur_text = Some(text(&plain(&p.md), String::new()));
            }
            continue;
        }
        if second > 0 && p.heading == second {
            flush_text(&mut cur_text, &mut body, &mut cur_folder, &mut out);
            cur_text = Some(text(&plain(&p.md), String::new()));
            continue;
        }
        if p.heading > 0 {
            body.push(format!("### {}", p.md));
        } else if !p.md.is_empty() {
            body.push(p.md);
        }
    }
    flush_text(&mut cur_text, &mut body, &mut cur_folder, &mut out);
    if let Some(f) = cur_folder.take() {
        out.push(f);
    }
    (doc_title, out)
}

fn import_docx(path: &Path) -> Result<Imported, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("No se puede leer el archivo: {e}"))?;
    let (paras, comments) = docx_paragraphs(bytes)?;
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let (title, tree) = paras_to_tree(paras, &stem, &comments);
    Ok(Imported { title: if title.is_empty() { stem } else { title }, manuscript: tree, ..Default::default() })
}

// ---------------- RTF (Scrivener) ----------------

const CP1252: [char; 32] = [
    '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž', '\u{8f}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ',
    '\u{9d}', 'ž', 'Ÿ',
];

fn cp1252(b: u8) -> char {
    if (0x80..0xa0).contains(&b) {
        CP1252[(b - 0x80) as usize]
    } else {
        b as char
    }
}

const SKIP_DEST: &[&str] = &[
    "fonttbl", "colortbl", "stylesheet", "info", "pict", "header", "footer", "headerl", "headerr", "footerl", "footerr", "listtable", "listoverridetable",
    "expandedcolortbl", "generator", "themedata", "colorschememapping", "latentstyles", "datastore", "xmlnstbl", "rsidtbl", "mmathPr", "fldinst", "object",
    "nonshppict", "bkmkstart", "bkmkend", "field",
];

/// RTF → párrafos en Markdown. Lo justo para el texto de un manuscrito.
pub fn rtf_to_md(rtf: &str) -> String {
    #[derive(Clone, Default)]
    struct St {
        b: bool,
        i: bool,
        s: bool,
        skip: bool,
        uc: usize,
    }
    let chars: Vec<char> = rtf.chars().collect();
    let mut stack: Vec<St> = vec![St { uc: 1, ..Default::default() }];
    let mut paras: Vec<String> = Vec::new();
    let mut segs: Vec<Seg> = Vec::new();
    let mut pending_skip = 0usize; // caracteres de reserva tras \u
    let mut i = 0;
    let push = |segs: &mut Vec<Seg>, st: &St, c: &str| {
        if !st.skip {
            segs.push(Seg { text: c.to_string(), b: st.b, i: st.i, s: st.s, ..Default::default() });
        }
    };
    let end_par = |segs: &mut Vec<Seg>, paras: &mut Vec<String>| {
        paras.push(segs_to_md(segs));
        segs.clear();
    };
    while i < chars.len() {
        let c = chars[i];
        match c {
            '{' => {
                let top = stack.last().cloned().unwrap_or_default();
                stack.push(top);
                i += 1;
                // {\* … } es una destinación que se puede ignorar.
                if chars.get(i) == Some(&'\\') && chars.get(i + 1) == Some(&'*') {
                    if let Some(s) = stack.last_mut() {
                        s.skip = true;
                    }
                }
            }
            '}' => {
                if stack.len() > 1 {
                    stack.pop();
                }
                i += 1;
            }
            '\\' => {
                i += 1;
                let Some(&n) = chars.get(i) else { break };
                if n.is_ascii_alphabetic() {
                    let start = i;
                    while i < chars.len() && chars[i].is_ascii_alphabetic() {
                        i += 1;
                    }
                    let word: String = chars[start..i].iter().collect();
                    let nstart = i;
                    if i < chars.len() && (chars[i] == '-' || chars[i].is_ascii_digit()) {
                        i += 1;
                        while i < chars.len() && chars[i].is_ascii_digit() {
                            i += 1;
                        }
                    }
                    let num: Option<i32> = if i > nstart { chars[nstart..i].iter().collect::<String>().parse().ok() } else { None };
                    if i < chars.len() && chars[i] == ' ' {
                        i += 1;
                    }
                    let st = stack.last_mut().unwrap();
                    match word.as_str() {
                        w if SKIP_DEST.contains(&w) => st.skip = true,
                        "par" | "sect" => {
                            if !st.skip {
                                end_par(&mut segs, &mut paras);
                            }
                        }
                        "line" => {
                            let st = st.clone();
                            push(&mut segs, &st, "\n");
                        }
                        "tab" => {
                            let st = st.clone();
                            push(&mut segs, &st, " ");
                        }
                        "emdash" => {
                            let st = st.clone();
                            push(&mut segs, &st, "—");
                        }
                        "endash" => {
                            let st = st.clone();
                            push(&mut segs, &st, "–");
                        }
                        "lquote" => {
                            let st = st.clone();
                            push(&mut segs, &st, "‘");
                        }
                        "rquote" => {
                            let st = st.clone();
                            push(&mut segs, &st, "’");
                        }
                        "ldblquote" => {
                            let st = st.clone();
                            push(&mut segs, &st, "“");
                        }
                        "rdblquote" => {
                            let st = st.clone();
                            push(&mut segs, &st, "”");
                        }
                        "b" => st.b = num != Some(0),
                        "i" => st.i = num != Some(0),
                        "strike" => st.s = num != Some(0),
                        "plain" => {
                            st.b = false;
                            st.i = false;
                            st.s = false;
                        }
                        "uc" => st.uc = num.unwrap_or(1).max(0) as usize,
                        "u" => {
                            let mut v = num.unwrap_or(0);
                            if v < 0 {
                                v += 65536;
                            }
                            if let Some(ch) = char::from_u32(v as u32) {
                                let st = st.clone();
                                push(&mut segs, &st, &ch.to_string());
                            }
                            pending_skip = stack.last().map(|s| s.uc).unwrap_or(1);
                        }
                        _ => {}
                    }
                    continue;
                }
                // Símbolos de control.
                i += 1;
                let st = stack.last().cloned().unwrap_or_default();
                match n {
                    '\'' => {
                        let hex: String = chars.get(i..i + 2).map(|s| s.iter().collect()).unwrap_or_default();
                        i += 2;
                        if pending_skip > 0 {
                            pending_skip -= 1;
                        } else if let Ok(b) = u8::from_str_radix(&hex, 16) {
                            push(&mut segs, &st, &cp1252(b).to_string());
                        }
                    }
                    '\\' | '{' | '}' => push(&mut segs, &st, &n.to_string()),
                    '~' => push(&mut segs, &st, "\u{a0}"),
                    '_' => push(&mut segs, &st, "-"),
                    '\n' | '\r' => {
                        if !st.skip {
                            end_par(&mut segs, &mut paras);
                        }
                    }
                    '*' => {
                        if let Some(s) = stack.last_mut() {
                            s.skip = true;
                        }
                    }
                    _ => {}
                }
            }
            '\r' | '\n' => i += 1,
            _ => {
                if pending_skip > 0 {
                    pending_skip -= 1;
                } else {
                    let st = stack.last().cloned().unwrap_or_default();
                    push(&mut segs, &st, &c.to_string());
                }
                i += 1;
            }
        }
    }
    if !segs.is_empty() {
        end_par(&mut segs, &mut paras);
    }
    paras.into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join("\n\n")
}

// ---------------- Scrivener ----------------

#[derive(Debug, Default)]
struct BinderItem {
    uuid: String,
    id: String,
    kind: String,
    title: String,
    include: bool,
    children: Vec<BinderItem>,
}

fn parse_binder(xml: &str) -> Vec<BinderItem> {
    let mut r = quick_xml::Reader::from_str(xml);
    let mut stack: Vec<BinderItem> = Vec::new();
    let mut roots = Vec::new();
    let mut in_title = false;
    let mut in_include = false;
    loop {
        match r.read_event() {
            Ok(Event::Start(e)) => match e.name().as_ref() {
                "BinderItem" => stack.push(BinderItem {
                    uuid: attr(&e, "UUID").unwrap_or_default(),
                    id: attr(&e, "ID").unwrap_or_default(),
                    kind: attr(&e, "Type").unwrap_or_default(),
                    include: true,
                    ..Default::default()
                }),
                "Title" => in_title = true,
                "IncludeInCompile" => in_include = true,
                _ => {}
            },
            Ok(Event::End(e)) => match e.name().as_ref() {
                "BinderItem" => {
                    if let Some(item) = stack.pop() {
                        match stack.last_mut() {
                            Some(parent) => parent.children.push(item),
                            None => roots.push(item),
                        }
                    }
                }
                "Title" => in_title = false,
                "IncludeInCompile" => in_include = false,
                _ => {}
            },
            Ok(Event::Text(t)) => {
                let s = t.xml_content(XmlVersion::Implicit1_0).to_string();
                if let Some(item) = stack.last_mut() {
                    if in_title {
                        item.title.push_str(&s);
                    } else if in_include {
                        item.include = s.trim().eq_ignore_ascii_case("yes");
                    }
                }
            }
            Ok(Event::GeneralRef(rf)) if in_title => {
                if let (Some(item), Some(c)) = (stack.last_mut(), ref_char(&rf)) {
                    item.title.push(c);
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    roots
}

struct Scriv {
    root: PathBuf,
    v3: bool,
}

impl Scriv {
    fn file(&self, item: &BinderItem, name3: &str, name2: &str) -> PathBuf {
        if self.v3 {
            self.root.join("Files").join("Data").join(&item.uuid).join(name3)
        } else {
            self.root.join("Files").join("Docs").join(name2.replace("{}", &item.id))
        }
    }
    fn read_rtf(&self, item: &BinderItem, name3: &str, name2: &str) -> String {
        std::fs::read(self.file(item, name3, name2)).map(|b| rtf_to_md(&String::from_utf8_lossy(&b))).unwrap_or_default()
    }
    fn node(&self, item: &BinderItem, warnings: &mut Vec<String>) -> Option<ImpNode> {
        let body = self.read_rtf(item, "content.rtf", "{}.rtf");
        let synopsis = std::fs::read_to_string(self.file(item, "synopsis.txt", "{}_synopsis.txt")).unwrap_or_default().trim().to_string();
        let notes = self.read_rtf(item, "notes.rtf", "{}_notes.rtf");
        let title = if item.title.trim().is_empty() { "Sin título".to_string() } else { item.title.trim().to_string() };
        match item.kind.as_str() {
            "PDF" | "Image" => {
                let dir = if self.v3 { self.root.join("Files").join("Data").join(&item.uuid) } else { self.root.join("Files").join("Docs") };
                let found = std::fs::read_dir(&dir).ok()?.flatten().map(|e| e.path()).find(|p| {
                    let n = p.file_name().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
                    (self.v3 && n.starts_with("content.") && !n.ends_with(".rtf")) || (!self.v3 && n.starts_with(&format!("{}.", item.id)))
                });
                match found {
                    Some(src) => Some(ImpNode { kind: "file".into(), title, src: src.display().to_string(), ..Default::default() }),
                    None => {
                        warnings.push(format!("No se encontró el archivo de «{title}»."));
                        None
                    }
                }
            }
            "WebArchive" => {
                warnings.push(format!("«{title}» es un archivo web de Scrivener y no se importa."));
                None
            }
            _ => {
                let mut children: Vec<ImpNode> = item.children.iter().filter_map(|c| self.node(c, warnings)).collect();
                let is_folder = !item.children.is_empty() || item.kind.contains("Folder");
                if is_folder {
                    // Una carpeta con texto propio: el texto va como primer hijo.
                    if !body.trim().is_empty() {
                        let mut t = text(&title, body);
                        t.include = item.include;
                        children.insert(0, t);
                    }
                    Some(ImpNode { kind: "folder".into(), title, synopsis, notes, include: item.include, children, ..Default::default() })
                } else {
                    Some(ImpNode { kind: "text".into(), title, body, synopsis, notes, include: item.include, ..Default::default() })
                }
            }
        }
    }
}

fn import_scrivener(path: &Path) -> Result<Imported, String> {
    let (root, scrivx) = if path.is_dir() {
        let x = std::fs::read_dir(path)
            .map_err(|e| e.to_string())?
            .flatten()
            .map(|e| e.path())
            .find(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("scrivx")))
            .ok_or("Esa carpeta no es un proyecto de Scrivener (falta el .scrivx).")?;
        (path.to_path_buf(), x)
    } else {
        (path.parent().ok_or("Ruta no válida")?.to_path_buf(), path.to_path_buf())
    };
    let xml = std::fs::read_to_string(&scrivx).map_err(|e| format!("No se puede leer {}: {e}", scrivx.display()))?;
    let binder = parse_binder(&xml);
    let s = Scriv { v3: root.join("Files").join("Data").is_dir(), root: root.clone() };
    let mut out = Imported { title: scrivx.file_stem().map(|x| x.to_string_lossy().to_string()).unwrap_or_default(), ..Default::default() };
    let mut warnings = Vec::new();
    for item in &binder {
        let kids: Vec<ImpNode> = item.children.iter().filter_map(|c| s.node(c, &mut warnings)).collect();
        match item.kind.as_str() {
            "DraftFolder" => out.manuscript.extend(kids),
            "ResearchFolder" => out.research.extend(kids),
            "TrashFolder" => {}
            _ => {
                if let Some(n) = s.node(item, &mut warnings) {
                    out.notes.push(n);
                }
            }
        }
    }
    out.warnings = warnings;
    Ok(out)
}

// ---------------- Manuskript ----------------

fn msk_files(path: &Path) -> Result<BTreeMap<String, String>, String> {
    let mut out = BTreeMap::new();
    if path.is_dir() {
        fn walk(base: &Path, dir: &Path, out: &mut BTreeMap<String, String>) {
            if let Ok(rd) = std::fs::read_dir(dir) {
                for e in rd.flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        walk(base, &p, out);
                    } else if let (Ok(rel), Ok(t)) = (p.strip_prefix(base), std::fs::read_to_string(&p)) {
                        out.insert(rel.to_string_lossy().replace('\\', "/"), t);
                    }
                }
            }
        }
        walk(path, path, &mut out);
        return Ok(out);
    }
    let bytes = std::fs::read(path).map_err(|e| format!("No se puede leer el archivo: {e}"))?;
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|_| "Este .msk no está comprimido: abre la carpeta del proyecto de Manuskript en su lugar.".to_string())?;
    for i in 0..z.len() {
        let mut f = z.by_index(i).map_err(|e| e.to_string())?;
        if f.is_dir() {
            continue;
        }
        let name = f.name().to_string();
        let mut s = String::new();
        if f.read_to_string(&mut s).is_ok() {
            out.insert(name, s);
        }
    }
    Ok(out)
}

/// Cabecera "clave: valor" hasta la primera línea vacía, y el resto.
/// Las líneas que empiezan por espacio continúan el valor anterior.
fn msk_header(text: &str) -> (BTreeMap<String, String>, String) {
    let mut map: BTreeMap<String, String> = BTreeMap::new();
    let mut last: Option<String> = None;
    let mut consumed = 0;
    for line in text.split_inclusive('\n') {
        consumed += line.len();
        let line = line.trim_end_matches(['\r', '\n']);
        if line.trim().is_empty() {
            break;
        }
        let continuation = line.starts_with(' ') || line.starts_with('\t');
        match line.split_once(':') {
            Some((k, v)) if !continuation && !k.is_empty() && k.len() <= 30 && k.chars().all(|c| c.is_alphanumeric() || c == ' ' || c == '_') => {
                map.insert(k.trim().to_string(), v.trim().to_string());
                last = Some(k.trim().to_string());
            }
            _ => {
                if let Some(l) = &last {
                    if let Some(x) = map.get_mut(l) {
                        x.push('\n');
                        x.push_str(line.trim());
                    }
                }
            }
        }
    }
    (map, text.get(consumed.min(text.len())..).unwrap_or("").to_string())
}

fn strip_order(name: &str) -> String {
    let n = name.trim_end_matches(".md").trim_end_matches(".txt");
    match n.split_once('-') {
        Some((num, rest)) if num.chars().all(|c| c.is_ascii_digit()) => rest.to_string(),
        _ => n.to_string(),
    }
}

fn order_of(name: &str) -> u32 {
    name.split('-').next().and_then(|n| n.parse().ok()).unwrap_or(u32::MAX)
}

fn import_manuskript(path: &Path) -> Result<Imported, String> {
    let files = msk_files(path)?;
    let mut out = Imported::default();
    if let Some(infos) = files.get("infos.txt") {
        let (h, _) = msk_header(infos);
        out.title = h.get("Title").cloned().unwrap_or_default();
        out.author = h.get("Author").cloned().unwrap_or_default();
    }
    if out.title.is_empty() {
        out.title = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    }

    // Árbol del esquema a partir de las rutas de outline/.
    fn build(files: &BTreeMap<String, String>, prefix: &str) -> Vec<ImpNode> {
        let mut entries: Vec<(String, bool)> = Vec::new();
        for k in files.keys() {
            if let Some(rest) = k.strip_prefix(prefix) {
                let first = rest.split('/').next().unwrap_or("");
                let is_dir = rest.contains('/');
                if first.is_empty() || first == "folder.txt" {
                    continue;
                }
                if !entries.iter().any(|(n, _)| n == first) {
                    entries.push((first.to_string(), is_dir));
                }
            }
        }
        entries.sort_by_key(|(n, _)| (order_of(n), n.clone()));
        entries
            .into_iter()
            .map(|(name, is_dir)| {
                if is_dir {
                    let sub = format!("{prefix}{name}/");
                    let (h, _) = files.get(&format!("{sub}folder.txt")).map(|t| msk_header(t)).unwrap_or_default();
                    let mut f = folder(&h.get("title").cloned().unwrap_or_else(|| strip_order(&name)), build(files, &sub));
                    f.synopsis = h.get("summarySentence").or(h.get("summaryFull")).cloned().unwrap_or_default();
                    f.include = h.get("compile").map(|c| c != "0").unwrap_or(true);
                    f
                } else {
                    let raw = files.get(&format!("{prefix}{name}")).cloned().unwrap_or_default();
                    let (h, body) = msk_header(&raw);
                    let mut t = text(&h.get("title").cloned().unwrap_or_else(|| strip_order(&name)), body.trim().to_string());
                    t.synopsis = h.get("summarySentence").or(h.get("summaryFull")).cloned().unwrap_or_default();
                    t.notes = h.get("notes").cloned().unwrap_or_default();
                    t.include = h.get("compile").map(|c| c != "0").unwrap_or(true);
                    t
                }
            })
            .collect()
    }
    out.manuscript = build(&files, "outline/");

    for (k, v) in &files {
        if k.starts_with("characters/") && k.ends_with(".txt") {
            let (h, _) = msk_header(v);
            let name = h.get("Name").cloned().unwrap_or_else(|| strip_order(k.trim_start_matches("characters/")));
            let mut fields = Vec::new();
            for (key, label) in [("Motivation", "Motivación"), ("Goal", "Objetivo"), ("Conflict", "Conflicto"), ("Epiphany", "Epifanía")] {
                if let Some(v) = h.get(key).filter(|v| !v.is_empty()) {
                    fields.push((label.to_string(), v.clone()));
                }
            }
            let description = [h.get("Phrase Summary"), h.get("Paragraph Summary"), h.get("Full Summary"), h.get("Notes")]
                .into_iter()
                .flatten()
                .filter(|s| !s.is_empty())
                .cloned()
                .collect::<Vec<_>>()
                .join("\n\n");
            out.codex.push(ImpCodex { kind: "character".into(), name, description, fields });
        }
    }
    if let Some(summary) = files.get("summary.txt") {
        let (h, _) = msk_header(summary);
        let full = h.get("Full").or(h.get("Page")).or(h.get("Paragraph")).or(h.get("Sentence")).cloned().unwrap_or_default();
        if !full.is_empty() {
            out.notes.push(text("Resumen (Manuskript)", full));
        }
    }
    Ok(out)
}

// ---------------- Carpeta de Markdown ----------------

fn import_markdown_dir(path: &Path) -> Result<Imported, String> {
    fn walk(dir: &Path) -> Vec<ImpNode> {
        let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
        let mut entries: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'))).collect();
        entries.sort_by_key(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default());
        let mut out = Vec::new();
        for p in entries {
            let name = p.file_stem().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if p.is_dir() {
                let kids = walk(&p);
                if !kids.is_empty() {
                    out.push(folder(&name, kids));
                }
            } else if p.extension().is_some_and(|e| matches!(e.to_string_lossy().to_lowercase().as_str(), "md" | "markdown" | "txt")) {
                let raw = std::fs::read_to_string(&p).unwrap_or_default();
                let body = crate::project::strip_front_matter(&raw).trim().to_string();
                let title = raw
                    .strip_prefix("---")
                    .and_then(|r| r.lines().find_map(|l| l.strip_prefix("title:")))
                    .map(|t| t.trim().trim_matches('"').to_string())
                    .filter(|t| !t.is_empty())
                    .unwrap_or(name);
                out.push(text(&title, body));
            }
        }
        out
    }
    if !path.is_dir() {
        return Err("Elige una carpeta con archivos .md o .txt.".into());
    }
    Ok(Imported { title: path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(), manuscript: walk(path), ..Default::default() })
}

#[tauri::command]
pub async fn import_project(kind: String, path: String) -> Result<Imported, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        match kind.as_str() {
            "scrivener" => import_scrivener(&p),
            "manuskript" => import_manuskript(&p),
            "docx" => import_docx(&p),
            "markdown" => import_markdown_dir(&p),
            _ => Err(format!("Formato desconocido: {kind}")),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Solo los comentarios y el texto de un .docx (para traer la revisión de un lector beta).
#[tauri::command]
pub async fn docx_review(path: String) -> Result<Imported, String> {
    tauri::async_runtime::spawn_blocking(move || import_docx(Path::new(&path))).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn seg(t: &str) -> Seg {
        Seg { text: t.into(), ..Default::default() }
    }

    #[test]
    fn segments_to_markdown() {
        let segs = vec![
            seg("Dijo "),
            Seg { text: "muy ".into(), i: true, ..Default::default() },
            Seg { text: "bajo ".into(), i: true, ..Default::default() },
            Seg { text: "que no".into(), b: true, comment: Some("w1".into()), ..Default::default() },
            Seg { text: " y *esto*".into(), ins: true, ..Default::default() },
        ];
        assert_eq!(segs_to_md(&segs), "Dijo *muy bajo* {{c:w1}}**que no**{{/c}} {++y \\*esto\\*++}");
        assert_eq!(segs_to_md(&[seg("# no es título")]), "\\# no es título");
        assert_eq!(segs_to_md(&[seg("* * *")]), "* * *");
    }

    fn docx(document: &str, comments: Option<&str>) -> Vec<u8> {
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            let o = zip::write::SimpleFileOptions::default();
            z.start_file("word/document.xml", o).unwrap();
            z.write_all(document.as_bytes()).unwrap();
            if let Some(c) = comments {
                z.start_file("word/comments.xml", o).unwrap();
                z.write_all(c.as_bytes()).unwrap();
            }
            z.finish().unwrap();
        }
        buf.into_inner()
    }

    #[test]
    fn reads_word_with_headings_comments_and_changes() {
        let doc = r#"<w:document xmlns:w="w"><w:body>
<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r><w:t>La casa del faro</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Capítulo 1</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">La marea </w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>había</w:t></w:r><w:r><w:t xml:space="preserve"> subido &amp; </w:t></w:r><w:commentRangeStart w:id="3"/><w:r><w:t>Elena</w:t></w:r><w:commentRangeEnd w:id="3"/><w:del w:author="Marta"><w:r><w:delText> sola</w:delText></w:r></w:del><w:ins w:author="Marta"><w:r><w:t> despacio</w:t></w:r></w:ins></w:p>
<w:p><w:r><w:t>***</w:t></w:r></w:p>
<w:p><w:pPr><w:pStyle w:val="Ttulo1"/></w:pPr><w:r><w:t>Capítulo 2</w:t></w:r></w:p>
<w:p><w:r><w:t>Fin.</w:t></w:r><w:r><w:br/><w:t>Otra línea</w:t></w:r></w:p>
</w:body></w:document>"#;
        let comments = r#"<w:comments xmlns:w="w"><w:comment w:id="3" w:author="Lucía" w:date="2026-10-01T10:00:00Z"><w:p><w:r><w:t>¿Quién es?</w:t></w:r></w:p></w:comment></w:comments>"#;
        let (paras, cs) = docx_paragraphs(docx(doc, Some(comments))).unwrap();
        assert_eq!(cs.len(), 1);
        assert_eq!(cs[0].author, "Lucía");
        assert_eq!(cs[0].text, "¿Quién es?");
        let (title, tree) = paras_to_tree(paras, "doc", &cs);
        assert_eq!(title, "La casa del faro");
        assert_eq!(tree.len(), 2);
        assert_eq!(tree[0].title, "Capítulo 1");
        assert_eq!(tree[0].body, "La marea *había* subido & {{c:w3}}Elena{{/c}} {--sola--} {++despacio++}\n\n* * *");
        assert_eq!(tree[0].comments.len(), 1);
        assert_eq!(tree[1].body, "Fin.\\\nOtra línea");
    }

    #[test]
    fn reads_rtf() {
        let rtf = r"{\rtf1\ansi\ansicpg1252{\fonttbl{\f0 Times;}}{\*\expandedcolortbl;;}\f0 La marea hab\'eda subido, {\i dijo} \b Elena\b0 .\par
\'abNo puede ser\'bb \u8212? contest\'f3.\par}";
        assert_eq!(rtf_to_md(rtf), "La marea había subido, *dijo* **Elena**.\n\n«No puede ser» — contestó.");
    }

    #[test]
    fn reads_scrivener_3_project() {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("Faro.scriv");
        std::fs::create_dir_all(root.join("Files/Data/AAA")).unwrap();
        std::fs::create_dir_all(root.join("Files/Data/BBB")).unwrap();
        std::fs::write(root.join("Files/Data/AAA/content.rtf"), r"{\rtf1 Primera escena.\par}").unwrap();
        std::fs::write(root.join("Files/Data/AAA/synopsis.txt"), "Llega Elena.").unwrap();
        std::fs::write(root.join("Files/Data/BBB/content.pdf"), "%PDF").unwrap();
        std::fs::write(
            root.join("Faro.scrivx"),
            r#"<ScrivenerProject><Binder>
<BinderItem UUID="D" Type="DraftFolder"><Title>Manuscrito</Title><Children>
  <BinderItem UUID="C1" Type="Folder"><Title>Capítulo 1</Title><Children>
    <BinderItem UUID="AAA" Type="Text"><Title>Llegada</Title><MetaData><IncludeInCompile>Yes</IncludeInCompile></MetaData></BinderItem>
  </Children></BinderItem>
</Children></BinderItem>
<BinderItem UUID="R" Type="ResearchFolder"><Title>Investigación</Title><Children>
  <BinderItem UUID="BBB" Type="PDF"><Title>Faros</Title></BinderItem>
</Children></BinderItem>
<BinderItem UUID="T" Type="TrashFolder"><Title>Papelera</Title></BinderItem>
</Binder></ScrivenerProject>"#,
        )
        .unwrap();
        let p = import_scrivener(&root).unwrap();
        assert_eq!(p.title, "Faro");
        assert_eq!(p.manuscript[0].kind, "folder");
        let scene = &p.manuscript[0].children[0];
        assert_eq!((scene.title.as_str(), scene.body.as_str(), scene.synopsis.as_str()), ("Llegada", "Primera escena.", "Llega Elena."));
        assert_eq!(p.research[0].kind, "file");
        assert!(p.research[0].src.ends_with("content.pdf"));
    }

    #[test]
    fn reads_manuskript_folder() {
        let t = tempfile::tempdir().unwrap();
        let r = t.path();
        std::fs::create_dir_all(r.join("outline/0-Parte uno")).unwrap();
        std::fs::create_dir_all(r.join("characters")).unwrap();
        std::fs::write(r.join("infos.txt"), "Title: El faro\nAuthor: Ana\n").unwrap();
        std::fs::write(r.join("outline/0-Parte uno/folder.txt"), "title: Parte uno\nID: 1\ntype: folder\n\n").unwrap();
        std::fs::write(r.join("outline/0-Parte uno/1-Escena dos.md"), "title: Escena dos\nID: 3\ntype: md\ncompile: 2\n\nTexto dos.").unwrap();
        std::fs::write(r.join("outline/0-Parte uno/0-Escena uno.md"), "title: Escena uno\nID: 2\ntype: md\nsummarySentence: Empieza.\ncompile: 0\n\nTexto uno.").unwrap();
        std::fs::write(r.join("characters/0-Elena.txt"), "Name: Elena\nID: 0\nMotivation: Saber la verdad\nPhrase Summary: Hija del farero\n").unwrap();
        let p = import_manuskript(r).unwrap();
        assert_eq!((p.title.as_str(), p.author.as_str()), ("El faro", "Ana"));
        let part = &p.manuscript[0];
        assert_eq!(part.title, "Parte uno");
        assert_eq!(part.children.iter().map(|c| c.title.as_str()).collect::<Vec<_>>(), ["Escena uno", "Escena dos"]);
        assert!(!part.children[0].include);
        assert_eq!(part.children[0].synopsis, "Empieza.");
        assert_eq!(p.codex[0].name, "Elena");
        assert_eq!(p.codex[0].fields[0], ("Motivación".to_string(), "Saber la verdad".to_string()));
    }
}
