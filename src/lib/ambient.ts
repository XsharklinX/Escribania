/**
 * Sonido ambiente de Retiro, generado en el momento con Web Audio.
 * No hay archivos de audio: lluvia, chimenea, mar, tren, bosque y biblioteca
 * salen de ruido filtrado y osciladores; las teclas suenan al escribir.
 */
export type Ambient = "rain" | "fire" | "sea" | "train" | "forest" | "library" | "keys";
export const AMBIENTS: Ambient[] = ["rain", "fire", "sea", "train", "forest", "library", "keys"];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const playing = new Map<Ambient, { stop: () => void }>();

function audio(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  return ctx;
}

function noiseBuffer(c: AudioContext, kind: "white" | "brown"): AudioBuffer {
  const len = c.sampleRate * 4;
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "white") d[i] = w;
      else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
  }
  return buf;
}

function loop(c: AudioContext, kind: "white" | "brown"): AudioBufferSourceNode {
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c, kind);
  s.loop = true;
  return s;
}

function startRain(c: AudioContext, out: AudioNode) {
  const src = loop(c, "white");
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 600;
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 5200;
  const g = c.createGain();
  g.gain.value = 0.22;
  src.connect(hp).connect(lp).connect(g).connect(out);
  src.start();
  return { stop: () => src.stop() };
}

function startSea(c: AudioContext, out: AudioNode) {
  const src = loop(c, "brown");
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 900;
  const g = c.createGain();
  g.gain.value = 0.35;
  // Las olas: el volumen sube y baja cada ~8 s.
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.12;
  const depth = c.createGain();
  depth.gain.value = 0.28;
  lfo.connect(depth).connect(g.gain);
  src.connect(lp).connect(g).connect(out);
  src.start();
  lfo.start();
  return {
    stop: () => {
      src.stop();
      lfo.stop();
    },
  };
}

function startFire(c: AudioContext, out: AudioNode) {
  const src = loop(c, "brown");
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 500;
  const g = c.createGain();
  g.gain.value = 0.4;
  src.connect(lp).connect(g).connect(out);
  src.start();
  // Chasquidos de leña: ráfagas cortas de ruido a intervalos al azar.
  const crack = c.createBuffer(1, Math.floor(c.sampleRate * 0.03), c.sampleRate);
  const d = crack.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
  let alive = true;
  const tick = () => {
    if (!alive) return;
    const s = c.createBufferSource();
    s.buffer = crack;
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1500 + Math.random() * 2500;
    const cg = c.createGain();
    cg.gain.value = 0.15 + Math.random() * 0.35;
    s.connect(bp).connect(cg).connect(out);
    s.start();
    setTimeout(tick, 80 + Math.random() * (Math.random() < 0.2 ? 1500 : 450));
  };
  tick();
  return {
    stop: () => {
      alive = false;
      src.stop();
    },
  };
}

/** Un golpe corto de ruido filtrado (traqueteo, página, tecla). */
function burst(c: AudioContext, out: AudioNode, opts: { dur: number; freq: number; q?: number; gain: number; type?: BiquadFilterType; decay?: number; at?: number }) {
  const len = Math.max(1, Math.floor(c.sampleRate * opts.dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  const k = opts.decay ?? 3;
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, k);
  const s = c.createBufferSource();
  s.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = opts.type ?? "bandpass";
  f.frequency.value = opts.freq;
  f.Q.value = opts.q ?? 1;
  const g = c.createGain();
  g.gain.value = opts.gain;
  s.connect(f).connect(g).connect(out);
  s.start(opts.at ?? c.currentTime);
}

/** Tren nocturno: rumor grave y el «ta-tán» de las juntas de la vía. */
function startTrain(c: AudioContext, out: AudioNode) {
  const src = loop(c, "brown");
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 260;
  const g = c.createGain();
  g.gain.value = 0.55;
  const sway = c.createOscillator();
  sway.frequency.value = 0.07;
  const depth = c.createGain();
  depth.gain.value = 0.12;
  sway.connect(depth).connect(g.gain);
  src.connect(lp).connect(g).connect(out);
  src.start();
  sway.start();
  const timer = setInterval(() => {
    const t0 = c.currentTime + 0.02;
    for (const [dt, gain] of [[0, 0.5], [0.16, 0.42], [0.95, 0.5], [1.11, 0.42]] as const) burst(c, out, { dur: 0.09, freq: 140, q: 0.8, gain, type: "lowpass", decay: 2, at: t0 + dt });
  }, 2200);
  return {
    stop: () => {
      clearInterval(timer);
      src.stop();
      sway.stop();
    },
  };
}

/** Bosque: viento entre las hojas y algún pájaro de vez en cuando. */
function startForest(c: AudioContext, out: AudioNode) {
  const src = loop(c, "white");
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 700;
  bp.Q.value = 0.6;
  const g = c.createGain();
  g.gain.value = 0.12;
  const wind = c.createOscillator();
  wind.frequency.value = 0.09;
  const wd = c.createGain();
  wd.gain.value = 320;
  wind.connect(wd).connect(bp.frequency);
  src.connect(bp).connect(g).connect(out);
  src.start();
  wind.start();
  let alive = true;
  const bird = () => {
    if (!alive) return;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1800;
    let t0 = c.currentTime + 0.05;
    for (let i = 0; i < notes; i++) {
      const o = c.createOscillator();
      o.type = "sine";
      const eg = c.createGain();
      o.frequency.setValueAtTime(base, t0);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.5), t0 + 0.08);
      eg.gain.setValueAtTime(0, t0);
      eg.gain.linearRampToValueAtTime(0.06, t0 + 0.015);
      eg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      o.connect(eg).connect(out);
      o.start(t0);
      o.stop(t0 + 0.14);
      t0 += 0.13 + Math.random() * 0.08;
    }
    setTimeout(bird, 3000 + Math.random() * 9000);
  };
  setTimeout(bird, 1500);
  return {
    stop: () => {
      alive = false;
      src.stop();
      wind.stop();
    },
  };
}

