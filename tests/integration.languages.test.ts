import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { MemoryJobSink, dumpOnFailure, fixtureRepoPath, newJobId } from './helpers';
import { probeTool } from '../src/engine/toolchain';

/**
 * End-to-end integration across every supported language, using only the
 * offline fixtures. Each asserts the same contract: the project must genuinely
 * fail first, be diagnosed with the right category, and end up measurably
 * better than it started.
 *
 * Tests skip when the relevant toolchain is absent rather than failing, because
 * "no toolchain here" is a legitimate environment, not a defect in Revive.
 */

let runJob: typeof import('../src/engine/orchestrator').runJob;
let dataDir: string;

beforeAll(async () => {
  dataDir = path.resolve(__dirname, '..', '.revive-test', 'lang');
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.mkdir(dataDir, { recursive: true });
  process.env.REVIVE_DATA_DIR = dataDir;
  process.env.REVIVE_STEP_TIMEOUT_MS = '240000';
  ({ runJob } = await import('../src/engine/orchestrator'));
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
});

async function run(fixtureId: string) {
  const sink = new MemoryJobSink();
  dumpOnFailure(sink);
  const controller = new AbortController();
  const result = await runJob({
    jobId: newJobId(),
    repoUrl: `fixture://revive/${fixtureId}/demo`,
    localPath: fixtureRepoPath(fixtureId),
    sink,
    signal: controller.signal,
  });
  return { sink, result };
}

async function haveTool(tool: string, args: string[]): Promise<boolean> {
  const probe = await probeTool(tool, args);
  return probe.available;
}

// ---------------------------------------------------------------------------

describe('python2-legacy', () => {
  it('recognises Python 2 source and migrates it', async () => {
    if (!(await haveTool('python', ['--version']))) return;

    const { sink, result } = await run('python2-legacy');

    const detection = sink.state.detection as any;
    expect(detection.language).toBe('python');

    // .python-version pins 2.7.6 — an explicit, authoritative signal.
    const env = sink.state.originalEnv as any;
    expect(env.runtimeVersion).toBe('2.7.6');
    expect(env.evidence.some((e: any) => e.source === '.python-version')).toBe(true);

    const baseline = sink.state.baseline as any;
    expect(baseline.overall).not.toBe('working');

    const diagnoses = sink.state.diagnosis as any[];
    expect(
      diagnoses.some((d) => d.category === 'python-version'),
    ).toBe(true);

    const final = sink.state.finalResult as any;
    expect(final.score).toBeGreaterThan(baseline.score);
    expect(['succeeded', 'partial']).toContain(result.status);

    // The 2to3 migration is high risk and must be reported as such.
    const kept = (sink.state.repairs as any[]).filter((r) => !r.rolledBack);
    const migration = kept.find((r) => r.id === 'python-2to3');
    expect(migration).toBeDefined();
    expect(migration.risk).toBe('high');
    expect(migration.filesTouched.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('java-target-mismatch', () => {
  it('identifies an unsupported compiler target and raises it minimally', async () => {
    if (!(await haveTool('javac', ['-version']))) return;

    const { sink, result } = await run('java-target-mismatch');

    const detection = sink.state.detection as any;
    expect(detection.language).toBe('java');
    expect(detection.packageManager).toBe('maven');

    // pom.xml says 1.6, which means Java 6.
    const env = sink.state.originalEnv as any;
    expect(env.runtimeVersion).toBe('6');

    const baseline = sink.state.baseline as any;
    expect(baseline.overall).not.toBe('working');

    const diagnoses = sink.state.diagnosis as any[];
    expect(diagnoses.some((d) => d.category === 'java-version')).toBe(true);

    const final = sink.state.finalResult as any;
    expect(final.score).toBeGreaterThan(baseline.score);
    expect(['succeeded', 'partial']).toContain(result.status);

    // No .java file may be edited — only the build configuration.
    const changed = sink.state.changedFiles as any[];
    expect(changed.some((f) => f.path === 'pom.xml')).toBe(true);
    expect(changed.filter((f) => f.path.endsWith('.java'))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('go-version-directive', () => {
  it('detects a go directive the toolchain cannot satisfy', async () => {
    if (!(await haveTool('go', ['version']))) return;

    const { sink, result } = await run('go-version-directive');

    const detection = sink.state.detection as any;
    expect(detection.language).toBe('go');
    expect(detection.packageManager).toBe('gomod');

    const env = sink.state.originalEnv as any;
    expect(env.runtimeVersion).toBe('1.99');
    expect(env.evidence.some((e: any) => e.source === 'go.mod')).toBe(true);

    const baseline = sink.state.baseline as any;
    expect(baseline.overall).not.toBe('working');

    const diagnoses = sink.state.diagnosis as any[];
    expect(diagnoses.length).toBeGreaterThan(0);

    const final = sink.state.finalResult as any;
    expect(final.score).toBeGreaterThan(baseline.score);
    expect(['succeeded', 'partial']).toContain(result.status);

    const changed = sink.state.changedFiles as any[];
    expect(changed.some((f) => f.path === 'go.mod')).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('rust-msrv', () => {
  it('detects an unreachable MSRV and lowers it', async () => {
    if (!(await haveTool('cargo', ['--version']))) return;

    const { sink, result } = await run('rust-msrv');

    const detection = sink.state.detection as any;
    expect(detection.language).toBe('rust');
    expect(detection.packageManager).toBe('cargo');

    const env = sink.state.originalEnv as any;
    expect(env.runtimeVersion).toBe('1.99.0');

    const baseline = sink.state.baseline as any;
    expect(baseline.overall).not.toBe('working');

    const final = sink.state.finalResult as any;
    expect(final.score).toBeGreaterThan(baseline.score);
    expect(['succeeded', 'partial']).toContain(result.status);

    const changed = sink.state.changedFiles as any[];
    expect(changed.some((f) => f.path === 'Cargo.toml')).toBe(true);
    // The source must be untouched — only the manifest claim was wrong.
    expect(changed.filter((f) => f.path.endsWith('.rs'))).toHaveLength(0);
  });
});
