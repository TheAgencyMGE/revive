import path from 'node:path';
import { readFileSafe } from '../fsutil';
import type { DependencySpec, DetectionResult } from '../types';
import type { AdapterContext } from './index';
import { emptyDetection } from './index';

export interface GoMod {
  module: string | null;
  goVersion: string | null;
  dependencies: DependencySpec[];
}

/** Minimal go.mod parser — enough for module path, go directive and requires. */
export function parseGoMod(text: string): GoMod {
  const result: GoMod = { module: null, goVersion: null, dependencies: [] };
  let inRequireBlock = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.split('//')[0].trim();
    if (!line) continue;

    if (line.startsWith('module ')) {
      result.module = line.slice(7).trim();
      continue;
    }
    if (/^go\s+[\d.]+$/.test(line)) {
      result.goVersion = line.split(/\s+/)[1];
      continue;
    }
    if (line.startsWith('require (')) {
      inRequireBlock = true;
      continue;
    }
    if (inRequireBlock && line === ')') {
      inRequireBlock = false;
      continue;
    }

    const requireLine = inRequireBlock ? line : line.startsWith('require ') ? line.slice(8) : null;
    if (requireLine) {
      const parts = requireLine.split(/\s+/);
      if (parts.length >= 2) {
        result.dependencies.push({
          name: parts[0],
          range: parts[1],
          dev: requireLine.includes('// indirect'),
        });
      }
    }
  }
  return result;
}

export async function detectGo(ctx: AdapterContext): Promise<DetectionResult> {
  const result = emptyDetection();
  result.language = 'go';
  result.packageManager = 'gomod';
  result.moduleSystem = 'n/a';

  if (ctx.present.has('go.mod')) {
    result.manifestFiles.push('go.mod');
    const text = await readFileSafe(path.join(ctx.projectDir, 'go.mod'));
    if (text) {
      const mod = parseGoMod(text);
      result.dependencies = mod.dependencies;
      if (mod.goVersion) {
        result.frameworkVersion = mod.goVersion;
        result.notes.push(`go.mod declares go ${mod.goVersion}.`);
      }
      if (mod.module) result.notes.push(`Module path: ${mod.module}.`);

      const names = mod.dependencies.map((d) => d.name);
      if (names.some((n) => n.includes('gin-gonic/gin'))) result.framework = 'Gin';
      else if (names.some((n) => n.includes('labstack/echo'))) result.framework = 'Echo';
      else if (names.some((n) => n.includes('gofiber/fiber'))) result.framework = 'Fiber';
      else if (names.some((n) => n.includes('gorilla/mux'))) result.framework = 'Gorilla Mux';
    }
  } else {
    // Pre-modules project (GOPATH era) — a real revival signal in itself.
    result.notes.push(
      'No go.mod found — this predates Go modules (Go < 1.11) and needs module initialisation.',
    );
  }

  if (ctx.present.has('go.sum')) {
    result.lockfiles.push('go.sum');
    result.hasLockfile = true;
  }
  if (ctx.present.has('Gopkg.toml')) {
    result.manifestFiles.push('Gopkg.toml');
    result.notes.push('Gopkg.toml indicates the retired `dep` tool was used for vendoring.');
  }

  result.commands.install = 'go mod download';
  result.commands.build = 'go build ./...';
  result.commands.test = 'go test ./...';

  if (ctx.present.has('main.go')) {
    result.commands.start = 'go run main.go';
  } else if (ctx.files.some((f) => f.startsWith('cmd/'))) {
    result.commands.start = 'go run ./cmd/...';
  }

  return result;
}
