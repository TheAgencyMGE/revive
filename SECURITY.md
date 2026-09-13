# Security

Revive clones and executes code from repositories it has never seen. It treats
every one of them as hostile.

## Threat model

| Threat | Control |
|---|---|
| SSRF via the repository URL | Allowlist parser: only `https://github.com/<owner>/<repo>`; private, loopback and metadata hosts rejected |
| Command injection through git | argv-only git invocation, `protocol.ext.allow=never`, no shell strings |
| Hostile git config, hooks, symlinks | Host config ignored, hooks disabled, `core.symlinks=false`, upstream `.git` discarded |
| Oversized repos, decompression bombs | Size and file-count limits after clone; disk watchdog during builds |
| Secret theft by install scripts | Host environment never inherited; secret-shaped variables filtered; HOME/TMP redirected |
| Fork bombs, cryptominers, infinite builds | Per-step and per-job timeouts with process-tree kill; PID/CPU/memory limits in Docker; process-count and file-size rlimits on POSIX |
| Log spew | Captured output capped per command |
| Path traversal in artifacts | Stored paths re-validated against the job's artifact root; filenames sanitised |
| XSS from repository content | Diffs and logs rendered as text; ANSI/control characters stripped; strict CSP |
| API key exposure | Keys held in browser session storage and in memory for one run; never persisted, logged, or passed to a sandbox |

## Isolation modes

- **docker** — the recommended mode for untrusted code. A fresh container per
  command with dropped capabilities, `no-new-privileges`, a read-only root,
  resource limits and a non-root user.
- **restricted** — used automatically when Docker is unavailable. It is a real
  defence-in-depth layer but **not** a security boundary equivalent to a
  container: code runs as the current OS user, memory is not capped, and
  network access is not restricted. The interface states this before every run.
- **analysis-only** — set `REVIVE_SANDBOX_MODE=analysis-only` to disable
  execution entirely while keeping detection and static diagnosis.

## Reporting a vulnerability

Please open a private security advisory on this repository rather than a public
issue. Include reproduction steps and the sandbox mode in use.
