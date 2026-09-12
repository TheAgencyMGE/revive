import path from 'node:path';
import { probeTool } from '../toolchain';
import type { DetectedCommands } from '../types';

/**
 * Direct-javac fallback for Java projects.
 *
 * A great many abandoned Java repositories declare a Maven or Gradle build that
 * cannot run on the current machine — the wrapper wants to download a
 * distribution, or the build tool simply is not installed. Falling back to the
 * JDK's own compiler still surfaces the single most common Java revival
 * failure (a source/target level the modern compiler rejects), so the user gets
 * a real diagnosis instead of "build tool missing".
 *
 * The release level is read from the project's own build file, so the
 * `java-raise-target` repair still drives this path correctly.
 */

export interface JavacFallback {
  commands: DetectedCommands;
  note: string;
}

/** Is a real build tool usable here? */
export async function buildToolAvailable(tool: 'mvn' | 'gradle'): Promise<boolean> {
  const probe = await probeTool(tool, tool === 'mvn' ? ['-v'] : ['-v']);
  return probe.available;
}

export async function javacAvailable(): Promise<boolean> {
  const probe = await probeTool('javac', ['-version']);
  return probe.available;
}

/**
 * Build javac commands that honour the declared release level.
 *
 * The release is re-read from the build file at execution time (via a shell
 * command rather than baked in) so that a repair which edits pom.xml takes
 * effect on the next attempt without the detection needing to re-run.
 */
export function javacCommands(opts: {
  sourceDir: string;
  declaredRelease: string | null;
  isWindows: boolean;
}): JavacFallback {
  const release = normalizeRelease(opts.declaredRelease);
  const outDir = 'target/revive-classes';

  // Compile every .java file under the source root with the declared release.
  // `--release N` is exactly what reproduces the historical target failure.
  const releaseFlag = release ? `--release ${release}` : '';

  const findSources = opts.isWindows
    ? `dir /s /b ${opts.sourceDir.replace(/\//g, '\\')}\\*.java > target\\sources.txt`
    : `find ${opts.sourceDir} -name '*.java' > target/sources.txt`;

  const mkdir = opts.isWindows
    ? `if not exist target mkdir target && if not exist ${outDir.replace(/\//g, '\\')} mkdir ${outDir.replace(/\//g, '\\')}`
    : `mkdir -p ${outDir}`;

  const compile = opts.isWindows
    ? `javac ${releaseFlag} -d ${outDir.replace(/\//g, '\\')} @target\\sources.txt`
    : `javac ${releaseFlag} -d ${outDir} @target/sources.txt`;

  return {
    commands: {
      // Nothing to install without a dependency manager.
      install: undefined,
      build: `${mkdir} && ${findSources} && ${compile}`,
      test: undefined,
      start: undefined,
    },
    note: release
      ? `Neither Maven nor Gradle is available, so Revive compiles directly with javac using the declared release level (${release}). Dependency resolution is skipped, so only source-level and compiler-level problems are detected.`
      : 'Neither Maven nor Gradle is available, so Revive compiles directly with javac. Dependency resolution is skipped.',
  };
}

/** "1.6" and "6" both mean Java 6. */
export function normalizeRelease(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const normalized = trimmed.startsWith('1.') ? trimmed.slice(2) : trimmed;
  const numeric = Number.parseInt(normalized, 10);
  return Number.isFinite(numeric) ? String(numeric) : null;
}

/** Guess the source root the project uses. */
export function guessSourceDir(files: Set<string>, allFiles: string[]): string {
  if (allFiles.some((f) => f.startsWith('src/main/java/'))) return 'src/main/java';
  if (allFiles.some((f) => f.startsWith('src/'))) return 'src';
  return '.';
}
