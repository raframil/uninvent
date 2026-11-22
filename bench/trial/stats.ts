import type { TrialArmSummary, TrialRunScore, TrialStat } from "./types.js";

export function summarize(runs: TrialRunScore[], arm: TrialRunScore["arm"]): TrialArmSummary {
  const mine = runs.filter((run) => run.arm === arm);
  const scored = mine.filter((run) => run.invent !== null && run.reuse !== null && run.raw !== null);
  return {
    attempted: mine.length,
    scored: scored.length,
    invent: stat(scored.map((run) => run.invent as number)),
    reuse: stat(scored.map((run) => run.reuse as number)),
    raw: stat(scored.map((run) => run.raw as number)),
    tokens: stat(mine.flatMap((run) => (run.tokens === null ? [] : [run.tokens]))),
    cost: stat(mine.flatMap((run) => (run.cost === null ? [] : [run.cost]))),
  };
}

export function stat(values: number[]): TrialStat {
  if (values.length === 0) return { n: 0, mean: null, sd: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (values.length < 2) return { n: values.length, mean: round(mean), sd: null };
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return { n: values.length, mean: round(mean), sd: round(Math.sqrt(variance)) };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
