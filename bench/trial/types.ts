export interface TrialTask {
  id: string;
  /** Project-relative path the agent should create. */
  file: string;
  prompt: string;
}

export interface TrialRepo {
  id: string;
  url: string;
  /** Full commit SHA. The judge diffs against this commit. */
  sha: string;
  license: string;
  stars: string;
  why: string;
  /** Local checkout used by tests. The published config leaves this unset and clones `url`. */
  path?: string;
  tasks: TrialTask[];
}

export interface TrialConfig {
  schema: 1;
  model: string;
  baseUrl: string;
  /** Live runs per arm. Dry-run always replays once. */
  runs: number;
  maxTurns: number;
  repos: TrialRepo[];
}

export type TrialArm = "baseline" | "uninvent";

export interface TrialRunScore {
  arm: TrialArm;
  run: number;
  /** Null when the run was not scored. Never a stand-in for a failed call. */
  invent: number | null;
  reuse: number | null;
  raw: number | null;
  recipe: number | null;
  state: number | null;
  nameCollision: number | null;
  /** Sum of usage.total_tokens when every response reported it. */
  tokens: number | null;
  /** Set only when the provider returned a cost field. */
  cost: number | null;
  turns: number;
  emptyDiff: boolean;
  diff?: string;
  error?: string;
}

export interface TrialStat {
  n: number;
  mean: number | null;
  /** Sample standard deviation. Null when fewer than two scored runs. */
  sd: number | null;
}

export interface TrialArmSummary {
  scored: number;
  attempted: number;
  invent: TrialStat;
  reuse: TrialStat;
  raw: TrialStat;
  tokens: TrialStat;
  cost: TrialStat;
}

export interface TrialTaskResult {
  id: string;
  file: string;
  prompt: string;
  runs: TrialRunScore[];
  baseline: TrialArmSummary;
  uninvent: TrialArmSummary;
}

export interface TrialRepoResult {
  id: string;
  url: string;
  sha: string;
  license: string;
  tasks: TrialTaskResult[];
}

export interface TrialModelBlock {
  model: string;
  repos: TrialRepoResult[];
}

export interface TrialResult {
  schema: 1;
  /** `dry-run` replays canned files and must not be published as the study. */
  status: "dry-run" | "ran" | "error";
  reason?: string;
  generatedAt: string;
  uninventVersion: string;
  /** Comma-joined model list, in run order. */
  model: string;
  models: string[];
  baseUrl: string;
  provider: "openai-compatible";
  runs: number;
  maxTurns: number;
  judge: string;
  byModel: TrialModelBlock[];
}
