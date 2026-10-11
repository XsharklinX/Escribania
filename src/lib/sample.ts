/**
 * Proyecto de ejemplo: «La casa del faro», una novela corta a medio escribir
 * que enseña de un vistazo lo que hace la app (Códice, Cronos, subtramas,
 * etiquetas, un comentario, un pendiente…). Se crea en la carpeta de
 * proyectos la primera vez y después solo se abre.
 */
import { documentDir, join } from "@tauri-apps/api/path";
import { useStore } from "../store";
import type { CodexEntry, Manifest, TreeNode } from "../types";
import { api, type NewText } from "./api";
import { buildProject } from "./templates";
import { newId } from "./ids";
import { openProject } from "./projects";

const TITLE = "La casa del faro";

const SCENES: { part: number; chapter: string; title: string; pov: string; day: string; t: number; tension: number; status: TreeNode["status"]; synopsis: string; tags?: string[]; body: string }[] = [
  {
    part: 0,
    chapter: "1. El faro apagado",
    title: "Llegada",
    pov: "elena",
    day: "Día 1",
    t: 0,
    tension: 3,
    status: "final",
    synopsis: "Elena vuelve a Arenales once años después del naufragio.",
    body: "La marea había subido antes de lo previsto, y con ella llegó el olor a gasoil y a algas que Elena asociaba, sin saber muy bien por qué, a las mañanas de su infancia. Desde la carretera se veía el faro de Punta Gris, apagado, con la linterna cubierta de salitre.\n\nAparcó junto a la lonja. Nadie salió a recibirla, y lo agradeció.\n\n—Has tardado —dijo Amparo desde la puerta de su casa, como si se hubieran visto la semana anterior.\n\n—Once años —contestó Elena.\n\n—Pues eso. Has tardado.",
  },
  {
    part: 0,
    chapter: "1. El faro apagado",
    title: "La casa cerrada",
    pov: "elena",
    day: "Día 1",
    t: 0,
    tension: 4,
    status: "revised",
    synopsis: "La llave no entra: alguien ha cambiado la cerradura.",
    tags: ["misterio"],
    body: "La llave de su padre no entraba. Elena lo intentó tres veces, con la torpeza de quien no quiere entender lo que está pasando, hasta que vio el brillo del bombín nuevo.\n\nAlguien había cambiado la cerradura de la casa del faro. Alguien que tenía motivos para entrar, o para que ella no entrara.\n\nREVISAR: ¿Elena llama a Tomás aquí o en la escena siguiente?",
  },
  {
    part: 0,
    chapter: "2. La lonja",
    title: "Ferrer",
    pov: "tomas",
    day: "Día 2",
    t: 1,
    tension: 5,
    status: "revised",
    synopsis: "Tomás y la deuda con el patrón Ferrer.",
    body: "Tomás contó las cajas dos veces antes de firmar el albarán. Ferrer lo miraba desde la puerta del almacén con las manos en los bolsillos del chaquetón.\n\n—Sigues debiéndome el mes de agosto —dijo Ferrer.\n\n—Y tú sigues sin decirme qué llevaba el Brisa aquella noche.\n\nFerrer sonrió sin ganas y se fue sin contestar.",
  },
  {
    part: 0,
    chapter: "3. La carta",
    title: "Galería del faro",
    pov: "elena",
    day: "Día 3",
    t: 2,
    tension: 6,
    status: "revised",
    synopsis: "Elena sube al faro por primera vez desde el naufragio.",
    tags: ["recuerdo"],
    body: "Desde la galería del faro se veía el puerto entero: las barcas varadas, la lonja con los cierres a medio bajar, la furgoneta de Tomás aparcada en doble fila, como siempre.\n\nElena se apoyó en la barandilla. Tenía los ojos verdes de su padre, le decían en el pueblo, y ahora entendía por qué nadie la miraba mucho rato.",
  },
  {
    part: 0,
    chapter: "3. La carta",
    title: "El sobre",
    pov: "elena",
    day: "Día 3",
    t: 2,
    tension: 8,
    status: "draft",
    synopsis: "Una carta con la letra de su padre, muerto hace once años.",
    tags: ["misterio", "giro"],
    body: "Abrió el sobre con el pulgar. Dentro solo había {{c:cm1}}una hoja doblada en tres y una fotografía{{/c}} en la que alguien había tachado una cara con bolígrafo azul.\n\n—No puede ser —dijo en voz alta, aunque no había nadie para oírla.\n\nLa letra era la de su padre. Y su padre llevaba once años muerto. [TODO: decidir de quién es la cara tachada]",
  },
  {
    part: 0,
    chapter: "4. Bajamar",
    title: "El espigón",
    pov: "amparo",
    day: "Día 4",
    t: 3,
    tension: 5,
    status: "idea",
    synopsis: "Amparo baja al espigón de noche con algo envuelto en un trapo.",
    body: "",
  },
  {
    part: 1,
    chapter: "5. El diario",
    title: "Diario de a bordo",
    pov: "elena",
    day: "Día 6",
    t: 5,
    tension: 7,
    status: "idea",
    synopsis: "El diario del Brisa aparece en el desván de Amparo.",
    body: "",
  },
];

