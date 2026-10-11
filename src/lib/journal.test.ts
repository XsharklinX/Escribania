import { describe, expect, it } from "vitest";
import { challengeProgress, emptyJournal, pace, streaks, writingDaysLeft } from "./journal";
import { buildProject } from "./templates";

const at = (s: string) => new Date(s + "T10:00:00");

describe("bitácora y metas", () => {
  it("racha que no se rompe en días de descanso", () => {
    const j = emptyJournal();
    // jueves 1, viernes 2, (sábado 3 descanso), domingo 4, lunes 5 sin escribir, martes 6, miércoles 7
    for (const k of ["2026-10-01", "2026-10-02", "2026-10-04", "2026-10-06", "2026-10-07"]) j.days[k] = { w: 300, d: 10, m: 20 };
    expect(streaks(j, [6], at("2026-10-07"))).toEqual({ current: 2, best: 3 });
    // Hoy aún no ha escrito: la racha de ayer sigue viva.
    expect(streaks(j, [6], at("2026-10-08")).current).toBe(2);
  });

  it("palabras al día hasta la entrega", () => {
    expect(writingDaysLeft("2026-10-11", [0], at("2026-10-05"))).toBe(6); // lunes a sábado
    const m = buildProject("novel", "es", "F", "A").manifest;
    m.target = { words: 10000, deadline: "2026-10-11", restDays: [0] };
    const j = emptyJournal();
    j.days["2026-10-05"] = { w: 500, d: 0, m: 30 };
    // Al empezar el día faltaban 10000 - (4500 - 500) = 6000 en 6 días.
    expect(pace(m, 4500, j, at("2026-10-05"))).toEqual({ remaining: 5500, daysLeft: 6, perDay: 1000, today: 500 });
  });

  it("progreso de retos", () => {
    const j = emptyJournal();
    j.days["2026-11-01"] = { w: 2000, d: 300, m: 60 };
    j.days["2026-11-02"] = { w: 100, d: 400, m: 10 };
    j.days["2026-12-01"] = { w: 900, d: 0, m: 10 };
    expect(challengeProgress({ id: "a", name: "NaNo", kind: "words", target: 50000, start: "2026-11-01", end: "2026-11-30" }, j)).toBe(1700);
    expect(challengeProgress({ id: "b", name: "30", kind: "days", target: 30, start: "2026-11-01", end: "2026-12-30" }, j)).toBe(2);
  });
});
