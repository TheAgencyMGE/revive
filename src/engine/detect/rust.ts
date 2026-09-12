import path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { readFileSafe } from '../fsutil';
import type { DependencySpec, DetectionResult } from '../types';
import type { AdapterContext } from './index';
import { emptyDetection } from './index';

export interface CargoInfo {
  name: string | null;
  version: string | null;
  edition: string | null;
  rustVersion: string | null;
  dependencies: DependencySpec[];
  isWorkspace: boolean;
}

export function parseCargoToml(text: string): CargoInfo {
  const info: CargoInfo = {
    name: null,
    version: null,
    edition: null,
    rustVersion: null,
    dependencies: [],
    isWorkspace: false,
  };

  let toml: Record<string, any>;
  try {
    toml = parseToml(text) as Record<string, any>;
  } catch {
    return info;
  }

  info.isWorkspace = Boolean(toml.workspace);
  const pkg = toml.package ?? {};
  info.name = pkg.name ?? null;
  info.version = pkg.version ?? null;
  info.edition = pkg.edition ? String(pkg.edition) : null;
  info.rustVersion = pkg['rust-version'] ? String(pkg['rust-version']) : null;

  const collect = (table: Record<string, any> | undefined, dev: boolean) => {
    for (const [name, spec] of Object.entries(table ?? {})) {
      let range = '*';
      if (typeof spec === 'string') range = spec;
      else if (spec && typeof spec === 'object') {
        range = spec.version ? String(spec.version) : spec.git ? `git:${spec.git}` : '*';
      }
      info.dependencies.push({ name, range, dev });
    }
  };
  collect(toml.dependencies, false);
  collect(toml['dev-dependencies'], true);
  collect(toml['build-dependencies'], true);

  return info;
}

export async function detectRust(ctx: AdapterContext): Promise<DetectionResult> {
  const result = emptyDetection();
  result.language = 'rust';
  result.packageManager = 'cargo';
  result.moduleSystem = 'n/a';

  if (ctx.present.has('Cargo.toml')) {
    result.manifestFiles.push('Cargo.toml');
    const text = await readFileSafe(path.join(ctx.projectDir, 'Cargo.toml'));
    if (text) {
      const cargo = parseCargoToml(text);
      result.dependencies = cargo.dependencies;

      if (cargo.edition) {
        result.frameworkVersion = cargo.edition;
        result.notes.push(`Cargo.toml declares edition ${cargo.edition}.`);
        // Edition is the strongest dating signal in the Rust ecosystem.
        if (cargo.edition === '2015') {
          result.notes.push(
            'Edition 2015 predates Rust 2018 — expect `extern crate` and module-path differences.',
          );
        }
      }
      if (cargo.rustVersion) {
        result.notes.push(`Minimum supported Rust version: ${cargo.rustVersion}.`);
      }
      if (cargo.isWorkspace) result.notes.push('Cargo workspace root detected.');

      const names = cargo.dependencies.map((d) => d.name);
      if (names.includes('actix-web')) result.framework = 'Actix Web';
      else if (names.includes('rocket')) result.framework = 'Rocket';
      else if (names.includes('axum')) result.framework = 'Axum';
      else if (names.includes('tokio')) result.framework = 'Tokio';
      else if (names.includes('clap')) result.framework = 'Clap CLI';
    }
  }

  if (ctx.present.has('Cargo.lock')) {
    result.lockfiles.push('Cargo.lock');
    result.hasLockfile = true;
    const lock = await readFileSafe(path.join(ctx.projectDir, 'Cargo.lock'));
    const versionMatch = lock?.match(/^version\s*=\s*(\d+)/m);
    if (versionMatch) {
      result.lockfileVersion = versionMatch[1];
      result.notes.push(`Cargo.lock format version ${versionMatch[1]}.`);
    }
  }

  if (ctx.present.has('rust-toolchain.toml') || ctx.present.has('rust-toolchain')) {
    const file = ctx.present.has('rust-toolchain.toml') ? 'rust-toolchain.toml' : 'rust-toolchain';
    result.manifestFiles.push(file);
    result.notes.push(`${file} pins a specific Rust toolchain.`);
  }

  result.commands.install = 'cargo fetch';
  result.commands.build = 'cargo build';
  result.commands.test = 'cargo test';
  if (ctx.files.some((f) => f === 'src/main.rs')) {
    result.commands.start = 'cargo run';
  }

  return result;
}