const PEOPLE: { id: string; name: string; color: string; aliases: string[]; fields: [string, string][]; desc: string; kind?: CodexEntry["kind"] }[] = [
  { id: "elena", name: "Elena Ruiz", color: "#3B6FD8", aliases: ["Elena"], fields: [["Edad", "34"], ["Ojos", "verdes"], ["Rol", "Protagonista"], ["Quiere", "Saber qué pasó la noche del Brisa"]], desc: "Hija del farero. Se fue a Madrid a los veintitrés y no volvió." },
  { id: "tomas", name: "Tomás Vidal", color: "#D2803A", aliases: ["Tomás"], fields: [["Edad", "36"], ["Rol", "Pescador, expareja de Elena"]], desc: "Se quedó en Arenales. Debe dinero a Ferrer." },
  { id: "amparo", name: "Amparo Lema", color: "#8C4FC2", aliases: ["Amparo"], fields: [["Edad", "78"], ["Secreto", "Guardó el diario del Brisa"]], desc: "Vecina del espigón. Lo sabe todo y casi nunca lo dice." },
  { id: "ignacio", name: "Ignacio Ruiz", color: "#2E9A73", aliases: [], fields: [["Rol", "Farero, padre de Elena (†)"]], desc: "Desapareció la noche del naufragio del Brisa." },
  { id: "arenales", name: "Arenales", color: "#6B7180", aliases: [], fields: [["Tipo", "Pueblo de pescadores"]], desc: "Puerto pequeño del Cantábrico.", kind: "place" },
  { id: "faro", name: "Faro de Punta Gris", color: "#C2416B", aliases: ["el faro"], fields: [], desc: "Apagado desde 2015.", kind: "place" },
];

export function sampleProject(author: string): { manifest: Manifest; texts: NewText[] } {
  const base = buildProject("novel", "es", TITLE, author);
  const m = base.manifest;
  // Del proyecto base solo se queda la nota de ideas; el manuscrito es el del ejemplo.
  const texts: NewText[] = base.texts.filter((x) => m.sections.notes.some((n) => n.file === x.file));
  const parts: TreeNode[] = ["Parte I · La marea", "Parte II · El naufragio"].map((title) => ({ id: newId(), type: "folder", title, status: "draft", include: true, synopsis: "", notes: "", target: 0, open: true, children: [] }));
  const chapters = new Map<string, TreeNode>();
  for (const s of SCENES) {
    let ch = chapters.get(s.chapter);
    if (!ch) {
      ch = { id: newId(), type: "folder", title: s.chapter, status: "draft", include: true, synopsis: "", notes: "", target: 0, open: s.part === 0, children: [] };
      chapters.set(s.chapter, ch);
      parts[s.part].children!.push(ch);
    }
    const id = newId();
    const file = `texto/${s.title.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-")}-${id.slice(0, 4)}.md`;
    const node: TreeNode = { id, type: "text", title: s.title, file, status: s.status, include: true, synopsis: s.synopsis, notes: "", target: 1200, pov: s.pov, day: s.day, t: s.t, tension: s.tension, place: s.pov === "tomas" ? "arenales" : "faro", tags: s.tags };
    if (s.body.includes("{{c:cm1}}")) node.comments = [{ id: "cm1", text: "¿Mejor dos fotografías? Así Tomás puede quedarse una.", author: "Lucía (lectora beta)", created: new Date().toISOString(), resolved: false }];
    ch.children!.push(node);
    texts.push({ id, file, title: s.title, body: s.body });
  }
  m.sections.manuscript = parts;
  m.target = { words: 60000, deadline: `${new Date().getFullYear() + 1}-03-31`, restDays: [0] };
  m.codex = PEOPLE.map((p) => {
    const file = `codice/${p.id}.md`;
    texts.push({ id: p.id, file, title: p.name, body: p.desc });
    return { id: p.id, kind: p.kind ?? "character", name: p.name, aliases: p.aliases, color: p.color, file, fields: p.fields.map(([k, v]) => ({ k, v })), mentions: true };
  });
  m.relations = [
    { id: newId(), from: "ignacio", to: "elena", label: "padre", kind: "parent" },
    { id: newId(), from: "tomas", to: "elena", label: "expareja", kind: "other" },
    { id: newId(), from: "amparo", to: "ignacio", label: "guarda su secreto", kind: "other" },
  ];
  m.plotlines = [
    { id: "p1", name: "El naufragio", color: "#3B6FD8" },
    { id: "p2", name: "Elena y Tomás", color: "#D2803A" },
  ];
  m.events = [{ id: newId(), title: "Naufragio del Brisa (hace 11 años)", t: 0, span: 1, lane: "", color: "#C2416B", note: "" }];
  const today = new Date();
  const inDays = (n: number) => new Date(today.getTime() + n * 86400000).toISOString().slice(0, 10);
  m.agenda = [
    { id: newId(), date: inDays(10), title: "Terminar la Parte I", kind: "deadline", done: false },
    { id: newId(), date: inDays(24), title: "Enviar a Lucía y Marcos", kind: "beta", done: false },
  ];
  m.collections = [{ id: newId(), name: "Misterio", color: "#C2416B", kind: "smart", ids: [], filter: { tags: ["misterio"], status: [], pov: "", text: "" } }];
  return { manifest: m, texts };
}

/** Crea (o abre, si ya existe) el proyecto de ejemplo. */
export async function openSample(): Promise<boolean> {
  const st = useStore.getState();
  const info = st.info;
  const dir = info?.portable ? await join(info.data_dir, "Proyectos") : await join(await documentDir(), "Escribanía");
  const existing = await join(dir, TITLE);
  const file = await join(existing, `${TITLE}.escribania`);
  try {
    await api.projectOpen(file);
    return openProject(file);
  } catch {
    /* no existe todavía: se crea */
  }
  const { manifest, texts } = sampleProject(st.settings.authorName || "Ana Lema");
  const path = await api.projectCreate(dir, TITLE, manifest, texts);
  return openProject(path);
}
