/**
 * Bitácora de sesiones, metas, carreras y retos.
 *
 * Se guarda en `bitacora.json` dentro del proyecto. Cada cambio del editor llega
 * aquí como una diferencia de palabras: lo que sube cuenta como escrito y lo
 * que baja como borrado. Los minutos activos son los minutos con escritura.
 */
import { create } from "zustand";
import type { Manifest } from "../types";
import { api } from "./api";

export interface DayLog {
  w: number;
  d: number;
  m: number;
}

export interface SessionLog {
  start: string;
  end: string;
  w: number;
  d: number;
  m: number;
  texts: string[];
}

export interface SprintLog {
  start: string;
  minutes: number;
  goal: number;
  words: number;
  brave: boolean;
}

export interface Challenge {
  id: string;
  name: string;
  kind: "words" | "days";
  target: number;
  start: string;
  end: string;
  done?: string;
}

export interface Journal {
  version: 1;
  days: Record<string, DayLog>;
  /** Palabras escritas por hora del día (0-23). */
  hours: number[];
  sessions: SessionLog[];
  sprints: SprintLog[];
  challenges: Challenge[];
}

const FILE = "bitacora.json";

export function emptyJournal(): Journal {
  return { version: 1, days: {}, hours: Array(24).fill(0), sessions: [], sprints: [], challenges: [] };
}

export const useJournal = create<{ journal: Journal; session: SessionLog | null; net: number }>(() => ({
  journal: emptyJournal(),
  session: null,
  /** Palabras netas de esta sesión (para las carreras). */
  net: 0,
}));

export function dayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let root: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastMinute = "";

export async function startJournal(projectRoot: string) {
  root = projectRoot;
  let j = emptyJournal();
  try {
    const raw = (await api.projectJsonRead(projectRoot, FILE)) as Partial<Journal> | null;
    if (raw && typeof raw === "object") j = { ...j, ...raw, hours: raw.hours?.length === 24 ? raw.hours : j.hours };
  } catch {
    /* bitácora nueva */
  }
  const now = new Date().toISOString();
  lastMinute = "";
  useJournal.setState({ journal: j, session: { start: now, end: now, w: 0, d: 0, m: 0, texts: [] }, net: 0 });
}

function scheduleSave() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void saveJournal(), 4000);
}

function withSession(j: Journal, s: SessionLog | null): Journal {
  if (!s || (s.w === 0 && s.d === 0)) return j;
  const sessions = j.sessions.filter((x) => x.start !== s.start);
  return { ...j, sessions: [...sessions, s].slice(-500) };
}

export async function saveJournal() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!root) return;
  const { journal, session } = useJournal.getState();
  try {
    await api.projectJsonWrite(root, FILE, withSession(journal, session));
  } catch {
    /* se reintenta en el siguiente cambio */
  }
}

export async function stopJournal() {
  await saveJournal();
  root = null;
  useJournal.setState({ session: null, net: 0 });
}

/** Un texto cambió `delta` palabras al escribir. */
export function trackDelta(textId: string, delta: number) {
  if (!delta || !root) return;
  const st = useJournal.getState();
  const now = new Date();
  const key = dayKey(now);
  const minute = `${key} ${now.getHours()}:${now.getMinutes()}`;
  const newMinute = minute !== lastMinute;
  lastMinute = minute;
  const day = { ...(st.journal.days[key] ?? { w: 0, d: 0, m: 0 }) };
  const hours = [...st.journal.hours];
  if (delta > 0) {
    day.w += delta;
    hours[now.getHours()] += delta;
  } else day.d -= delta;
  if (newMinute) day.m += 1;
  const s = st.session ? { ...st.session } : null;
  if (s) {
    if (delta > 0) s.w += delta;
    else s.d -= delta;
    if (newMinute) s.m += 1;
    s.end = now.toISOString();
    if (!s.texts.includes(textId)) s.texts = [...s.texts, textId];
  }
  useJournal.setState({ journal: { ...st.journal, days: { ...st.journal.days, [key]: day }, hours }, session: s, net: st.net + delta });
  scheduleSave();
}

export function updateJournal(fn: (j: Journal) => Journal) {
  useJournal.setState({ journal: fn(useJournal.getState().journal) });
  void saveJournal();
}

// ---------------- cálculos ----------------

export const net = (d?: DayLog) => (d ? d.w - d.d : 0);

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Racha: días seguidos escribiendo hasta hoy. Los días de descanso no la rompen. */
export function streaks(j: Journal, restDays: number[], today = new Date()): { current: number; best: number } {
  const keys = Object.keys(j.days).filter((k) => net(j.days[k]) > 0).sort();
  if (!keys.length) return { current: 0, best: 0 };
  const wrote = new Set(keys);
  let best = 0;
  let run = 0;
  for (let d = new Date(keys[0] + "T12:00:00"); dayKey(d) <= dayKey(today); d = addDays(d, 1)) {
    if (wrote.has(dayKey(d))) run++;
    else if (!restDays.includes(d.getDay()) && dayKey(d) !== dayKey(today)) run = 0;
    best = Math.max(best, run);
  }
  return { current: run, best };
}

/** Días de escritura entre hoy y la fecha de entrega (incluidos), sin los de descanso. */
export function writingDaysLeft(deadline: string, restDays: number[], today = new Date()): number {
  const end = new Date(deadline + "T12:00:00");
  let n = 0;
  for (let d = new Date(dayKey(today) + "T12:00:00"); d <= end; d = addDays(d, 1)) if (!restDays.includes(d.getDay())) n++;
  return n;
}

export interface Pace {
  remaining: number;
  daysLeft: number;
  perDay: number;
  today: number;
}

export function pace(m: Manifest, bookWords: number, j: Journal, today = new Date()): Pace | null {
  const todayNet = net(j.days[dayKey(today)]);
  if (!m.target.words) return null;
  const remainingAtStart = Math.max(0, m.target.words - (bookWords - todayNet));
  if (!m.target.deadline) return { remaining: Math.max(0, m.target.words - bookWords), daysLeft: 0, perDay: 0, today: todayNet };
  const daysLeft = writingDaysLeft(m.target.deadline, m.target.restDays, today);
  return {
    remaining: Math.max(0, m.target.words - bookWords),
    daysLeft,
    perDay: daysLeft > 0 ? Math.ceil(remainingAtStart / daysLeft) : remainingAtStart,
    today: todayNet,
  };
}

export function challengeProgress(c: Challenge, j: Journal): number {
  let total = 0;
  for (const [k, d] of Object.entries(j.days)) {
    if (k < c.start || k > c.end) continue;
    if (c.kind === "words") total += Math.max(0, net(d));
    else if (net(d) > 0) total++;
  }
  return total;
}

/** Hora del día con más palabras escritas, si hay datos suficientes. */
export function bestHour(j: Journal): number | null {
  const max = Math.max(...j.hours);
  return max > 100 ? j.hours.indexOf(max) : null;
}

export function lastDays(j: Journal, n: number, today = new Date()): { key: string; net: number; date: Date }[] {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    out.push({ key: dayKey(d), net: net(j.days[dayKey(d)]), date: d });
  }
  return out;
}
