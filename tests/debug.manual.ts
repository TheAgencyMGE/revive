import { describe, it, beforeAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import { MemoryJobSink, fixtureRepoPath, newJobId } from './helpers';

/**
 * Manual diagnostic harness. Not part of the automated suite.
 *
 *   npx vitest run tests/debug.manual.ts --config vitest.debug.config.ts
 *
 * Set FIXTURE=<id> to inspect a specific fixture's full pipeline output.
 */

let runJob: typeof import('../src/engine/orchestrator').runJob;

beforeAll(async () => {
  const dataDir = path.resolve(__dirname, '..', '.revive-test', 'debug');
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.mkdir(dataDir, { recursive: true });
  process.env.REVIVE_DATA_DIR = dataDir;
  process.env.REVIVE_STEP_TIMEOUT_MS = '240000';
  ({ runJob } = await import('../src/engine/orchestrator'));
});

describe('debug', () => {
  it('dumps a full run', async () => {
    const fixtureId = process.env.FIXTURE || 'python2-legacy';
    const sink = new MemoryJobSink();

    const result = await runJob({
      jobId: newJobId(),
      repoUrl: `fixture://revive/${fixtureId}/demo`,
      localPath: fixtureRepoPath(fixtureId),
      sink,
      signal: new AbortController().signal,
    });

    const detection = sink.state.detection as any;
    const baseline = sink.state.baseline as any;
    const final = sink.state.finalResult as any;
    const diagnoses = (sink.state.diagnosis as any[]) ?? [];
    const repairs = (sink.state.repairs as any[]) ?? [];

    console.log('\n================ FIXTURE:', fixtureId, '================');
    console.log('STATUS:', result.status, '| summary:', result.summary);
    console.log('\n--- DETECTION ---');
    console.log('language:', detection?.language, 'pm:', detection?.packageManager);
    console.log('commands:', JSON.stringify(detection?.commands, null, 2));
    console.log('notes:', detection?.notes);

    console.log('\n--- ENV ---');
    console.log(JSON.stringify(sink.state.originalEnv, null, 2));

    console.log('\n--- BASELINE (score', baseline?.score, '/ overall', baseline?.overall, ') ---');
    for (const step of baseline?.steps ?? []) {
      console.log(`\n### ${step.step} [${step.status}] exit=${step.exitCode}`);
      console.log('cmd:', step.command);
      console.log('output:\n' + String(step.output).slice(0, 3000));
    }

    console.log('\n--- DIAGNOSES (', diagnoses.length, ') ---');
    for (const d of diagnoses) {
      console.log(`* [${d.category}] ${d.title} (${d.confidence}%) repairs=${d.suggestedRepairs}`);
    }

    console.log('\n--- REPAIRS (', repairs.length, ') ---');
    for (const r of repairs) {
      console.log(`* ${r.id} rolledBack=${r.rolledBack} :: ${r.description}`);
    }

    console.log('\n--- FINAL (score', final?.score, '/ overall', final?.overall, ') ---');
    for (const step of final?.steps ?? []) {
      console.log(`\n### ${step.step} [${step.status}] exit=${step.exitCode}`);
      console.log('output:\n' + String(step.output).slice(0, 2000));
    }
  });
});
