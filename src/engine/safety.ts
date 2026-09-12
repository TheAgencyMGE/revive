import path from 'node:path';
import fs from 'node:fs/promises';

/**
 * Path-traversal and environment safety helpers.
 *
 * Every repository is treated as hostile. Anything derived from repository
 * content (file paths from manifests, entries in a diff, names in a zip) must
 * pass through these helpers before it touches the filesystem.
 */

/**
 * Resolve `candidate` inside `root`, refusing anything that escapes.
 * Handles `..`, absolute paths, and symlink escapes (via realpath when the
 * target exists).
 */
export function safeResolve(root: string, candidate: string): string {
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, candidate);
  const rel = path.relative(normalizedRoot, resolved);
  if (rel === '') return resolved;
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathEscapeError(candidate, normalizedRoot);
  }
  return resolved;
}

export class PathEscapeError extends Error {
  constructor(candidate: string, root: string) {
    super(`Refusing to access "${candidate}": path escapes sandbox root ${root}`);
    this.name = 'PathEscapeError';
  }
}

/** True when `child` is inside `parent` after symlink resolution. */
export async function isContained(parent: string, child: string): Promise<boolean> {
  try {
    const realParent = await fs.realpath(parent);
    const realChild = await fs.realpath(child);
    const rel = path.relative(realParent, realChild);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch {
    // Target does not exist yet — fall back to lexical containment.
    const rel = path.relative(path.resolve(parent), path.resolve(child));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }
}

/**
 * Environment variables that are safe to pass into a sandbox.
 *
 * The host environment is NOT inherited. This is the single most important
 * secret-theft control in restricted mode: a malicious postinstall script sees
 * only PATH and a handful of inert locale/system variables.
 */
const ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TZ',
  // Windows needs these for basic process creation and temp resolution.
  'SYSTEMROOT',
  'SystemRoot',
  'COMSPEC',
  'ComSpec',
  'PATHEXT',
  'WINDIR',
  'windir',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramData',
];

/**
 * Patterns that indicate a secret. Any variable matching these is dropped even
 * if it somehow appears on the allowlist.
 */
const SECRET_PATTERN =
  /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|SESSION|COOKIE|PRIVATE|SIGNING|ANTHROPIC|OPENAI|AWS|GCP|AZURE|GITHUB|NPM_TOKEN|DATABASE_URL)/i;

/**
 * Toolchain *location* variables that must survive environment scrubbing.
 *
 * This is a deliberate, narrow trade-off. Redirecting HOME is what stops a
 * malicious install script reading ~/.ssh, ~/.aws or ~/.npmrc — but several
 * toolchains also store their installed compilers under HOME, and hiding those
 * makes the toolchain unusable rather than merely sandboxed.
 *
 * So we pass through the variables that point at *installed toolchains*, and
 * deliberately do NOT pass through the ones that point at credential stores:
 *   - RUSTUP_HOME   toolchain installs        -> passed through
 *   - CARGO_HOME    holds credentials         -> stays sandboxed (cold cache)
 *   - GOPATH/GOMODCACHE  module cache         -> stays sandboxed
 *   - M2_HOME       Maven install             -> passed through
 *   - ~/.m2/settings.xml can hold passwords   -> stays sandboxed
 *
 * In Docker mode none of this applies: the toolchain lives in the image and the
 * host filesystem is never mounted.
 */
const TOOLCHAIN_PASSTHROUGH = ['RUSTUP_HOME', 'JAVA_HOME', 'GOROOT', 'M2_HOME', 'GRADLE_USER_HOME'];

/** Default toolchain locations when the variable is not set explicitly. */
function defaultToolchainPaths(): Record<string, string> {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return {};
  const paths: Record<string, string> = {};
  // rustup's default location. Passing it lets `cargo` resolve its toolchain
  // even though HOME itself has been redirected.
  if (!process.env.RUSTUP_HOME) paths.RUSTUP_HOME = path.join(home, '.rustup');
  return paths;
}

