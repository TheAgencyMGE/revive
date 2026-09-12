import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';
import { readFileSafe } from '../fsutil';
import type { DependencySpec, DetectionResult } from '../types';
import type { AdapterContext } from './index';
import { emptyDetection } from './index';
import {
  buildToolAvailable,
  guessSourceDir,
  javacAvailable,
  javacCommands,
  normalizeRelease,
} from './javac-fallback';

export interface PomInfo {
  groupId: string | null;
  artifactId: string | null;
  version: string | null;
  javaSource: string | null;
  javaTarget: string | null;
  springBootVersion: string | null;
  dependencies: DependencySpec[];
}

/**
 * Extract the fields that matter for revival from a pom.xml.
 * Java projects fail overwhelmingly on source/target level mismatches, so those
 * are pulled out explicitly rather than left in a generic property bag.
 */
export function parsePom(xml: string): PomInfo {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: true,
  });
  const info: PomInfo = {
    groupId: null,
    artifactId: null,
    version: null,
    javaSource: null,
    javaTarget: null,
    springBootVersion: null,
    dependencies: [],
  };

  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch {
    return info;
  }
  const project = doc?.project;
  if (!project) return info;

  info.groupId = project.groupId ?? project.parent?.groupId ?? null;
  info.artifactId = project.artifactId ?? null;
  info.version = project.version ?? project.parent?.version ?? null;

  const props = project.properties ?? {};
  info.javaSource =
    props['maven.compiler.source'] ?? props['java.version'] ?? props['maven.compiler.release'] ?? null;
  info.javaTarget =
    props['maven.compiler.target'] ?? props['java.version'] ?? props['maven.compiler.release'] ?? null;

  // Compiler plugin configuration overrides properties.
  const plugins = toArray(project.build?.plugins?.plugin);
  for (const plugin of plugins) {
    if (plugin?.artifactId === 'maven-compiler-plugin') {
      const cfg = plugin.configuration ?? {};
      if (cfg.source) info.javaSource = String(cfg.source);
      if (cfg.target) info.javaTarget = String(cfg.target);
      if (cfg.release) {
        info.javaSource = String(cfg.release);
        info.javaTarget = String(cfg.release);
      }
    }
  }

  const parentArtifact = project.parent?.artifactId;
  if (parentArtifact === 'spring-boot-starter-parent') {
    info.springBootVersion = project.parent?.version ? String(project.parent.version) : null;
  }

  for (const dep of toArray(project.dependencies?.dependency)) {
    if (!dep?.artifactId) continue;
    info.dependencies.push({
      name: `${dep.groupId ?? ''}:${dep.artifactId}`,
      range: dep.version ? String(dep.version) : 'managed',
      scope: dep.scope ? String(dep.scope) : undefined,
      dev: dep.scope === 'test',
    });
  }

  return info;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Pull sourceCompatibility / dependency coordinates out of a Gradle build script. */
