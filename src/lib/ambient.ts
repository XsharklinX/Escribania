/**
 * Sonido ambiente de Retiro, generado en el momento con Web Audio.
 * No hay archivos de audio: lluvia, chimenea y mar salen de ruido filtrado.
 */
export type Ambient = "rain" | "fire" | "sea";

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

export function toggleAmbient(kind: Ambient): boolean {
  const c = audio();
  void c.resume();
  const cur = playing.get(kind);
  if (cur) {
    cur.stop();
    playing.delete(kind);
    return false;
  }
  const start = kind === "rain" ? startRain : kind === "sea" ? startSea : startFire;
  playing.set(kind, start(c, master!));
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