/**
 * Build a minimal environment for sandboxed execution.
 * Never inherits the host environment wholesale.
 */
export function buildSandboxEnv(
  extra: Record<string, string> = {},
  opts: { tmpDir?: string; home?: string } = {},
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value === undefined) continue;
    if (SECRET_PATTERN.test(key)) continue;
    env[key] = value;
  }

  // Toolchain locations survive scrubbing — see TOOLCHAIN_PASSTHROUGH.
  for (const key of TOOLCHAIN_PASSTHROUGH) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  for (const [key, value] of Object.entries(defaultToolchainPaths())) {
    env[key] ??= value;
  }

  // Isolate anything the toolchain might write outside the workspace.
  if (opts.home) {
    env.HOME = opts.home;
    env.USERPROFILE = opts.home;
  }
  if (opts.tmpDir) {
    env.TMPDIR = opts.tmpDir;
    env.TEMP = opts.tmpDir;
    env.TMP = opts.tmpDir;
  }

  // Neutralise noisy / telemetry-ish behaviour from common toolchains.
  env.CI = '1';
  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  env.NEXT_TELEMETRY_DISABLED = '1';
  env.DO_NOT_TRACK = '1';
  env.npm_config_fund = 'false';
  env.npm_config_audit = 'false';
  env.npm_config_update_notifier = 'false';
  env.npm_config_progress = 'false';
  env.PIP_DISABLE_PIP_VERSION_CHECK = '1';
  env.PYTHONDONTWRITEBYTECODE = '1';
  env.GRADLE_OPTS = '-Dorg.gradle.daemon=false';
  // Stop Go silently downloading a different toolchain: the whole point is to
  // observe how the project behaves on the toolchain that is actually present.
  env.GOTOOLCHAIN = 'local';
  env.GOFLAGS = '-mod=mod';
  env.JAVA_TOOL_OPTIONS = '-Dfile.encoding=UTF-8';

  for (const [key, value] of Object.entries(extra)) {
    // Repository-supplied values may never reintroduce a secret-shaped key.
    if (SECRET_PATTERN.test(key)) continue;
    env[key] = value;
  }

  return env;
}

/**
 * Redact secret-looking strings from text before it is logged or persisted.
 * Applied to every line of sandbox output.
 */
export function redact(text: string): string {
  if (!text) return text;
  return (
    text
      // Provider API keys
      .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-***REDACTED***')
      .replace(/sk-proj-[A-Za-z0-9_-]{8,}/g, 'sk-proj-***REDACTED***')
      .replace(/\bsk-[A-Za-z0-9]{20,}\b/g, 'sk-***REDACTED***')
      .replace(/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, 'ghp_***REDACTED***')
      .replace(/\bAKIA[0-9A-Z]{16}\b/g, 'AKIA***REDACTED***')
      // Bearer tokens and inline credentials
      .replace(/(bearer\s+)[A-Za-z0-9._-]{16,}/gi, '$1***REDACTED***')
      .replace(/(https?:\/\/)[^/\s:@]+:[^/\s@]+@/g, '$1***:***@')
      // KEY=value style assignments
      .replace(
        /\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z0-9_]*)\s*[=:]\s*(["']?)([^\s"']{6,})\2/gi,
        '$1=$2***REDACTED***$2',
      )
  );
}

/**
 * Shell metacharacters that must never appear in a value we interpolate into a
 * command line. Used to validate anything repo-derived that reaches a command.
 */
const SHELL_METACHARACTERS = /[;&|`$(){}<>\n\r\\"']/;

export function assertShellSafe(value: string, label: string): string {
  if (SHELL_METACHARACTERS.test(value)) {
    throw new Error(`Unsafe characters in ${label}: ${JSON.stringify(value)}`);
  }
  return value;
}

/** Strip ANSI escapes so logs render cleanly and cannot smuggle terminal control codes. */
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN =
  /[\u001B\u009B][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-nqry=><]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function sanitizeOutput(text: string): string {
  return redact(text.replace(ANSI_PATTERN, '').replace(CONTROL_PATTERN, ''));
}