export function parseGradle(text: string): {
  javaVersion: string | null;
  dependencies: DependencySpec[];
  springBootVersion: string | null;
} {
  const javaMatch =
    text.match(/sourceCompatibility\s*=?\s*['"]?(?:JavaVersion\.VERSION_)?([\d._]+)['"]?/) ??
    text.match(/languageVersion\s*=\s*JavaLanguageVersion\.of\((\d+)\)/) ??
    text.match(/targetCompatibility\s*=?\s*['"]?(?:JavaVersion\.VERSION_)?([\d._]+)['"]?/);
  const javaVersion = javaMatch ? javaMatch[1].replace(/_/g, '.') : null;

  const springMatch = text.match(
    /id\s*\(?['"]org\.springframework\.boot['"]\)?\s*version\s*['"]([^'"]+)['"]/,
  );

  const dependencies: DependencySpec[] = [];
  const depPattern =
    /(?:implementation|api|compile|testImplementation|testCompile|runtimeOnly|compileOnly)\s*[( ]\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = depPattern.exec(text)) !== null) {
    const coord = match[1];
    const parts = coord.split(':');
    if (parts.length >= 2) {
      dependencies.push({
        name: `${parts[0]}:${parts[1]}`,
        range: parts[2] ?? 'managed',
      });
    }
  }

  return { javaVersion, dependencies, springBootVersion: springMatch ? springMatch[1] : null };
}

export async function detectJava(ctx: AdapterContext): Promise<DetectionResult> {
  const result = emptyDetection();
  result.language = 'java';
  result.moduleSystem = 'n/a';

  if (ctx.present.has('pom.xml')) {
    result.packageManager = 'maven';
    result.manifestFiles.push('pom.xml');
    const xml = await readFileSafe(path.join(ctx.projectDir, 'pom.xml'));
    if (xml) {
      const pom = parsePom(xml);
      result.dependencies = pom.dependencies;
      if (pom.javaTarget) {
        result.notes.push(`pom.xml targets Java ${pom.javaTarget}.`);
        result.frameworkVersion = pom.javaTarget;
      }
      if (pom.springBootVersion) {
        result.framework = 'Spring Boot';
        result.frameworkVersion = pom.springBootVersion;
        result.notes.push(`Spring Boot ${pom.springBootVersion} (parent POM).`);
      }
    }

    // Prefer the wrapper when the repo ships one — it pins the Maven version.
    const wrapper = ctx.present.has('mvnw') || ctx.present.has('mvnw.cmd');
    const mvn = wrapper ? (process.platform === 'win32' ? 'mvnw.cmd' : './mvnw') : 'mvn';
    if (wrapper) result.notes.push('Maven wrapper (mvnw) is present and will be used.');

    if (await buildToolAvailable('mvn')) {
      result.commands.install = `${mvn} -B -q dependency:resolve`;
      result.commands.build = `${mvn} -B -DskipTests package`;
      result.commands.test = `${mvn} -B test`;
    } else {
      await applyJavacFallback(ctx, result);
    }
  } else if (ctx.present.has('build.gradle') || ctx.present.has('build.gradle.kts')) {
    result.packageManager = 'gradle';
    const gradleFile = ctx.present.has('build.gradle') ? 'build.gradle' : 'build.gradle.kts';
    result.manifestFiles.push(gradleFile);

    const text = await readFileSafe(path.join(ctx.projectDir, gradleFile));
    if (text) {
      const parsed = parseGradle(text);
      result.dependencies = parsed.dependencies;
      if (parsed.javaVersion) {
        result.notes.push(`Gradle build targets Java ${parsed.javaVersion}.`);
        result.frameworkVersion = parsed.javaVersion;
      }
      if (parsed.springBootVersion) {
        result.framework = 'Spring Boot';
        result.frameworkVersion = parsed.springBootVersion;
      }
    }

    const wrapper = ctx.present.has('gradlew') || ctx.present.has('gradlew.bat');
    const gradle = wrapper ? (process.platform === 'win32' ? 'gradlew.bat' : './gradlew') : 'gradle';
    if (wrapper) {
      result.notes.push('Gradle wrapper is present and will be used.');
      const props = await readFileSafe(
        path.join(ctx.projectDir, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
      );
      const versionMatch = props?.match(/gradle-([\d.]+)-(?:bin|all)\.zip/);
      if (versionMatch) {
        result.lockfileVersion = versionMatch[1];
        result.notes.push(`Gradle wrapper pins Gradle ${versionMatch[1]}.`);
      }
    }

    if (await buildToolAvailable('gradle')) {
      result.commands.install = `${gradle} --no-daemon dependencies`;
      result.commands.build = `${gradle} --no-daemon build -x test`;
      result.commands.test = `${gradle} --no-daemon test`;
    } else {
      await applyJavacFallback(ctx, result);
    }
  }

  return result;
}

/**
 * Swap in the javac fallback when no build tool is usable, so a Java project
 * still gets a real compile attempt instead of an immediate dead end.
 */
async function applyJavacFallback(
  ctx: AdapterContext,
  result: DetectionResult,
): Promise<void> {
  if (!(await javacAvailable())) {
    result.notes.push(
      'Neither Maven, Gradle nor javac is available on this machine, so this Java project cannot be compiled here. Static analysis is still reported.',
    );
    return;
  }

  const sourceDir = guessSourceDir(ctx.present, ctx.files);
  const fallback = javacCommands({
    sourceDir,
    declaredRelease: normalizeRelease(result.frameworkVersion),
    isWindows: process.platform === 'win32',
  });

  result.commands = { ...result.commands, ...fallback.commands };
  result.notes.push(fallback.note);
}