/** Biblioteca: silencio de sala, un reloj lejano y alguna página que se pasa. */
function startLibrary(c: AudioContext, out: AudioNode) {
  const src = loop(c, "brown");
  const lp = c.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 180;
  const g = c.createGain();
  g.gain.value = 0.25;
  src.connect(lp).connect(g).connect(out);
  src.start();
  const tick = setInterval(() => burst(c, out, { dur: 0.012, freq: 3200, q: 6, gain: 0.05 }), 1000);
  let alive = true;
  const page = () => {
    if (!alive) return;
    burst(c, out, { dur: 0.35, freq: 2400, q: 0.7, gain: 0.07, type: "highpass", decay: 1.2 });
    setTimeout(page, 7000 + Math.random() * 16000);
  };
  setTimeout(page, 4000);
  return {
    stop: () => {
      alive = false;
      clearInterval(tick);
      src.stop();
    },
  };
}

/** Teclas de máquina de escribir: no suenan solas, sino con cada pulsación. */
function startKeys() {
  return { stop: () => {} };
}

/** Lo llama el editor en cada tecla mientras están activas las teclas. */
export function keySound(key: string) {
  if (!playing.has("keys") || !ctx || !master) return;
  const c = ctx;
  if (key === "Enter") {
    // Retorno del carro y campanilla.
    burst(c, master, { dur: 0.18, freq: 900, q: 0.8, gain: 0.25, decay: 1.5 });
    const o = c.createOscillator();
    const eg = c.createGain();
    o.frequency.value = 2650;
    eg.gain.setValueAtTime(0.12, c.currentTime + 0.12);
    eg.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.1);
    o.connect(eg).connect(master);
    o.start(c.currentTime + 0.12);
    o.stop(c.currentTime + 1.2);
    return;
  }
  if (key.length > 1 && key !== "Backspace") return;
  const space = key === " ";
  burst(c, master, { dur: 0.025, freq: space ? 900 : 2200 + Math.random() * 1200, q: 1.5, gain: space ? 0.35 : 0.3 });
  burst(c, master, { dur: 0.05, freq: 160, q: 0.7, gain: 0.25, type: "lowpass", decay: 4 });
}

export function toggleAmbient(kind: Ambient): boolean {
  const c = audio();
  void c.resume();
  const cur = playing.get(kind);
  if (cur) {
    cur.stop();
    playing.delete(kind);
    return false;
  }
  const starters: Record<Ambient, (c: AudioContext, out: AudioNode) => { stop: () => void }> = {
    rain: startRain,
    sea: startSea,
    fire: startFire,
    train: startTrain,
    forest: startForest,
    library: startLibrary,
    keys: startKeys,
  };
  playing.set(kind, starters[kind](c, master!));
  return true;
}

export function setAmbientVolume(v: number) {
  if (master) master.gain.value = Math.max(0, Math.min(1, v));
}

export function stopAllAmbient() {
  playing.forEach((p) => p.stop());
  playing.clear();
}

export function isPlaying(kind: Ambient) {
  return playing.has(kind);
}
