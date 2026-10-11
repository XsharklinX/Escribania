/**
 * Edición para lectores beta: un único .html que se abre en cualquier
 * navegador, sin cuentas ni servidores. El lector subraya y comenta; sus notas
 * se guardan en su navegador y, al terminar, descarga un archivo .json que el
 * autor importa: cada nota entra en Marginalia, anclada a su frase.
 */
import type { Comment, Manifest } from "../types";
import type { Piece } from "./compile";
import { escapeInline, markdownToHtml } from "./markdown";
import { newId } from "./ids";

export interface BetaNote {
  scene: string;
  quote: string;
  comment: string;
  created: string;
}

export interface BetaFile {
  app: "escribania-beta";
  project: string;
  title: string;
  reader: string;
  notes: BetaNote[];
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface BetaLabels {
  intro: string;
  name: string;
  namePh: string;
  comment: string;
  save: string;
  cancel: string;
  download: string;
  notes: string;
  empty: string;
  remove: string;
  placeholder: string;
  saved: string;
}

/** La página completa, con el libro y el pequeño programa que guarda las notas. */
export function betaHtml(m: Manifest, pieces: Piece[], lang: string, l: BetaLabels): string {
  const body: string[] = [];
  for (const p of pieces) {
    if (p.kind === "heading") body.push(`<h2>${escHtml(p.text)}</h2>`);
    else if (p.kind === "break") body.push(`<p class="sep">* * *</p>`);
    else body.push(`<section data-scene="${escHtml(p.id ?? "")}">${markdownToHtml(p.md)}</section>`);
  }
  const data = { project: m.id, title: m.title, l };
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(m.title)} · beta</title>
<style>
:root{--acc:#3350d1;--ink:#222;--sub:#6b7180;--bg:#fdfcf8;--line:#e3e0d6}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:1.1rem/1.75 Georgia,"Times New Roman",serif}
main{max-width:38em;margin:0 auto;padding:2em 1.2em 6em}
header.top{position:sticky;top:0;z-index:5;background:rgba(253,252,248,.95);backdrop-filter:blur(6px);border-bottom:1px solid var(--line);font:14px/1.4 system-ui,sans-serif;padding:.6em 1em;display:flex;gap:.8em;align-items:center;flex-wrap:wrap}
header.top b{font-family:Georgia,serif;font-size:16px;flex:1}
header.top input{font:inherit;padding:.35em .6em;border:1px solid var(--line);border-radius:6px}
button{font:14px system-ui,sans-serif;cursor:pointer;border-radius:7px;border:1px solid var(--line);background:#fff;padding:.4em .8em}
button.p{background:var(--acc);border-color:var(--acc);color:#fff}
h1{text-align:center;font-weight:normal;font-size:2.2em;margin:1.2em 0 .2em}.by{text-align:center;color:var(--sub);margin-bottom:3em}
h2{text-align:center;font-weight:normal;margin:3em 0 1.2em}p{margin:0;text-indent:1.4em}h2+section p:first-child,.sep+section p:first-child{text-indent:0}.sep{text-align:center;text-indent:0;margin:1.2em 0}
mark{background:#fff0a8;cursor:pointer;border-radius:2px}
.intro{font:14px/1.5 system-ui,sans-serif;color:var(--sub);background:#fff;border:1px solid var(--line);border-radius:10px;padding:.8em 1em;margin:1em 0 2em}
#bubble{position:absolute;display:none;z-index:9}
#box{position:fixed;inset:auto 1em 1em auto;width:min(360px,calc(100% - 2em));background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 18px 40px rgba(0,0,0,.18);padding:.9em;font:14px/1.45 system-ui,sans-serif;display:none;z-index:10}
#box q{display:block;color:var(--sub);font-style:italic;margin-bottom:.5em;max-height:5em;overflow:auto}
#box textarea{width:100%;min-height:6em;font:inherit;padding:.5em;border:1px solid var(--line);border-radius:8px}
#box .row{display:flex;gap:.5em;justify-content:flex-end;margin-top:.5em}
#list{font:14px/1.45 system-ui,sans-serif;margin-top:4em;border-top:1px solid var(--line);padding-top:1em}
#list li{margin-bottom:.6em}#list q{color:var(--sub)}
</style></head><body>
<header class="top"><b>${escHtml(m.title)}</b><label>${escHtml(l.name)} <input id="reader" placeholder="${escHtml(l.namePh)}"></label><span id="count"></span><button class="p" id="dl">${escHtml(l.download)}</button></header>
<main>
<h1>${escHtml(m.title)}</h1><div class="by">${escHtml(m.author)}</div>
<div class="intro">${escHtml(l.intro)}</div>
<article id="book">
${body.join("\n")}
</article>
<div id="list"><h3>${escHtml(l.notes)}</h3><ol id="notes"></ol></div>
</main>
<button id="bubble" class="p">${escHtml(l.comment)}</button>
<div id="box"><q id="quote"></q><textarea id="text" placeholder="${escHtml(l.placeholder)}"></textarea><div class="row"><button id="cancel">${escHtml(l.cancel)}</button><button class="p" id="save">${escHtml(l.save)}</button></div></div>
<script>
(function(){
var D=${JSON.stringify(data).replace(/</g, "\\u003c")};
var KEY="escribania-beta-"+D.project;
var st={reader:"",notes:[]};
try{var s=JSON.parse(localStorage.getItem(KEY)||"null");if(s&&s.notes)st=s}catch(e){}
var $=function(id){return document.getElementById(id)};
function persist(){try{localStorage.setItem(KEY,JSON.stringify(st))}catch(e){}render()}
$("reader").value=st.reader||"";$("reader").oninput=function(){st.reader=this.value;persist()};
var sel=null;
function sceneOf(node){while(node&&node!==document.body){if(node.dataset&&node.dataset.scene!==undefined)return node.dataset.scene;node=node.parentNode}return null}
document.addEventListener("mouseup",function(e){
  if(e.target.closest&&(e.target.closest("#box")||e.target.closest("#bubble")))return;
  var s=window.getSelection();var q=s?String(s).trim():"";
  if(!q||q.length<2){$("bubble").style.display="none";return}
  var scene=sceneOf(s.anchorNode);if(scene===null)return;
  var r=s.getRangeAt(0).getBoundingClientRect();
  sel={scene:scene,quote:q.replace(/\\s+/g," ").slice(0,600)};
  var b=$("bubble");b.style.display="block";b.style.left=(window.scrollX+r.left+r.width/2-40)+"px";b.style.top=(window.scrollY+r.top-42)+"px";
});
$("bubble").onclick=function(){if(!sel)return;$("bubble").style.display="none";$("quote").textContent=sel.quote;$("text").value="";$("box").style.display="block";$("text").focus()};
$("cancel").onclick=function(){$("box").style.display="none"};
$("save").onclick=function(){var t=$("text").value.trim();if(!sel)return;st.notes.push({scene:sel.scene,quote:sel.quote,comment:t,created:new Date().toISOString()});$("box").style.display="none";window.getSelection().removeAllRanges();persist()};
function markAll(){
  document.querySelectorAll("mark").forEach(function(m){m.replaceWith(document.createTextNode(m.textContent))});
  document.querySelectorAll("#book section").forEach(function(s){s.normalize()});
  st.notes.forEach(function(n,i){
    var sec=document.querySelector('#book section[data-scene="'+CSS.escape(n.scene)+'"]');if(!sec)return;
    var w=document.createTreeWalker(sec,NodeFilter.SHOW_TEXT);var t;
    while((t=w.nextNode())){var k=t.data.indexOf(n.quote);if(k<0)continue;var r=document.createRange();r.setStart(t,k);r.setEnd(t,k+n.quote.length);var m=document.createElement("mark");m.title=n.comment;m.dataset.i=i;r.surroundContents(m);break}
  });
}
function render(){
  markAll();
  $("count").textContent=st.notes.length?st.notes.length+" ✎":"";
  var ol=$("notes");ol.innerHTML="";
  if(!st.notes.length){var li=document.createElement("li");li.textContent=D.l.empty;ol.appendChild(li)}
  st.notes.forEach(function(n,i){var li=document.createElement("li");var q=document.createElement("q");q.textContent=n.quote;li.appendChild(q);li.appendChild(document.createTextNode(" — "+n.comment+" "));var b=document.createElement("button");b.textContent=D.l.remove;b.onclick=function(){st.notes.splice(i,1);persist()};li.appendChild(b);ol.appendChild(li)});
}
$("dl").onclick=function(){
  var out={app:"escribania-beta",project:D.project,title:D.title,reader:st.reader||"",notes:st.notes};
  var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:"application/json"}));
  a.download=(D.title+" - "+(st.reader||"notas")).replace(/[\\\\/:*?"<>|]+/g," ")+".json";a.click();
  alert(D.l.saved);
};
render();
})();
</script>
</body></html>
`;
}

export function parseBetaFile(text: string): BetaFile {
  const raw = JSON.parse(text) as BetaFile;
  if (raw.app !== "escribania-beta" || !Array.isArray(raw.notes)) throw new Error("not a beta file");
  return raw;
}

/**
 * Ancla una nota en el Markdown de una escena: rodea la frase citada con la
 * marca de comentario. Si la frase ya no está tal cual (el texto ha cambiado),
 * se ancla a la primera palabra y la cita va dentro del comentario.
 */
export function anchorNote(md: string, note: BetaNote, author: string): { md: string; comment: Comment; exact: boolean } {
  const id = newId();
  const comment: Comment = { id, text: note.comment, author, created: note.created || new Date().toISOString(), resolved: false };
  const candidates = [note.quote, escapeInline(note.quote)];
  for (const q of candidates) {
    const at = md.indexOf(q);
    if (q && at >= 0) return { md: md.slice(0, at) + `{{c:${id}}}` + q + "{{/c}}" + md.slice(at + q.length), comment, exact: true };
  }
  const word = /[\p{L}\p{N}]+/u.exec(md);
  comment.text = `«${note.quote}» — ${note.comment}`;
  if (!word) return { md: `{{c:${id}}}·{{/c}} ` + md, comment, exact: false };
  return { md: md.slice(0, word.index) + `{{c:${id}}}` + word[0] + "{{/c}}" + md.slice(word.index + word[0].length), comment, exact: false };
}
