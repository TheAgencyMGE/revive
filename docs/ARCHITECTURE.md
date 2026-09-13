# Revive architecture

## Shape of the system

```
 Browser ──HTTP──► Next.js route handlers ──► SQLite (Prisma)
    ▲                     │
    │ SSE                 ▼
    └──── event bus ◄── in-process job queue ──► Engine (src/engine)
                                                   │
                                                   ├─ git (argv only, hardened clone)
                                                   ├─ detect/*       language adapters
                                                   ├─ environment    runtime archaeology
                                                   ├─ toolchain      host runtime discovery
                                                   ├─ sandbox/*      docker | restricted | analysis-only
                                                   ├─ runner         install/build/test/start + scoring
                                                   ├─ classify/*     deterministic failure rules
                                                   ├─ repair/*       repair registry + planner
                                                   ├─ ai/provider    optional, never required
                                                   ├─ depdiff/report/artifacts
                                                   └─ orchestrator   the 7-phase pipeline
```

Everything runs in one Node process with no external services. The pieces that
would change for a multi-instance deployment each sit behind a narrow interface:

| Local implementation | Interface | Production swap |
|---|---|---|
| SQLite via Prisma | Prisma schema | Postgres: change provider, run migration |
| `server/bus.ts` EventEmitter | `publish` / `subscribe` / `history` | Redis pub/sub |
| `server/queue.ts` in-process worker | `enqueue` / `cancel` | Separate worker process on a shared queue |
| `.revive/artifacts` on disk | `writeArtifacts` / download route | Object storage |
| `lib/ratelimit.ts` memory buckets | `rateLimit(key)` | Redis-backed limiter |

## The engine boundary

`src/engine` imports nothing from React, Next or Prisma. Its only coupling to the
application is the `JobSink` interface (`log`, `setPhase`, `setState`,
`recordAttempt`, `isCancelled`). The app implements it with `PrismaJobSink`; the
tests implement it with an in-memory sink. That is why fixtures, real repositories
and integration tests all run the identical pipeline.

## The pipeline

1. **Analyze** — hardened clone, size and file-count guards, metadata, language
   detection, pristine snapshot committed to a fresh internal git repo.
2. **Reconstruct** — gather weighted evidence for the original runtime
   (`.nvmrc`, `engines`, `.python-version`, `pom.xml` targets, `go.mod`, MSRV,
   CI config, lockfile format, commit date). Probe the host and version managers
   for that runtime; report honestly when it is missing.
3. **Baseline** — run install → build → test → start untouched.
4. **Diagnose** — rules in `classify/rules.ts` turn output into categorised
   diagnoses, each carrying the log excerpt that justified it. Static rules fire
   from manifests alone, which keeps analysis-only mode useful. AI is consulted
   only when no rule matches and a key was supplied.
5. **Repair** — `planRepairs` picks only repairs a diagnosis asked for, ordered by
   severity then priority, within a small per-attempt budget, never repeating one.
6. **Verify** — re-run everything. Keep the attempt only if the score improved;
   otherwise `git reset --hard` to the best checkpoint. Rolled-back repairs stay in
   the record.
7. **Complete** — revert any change no kept repair is responsible for (e.g. a
   lockfile npm generated), then produce the diff, dependency diff, patch, ZIP and
   `REVIVAL_REPORT.md`.

## Honesty rules built into scoring

- A test runner that collects zero tests is recorded as *skipped*, never *passed*.
- `start` is scored but does not decide the verdict; a CLI that needs arguments is
  not a failed revival, and the report says so.
- The report keeps the **original** diagnosis even after a successful repair.
- AI findings are capped below deterministic confidence.
- Tests are never edited to make them pass.

## Security model

Every repository is treated as hostile.

- **Input**: allowlist parser accepts only `https://github.com/<owner>/<repo>`.
  Rejects SSH, `ext::`, `file:`, credentials, ports, private/metadata hosts.
- **Clone**: argv-only git, `protocol.ext.allow=never`, `core.symlinks=false`,
  no credential prompts, host git config ignored, upstream `.git` deleted, hooks
  disabled, size and file-count limits.
- **Execution** (`sandbox/`):
  - *docker*: fresh container per command, `--network`, `--memory`, `--cpus`,
    `--pids-limit`, `--cap-drop ALL`, `no-new-privileges`, read-only root, tmpfs,
    non-root, `--rm`.
  - *restricted*: no inherited environment (allowlist + secret-pattern filter),
    HOME/TMP redirected into the workspace, timeouts with process-tree kill,
    output cap, disk watchdog, POSIX process-count and file-size rlimits. Memory is not capped in this mode (address-space limits break V8, the JVM and Go). Toolchain *install locations*
    (e.g. `RUSTUP_HOME`) pass through; credential stores (`CARGO_HOME`, `~/.npmrc`,
    `~/.m2/settings.xml`) do not. This is weaker than a container and the UI says so.
  - *analysis-only*: nothing executes.
- **Output**: ANSI/control characters stripped, secret-shaped strings redacted,
  diffs rendered as React text (no HTML injection), strict CSP headers.
- **Downloads**: stored paths re-validated against the job's artifact root;
  filenames sanitised.
- **AI keys**: session storage in the browser; held in queue memory for one run;
  never persisted, logged, or placed in a sandbox environment.

## Adding a language

1. `detect/<lang>.ts` returning a `DetectionResult` with commands.
2. A branch in `environment.ts` that gathers evidence.
3. Rules in `classify/rules.ts`.
4. Repairs registered in `repair/index.ts`.
5. A fixture plus an integration test.
