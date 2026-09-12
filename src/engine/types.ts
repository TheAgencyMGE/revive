/**
 * Core type contracts for the Revive engine.
 *
 * The engine is deliberately decoupled from the UI: it never imports React,
 * Next, or Prisma. Everything it produces is plain serialisable data, which is
 * what lets the same pipeline drive fixtures, external repos and tests.
 */

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

export const PHASES = [
  'analyze',
  'reconstruct',
  'baseline',
  'diagnose',
  'repair',
  'verify',
  'complete',
] as const;

export type CorePhase = (typeof PHASES)[number];
export type Phase = CorePhase | 'queued' | 'cancelled' | 'failed';

export const PHASE_LABELS: Record<string, string> = {
  queued: 'Queued',
  analyze: 'Analyze',
  reconstruct: 'Reconstruct',
  baseline: 'Baseline Build',
  diagnose: 'Diagnose',
  repair: 'Repair',
  verify: 'Verify',
  complete: 'Complete',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';

// ---------------------------------------------------------------------------
// Languages / ecosystems
// ---------------------------------------------------------------------------

export type Language = 'node' | 'python' | 'java' | 'go' | 'rust' | 'unknown';

export type PackageManager =
  | 'npm'
  | 'yarn'
  | 'pnpm'
  | 'pip'
  | 'poetry'
  | 'pipenv'
  | 'maven'
  | 'gradle'
  | 'gomod'
  | 'cargo'
  | 'unknown';

// ---------------------------------------------------------------------------
// Repository metadata
// ---------------------------------------------------------------------------

export interface RepoMetadata {
  owner: string;
  name: string;
  url: string;
  defaultBranch: string;
  headSha: string;
  headShortSha: string;
  lastCommitDate: string | null;
  /** Years since the last commit — drives "how abandoned is this". */
  ageYears: number | null;
  commitCount: number;
  fileCount: number;
  sizeBytes: number;
  topLanguages: { name: string; files: number }[];
  hasReadme: boolean;
  license: string | null;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface DetectedCommands {
  install?: string;
  build?: string;
  test?: string;
  start?: string;
  lint?: string;
}

export interface DependencySpec {
  name: string;
  range: string;
  dev?: boolean;
  scope?: string;
}

export interface DetectionResult {
  language: Language;
  languages: Language[];
  framework: string | null;
  frameworkVersion: string | null;
  packageManager: PackageManager;
  manifestFiles: string[];
  lockfiles: string[];
  hasLockfile: boolean;
  lockfileVersion: string | null;
  commands: DetectedCommands;
  dependencies: DependencySpec[];
  moduleSystem: 'commonjs' | 'esm' | 'mixed' | 'n/a';
  /** Project root relative to the repo root (monorepo / nested project support). */
  projectRoot: string;
  notes: string[];
}

/** A reconstructed guess at the toolchain the project originally expected. */
export interface EnvironmentSpec {
  language: Language;
  runtime: string | null; // e.g. "node"
  runtimeVersion: string | null; // e.g. "14.21.3"
  packageManager: PackageManager;
  packageManagerVersion: string | null;
  /** How the version was arrived at — the archaeology evidence trail. */
  evidence: EnvironmentEvidence[];
  confidence: number; // 0-100
  available: boolean; // is this runtime actually usable on this machine?
  actualVersion: string | null; // what we really ran with
}

export interface EnvironmentEvidence {
  source: string; // ".nvmrc" | "engines.node" | "lockfileVersion" | "commit-date" | ...
  value: string;
  weight: number;
  note?: string;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface CommandResult {
  command: string;
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  combined: string;
  durationMs: number;
  timedOut: boolean;
  truncated: boolean;
  ok: boolean;
}

export type StepName = 'install' | 'build' | 'test' | 'start' | 'lint';

export interface StepResult {
  step: StepName;
  command: string;
  status: 'passed' | 'failed' | 'skipped' | 'timeout' | 'not-applicable';
  exitCode: number | null;
  durationMs: number;
  output: string;
  truncated: boolean;
}

export interface VerificationResult {
  steps: StepResult[];
  installOk: boolean;
  buildOk: boolean;
  testOk: boolean;
  startOk: boolean;
  /** Overall: did the project reach a usable state? */
  overall: 'working' | 'partial' | 'broken' | 'not-run';
  score: number; // 0-100, used for before/after comparison
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

export type FailureCategory =
  | 'runtime-version'
  | 'obsolete-dependency'
  | 'dead-package'
  | 'broken-lockfile'
  | 'deprecated-api'
  | 'native-module'
  | 'node-sass'
  | 'bundler-incompat'
  | 'module-system'
  | 'python-version'
  | 'java-version'
  | 'compiler-behavior'
  | 'missing-env'
  | 'outdated-script'
  | 'peer-conflict'
  | 'build-config'
  | 'network'
  | 'missing-toolchain'
  | 'test-failure'
  | 'unknown';

export const CATEGORY_LABELS: Record<FailureCategory, string> = {
  'runtime-version': 'Incompatible runtime version',
  'obsolete-dependency': 'Obsolete dependency',
  'dead-package': 'Dead / unpublished package',
  'broken-lockfile': 'Broken lockfile',
  'deprecated-api': 'Deprecated API usage',
  'native-module': 'Native module build failure',
  'node-sass': 'node-sass binding failure',
  'bundler-incompat': 'Bundler incompatibility',
  'module-system': 'CommonJS / ESM conflict',
  'python-version': 'Python version conflict',
  'java-version': 'Java target/version mismatch',
  'compiler-behavior': 'Removed compiler behaviour',
  'missing-env': 'Missing environment assumption',
  'outdated-script': 'Outdated script definition',
  'peer-conflict': 'Peer dependency conflict',
  'build-config': 'Build configuration incompatibility',
  network: 'Network / registry failure',
  'missing-toolchain': 'Missing toolchain',
  'test-failure': 'Test failure',
  unknown: 'Unclassified failure',
};

export interface Diagnosis {
  category: FailureCategory;
  title: string;
  detail: string;
  /** The log excerpt that triggered this diagnosis — always shown to the user. */
  evidence: string;
  step: StepName | 'clone' | 'detect';
  confidence: number; // 0-100
  severity: 'blocker' | 'major' | 'minor';
  suggestedRepairs: string[]; // repair ids
  source: 'deterministic' | 'ai';
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

export type RepairKind =
  | 'runtime-pin'
  | 'dependency-replace'
  | 'dependency-bump'
  | 'dependency-remove'
  | 'lockfile-delete'
  | 'install-flag'
  | 'config-patch'
  | 'source-patch'
  | 'script-patch'
  | 'env-inject'
  | 'toolchain-pin';

export interface RepairEffect {
  applied: boolean;
  description: string;
  filesTouched: string[];
  /** Extra env vars that later steps should run with. */
  envPatch?: Record<string, string>;
  commandOverrides?: Partial<DetectedCommands>;
  note?: string;
}

export interface RepairContext {
  repoDir: string;
  projectDir: string;
  detection: DetectionResult;
  env: EnvironmentSpec;
  diagnoses: Diagnosis[];
  log: (level: LogLevel, message: string) => void;
}

export interface RepairAction {
  id: string;
  kind: RepairKind;
  title: string;
  rationale: string;
  /** Lower runs first. Cheap, reversible, high-confidence repairs go first. */
  priority: number;
  category: FailureCategory;
  risk: 'low' | 'medium' | 'high';
  source: 'deterministic' | 'ai';
  /** Mutates the workspace. Returns a human-readable account of what it did. */
  apply: (ctx: RepairContext) => Promise<RepairEffect>;
}

export interface AppliedRepair {
  id: string;
  kind: RepairKind;
  title: string;
  rationale: string;
  category: FailureCategory;
  risk: 'low' | 'medium' | 'high';
  source: 'deterministic' | 'ai';
  attempt: number;
  filesTouched: string[];
  description: string;
  /** True if this repair was rolled back because it did not help. */
  rolledBack: boolean;
}

// ---------------------------------------------------------------------------
// Diff / reporting
// ---------------------------------------------------------------------------

export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface DependencyChange {
  name: string;
  before: string | null;
  after: string | null;
  kind: 'added' | 'removed' | 'changed' | 'replaced';
  reason: string;
}

// ---------------------------------------------------------------------------
// Logging / events
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'success' | 'command';

export interface LogEvent {
  jobId: string;
  seq: number;
  ts: string;
  phase: string;
  level: LogLevel;
  message: string;
}

export type JobEvent =
  | { type: 'log'; data: LogEvent }
  | { type: 'phase'; data: { phase: Phase; phaseIdx: number; attempt: number } }
  | { type: 'status'; data: { status: JobStatus } }
  | { type: 'state'; data: Record<string, unknown> }
  | { type: 'done'; data: { status: JobStatus } };

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

export type SandboxMode = 'docker' | 'restricted' | 'analysis-only';

export interface SandboxCapabilities {
  mode: SandboxMode;
  canExecute: boolean;
  cpuLimited: boolean;
  memoryLimited: boolean;
  diskLimited: boolean;
  networkControlled: boolean;
  filesystemIsolated: boolean;
  processLimited: boolean;
  reason: string;
  detail: string;
}

export interface ExecOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  /** Language toolchain image hint (docker mode). */
  image?: string;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  onOutput?: (chunk: string) => void;
}

export interface Sandbox {
  readonly capabilities: SandboxCapabilities;
  exec(command: string, options: ExecOptions): Promise<CommandResult>;
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Aggregate job view shared with the UI
// ---------------------------------------------------------------------------

export interface JobView {
  id: string;
  createdAt: string;
  updatedAt: string;
  repoUrl: string;
  source: string;
  fixtureId: string | null;
  status: JobStatus;
  phase: Phase;
  phaseIdx: number;
  attempt: number;
  maxAttempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  metadata: RepoMetadata | null;
  detection: DetectionResult | null;
  originalEnv: EnvironmentSpec | null;
  finalEnv: EnvironmentSpec | null;
  baseline: VerificationResult | null;
  finalResult: VerificationResult | null;
  diagnosis: Diagnosis[];
  repairs: AppliedRepair[];
  changedFiles: ChangedFile[];
  dependencyDiff: DependencyChange[];
  confidence: number | null;
  summary: string | null;
  errorMessage: string | null;
  errorCode: string | null;
  sandboxMode: SandboxMode | null;
  hasPatch: boolean;
  hasZip: boolean;
  hasReport: boolean;
  parentJobId: string | null;
}
