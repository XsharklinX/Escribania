/** Disposición de grafo por fuerzas (Fruchterman-Reingold sencillo) para la Telaraña. */
export interface P {
  x: number;
  y: number;
}

export function layout(ids: string[], edges: [string, string][], fixed: Record<string, P>, w: number, h: number, iterations = 320): Record<string, P> {
  const pos: Record<string, P> = {};
  const n = ids.length;
  ids.forEach((id, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    pos[id] = fixed[id] ? { ...fixed[id] } : { x: w / 2 + Math.cos(a) * w * 0.3, y: h / 2 + Math.sin(a) * h * 0.3 };
  });
  if (n < 2) return pos;
  const k = Math.sqrt((w * h) / n) * 0.75;
  let temp = w / 8;
  for (let it = 0; it < iterations; it++) {
    const disp: Record<string, P> = {};
    for (const id of ids) disp[id] = { x: 0, y: 0 };
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const a = pos[ids[i]];
        const b = pos[ids[j]];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d = Math.hypot(dx, dy);
        if (d < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d = 0.5;
        }
        const f = (k * k) / d;
        disp[ids[i]].x += (dx / d) * f;
        disp[ids[i]].y += (dy / d) * f;
        disp[ids[j]].x -= (dx / d) * f;
        disp[ids[j]].y -= (dy / d) * f;
      }
    for (const [s, t] of edges) {
      const a = pos[s];
      const b = pos[t];
      if (!a || !b) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d = Math.max(0.01, Math.hypot(dx, dy));
      const f = (d * d) / k;
      disp[s].x -= (dx / d) * f;
      disp[s].y -= (dy / d) * f;
      disp[t].x += (dx / d) * f;
      disp[t].y += (dy / d) * f;
    }
    for (const id of ids) {
      if (fixed[id]) continue;
      const p = pos[id];
      // Un poco de gravedad hacia el centro para que nada se escape.
      disp[id].x += (w / 2 - p.x) * 0.02 * k * 0.05;
      disp[id].y += (h / 2 - p.y) * 0.02 * k * 0.05;
      const d = Math.max(0.01, Math.hypot(disp[id].x, disp[id].y));
      p.x = Math.min(w - 70, Math.max(70, p.x + (disp[id].x / d) * Math.min(d, temp)));
      p.y = Math.min(h - 60, Math.max(60, p.y + (disp[id].y / d) * Math.min(d, temp)));
    }
    temp *= 0.985;
  }
  return pos;
}
