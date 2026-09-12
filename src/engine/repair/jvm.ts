import path from 'node:path';
import fs from 'node:fs/promises';
import { pathExists, readFileSafe } from '../fsutil';
import type { RepairAction, RepairEffect } from '../types';

/**
 * Java / JVM repairs.
 *
 * Java breakage clusters tightly around three causes: a source/target level the
 * installed JDK no longer accepts, Java EE packages removed from the JDK in 11,
 * and repositories that stopped serving plain HTTP.
 */

/** The lowest source/target level each JDK generation still accepts. */
export const JDK_MINIMUM_TARGET: Record<number, number> = {
  11: 6,
  17: 7,
  20: 8,
  21: 8,
  22: 8,
  23: 8,
};

export function minimumTargetForJdk(jdkMajor: number): number {
  const known = JDK_MINIMUM_TARGET[jdkMajor];
  if (known) return known;
  return jdkMajor >= 20 ? 8 : 7;
}

export function jvmRepairs(): RepairAction[] {
  return [
    {
      id: 'java-raise-target',
      kind: 'config-patch',
      title: 'Raise the compiler target to the lowest level this JDK still accepts',
      rationale:
        'Modern JDKs refuse to compile for very old source/target levels. Raising to the minimum the installed JDK accepts is the smallest possible change — it keeps the project as close to its original target as the toolchain permits, rather than jumping to the newest level.',
      priority: 10,
      category: 'java-version',
      risk: 'medium',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        // Determine what the running JDK will actually accept.
        const installed = Number.parseInt(ctx.env.actualVersion ?? '17', 10);
        const minimum = minimumTargetForJdk(Number.isFinite(installed) ? installed : 17);
        const touched: string[] = [];

        const pomPath = path.join(ctx.projectDir, 'pom.xml');
        if (await pathExists(pomPath)) {
          const xml = await readFileSafe(pomPath);
          if (xml) {
            let updated = xml;
            const replaceTag = (tag: string) => {
              updated = updated.replace(
                new RegExp(`<${tag}>\\s*([\\d.]+)\\s*</${tag}>`, 'g'),
                (all, value: string) => {
                  const numeric = value.startsWith('1.')
                    ? Number.parseInt(value.slice(2), 10)
                    : Number.parseInt(value, 10);
                  if (Number.isFinite(numeric) && numeric < minimum) {
                    return `<${tag}>${minimum}</${tag}>`;
                  }
                  return all;
                },
              );
            };
            for (const tag of [
              'maven.compiler.source',
              'maven.compiler.target',
              'maven.compiler.release',
              'java.version',
              'source',
              'target',
              'release',
            ]) {
              replaceTag(tag);
            }

            if (updated !== xml) {
              await fs.writeFile(pomPath, updated, 'utf8');
              touched.push('pom.xml');
            }
          }
        }

        for (const gradleFile of ['build.gradle', 'build.gradle.kts']) {
          const full = path.join(ctx.projectDir, gradleFile);
          if (!(await pathExists(full))) continue;
          const text = await readFileSafe(full);
          if (!text) continue;

          const updated = text.replace(
            /(sourceCompatibility|targetCompatibility)\s*=?\s*(['"]?)(?:JavaVersion\.VERSION_)?([\d._]+)\2/g,
            (all, key: string, quote: string, value: string) => {
              const normalized = value.replace(/_/g, '.');
              const numeric = normalized.startsWith('1.')
                ? Number.parseInt(normalized.slice(2), 10)
                : Number.parseInt(normalized, 10);
              if (Number.isFinite(numeric) && numeric < minimum) {
                return `${key} = ${quote || "'"}${minimum}${quote || "'"}`;
              }
              return all;
            },
          );

          if (updated !== text) {
            await fs.writeFile(full, updated, 'utf8');
            touched.push(gradleFile);
          }
        }

        // When Revive is compiling with javac directly (no Maven/Gradle on this
        // machine), the release level is baked into the build command, so
        // editing the build file alone would change nothing. Rewrite the
        // command to match what we just wrote to disk.
        const currentBuild = ctx.detection.commands.build;
        const commandOverrides =
          currentBuild && /--release\s+\d+/.test(currentBuild)
            ? { build: currentBuild.replace(/--release\s+\d+/, `--release ${minimum}`) }
            : undefined;

        return {
          applied: touched.length > 0 || Boolean(commandOverrides),
          description: touched.length
            ? `Raised the Java source/target level to ${minimum} in ${touched.join(', ')} — the lowest level JDK ${installed} still accepts. No application code was changed.`
            : `Raised the compile target to ${minimum} for the javac fallback build.`,
          filesTouched: touched,
          commandOverrides,
        };
      },
    },

    {
      id: 'java-add-jaxb',
      kind: 'dependency-bump',
      title: 'Restore Java EE modules removed from the JDK in Java 11',
      rationale:
        'javax.xml.bind, javax.annotation and javax.activation shipped with the JDK through Java 8 and were removed in Java 11. Adding them back as explicit dependencies restores the exact classes the source already imports, with no source changes.',
      priority: 12,
      category: 'compiler-behavior',
      risk: 'low',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const needed = new Set<string>();
        for (const d of ctx.diagnoses) {
          if (/javax\.xml\.bind/.test(d.evidence)) needed.add('jaxb');
          if (/javax\.annotation/.test(d.evidence)) needed.add('annotation');
          if (/javax\.activation/.test(d.evidence)) needed.add('activation');
        }
        if (!needed.size) {
          return { applied: false, description: 'No removed Java EE package detected.', filesTouched: [] };
        }

        const pomPath = path.join(ctx.projectDir, 'pom.xml');
        if (!(await pathExists(pomPath))) {
          return {
            applied: false,
            description: 'Only Maven projects are patched automatically for this repair.',
            filesTouched: [],
          };
        }

        const xml = await readFileSafe(pomPath);
        if (!xml || !xml.includes('<dependencies>')) {
          return { applied: false, description: 'Could not locate a <dependencies> block.', filesTouched: [] };
        }

        const blocks: string[] = [];
        if (needed.has('jaxb')) {
          blocks.push(
            dependencyXml('javax.xml.bind', 'jaxb-api', '2.3.1'),
            dependencyXml('org.glassfish.jaxb', 'jaxb-runtime', '2.3.9'),
          );
        }
        if (needed.has('annotation')) {
          blocks.push(dependencyXml('javax.annotation', 'javax.annotation-api', '1.3.2'));
        }
        if (needed.has('activation')) {
          blocks.push(dependencyXml('javax.activation', 'javax.activation-api', '1.2.0'));
        }

        const updated = xml.replace('<dependencies>', `<dependencies>\n${blocks.join('\n')}`);
        await fs.writeFile(pomPath, updated, 'utf8');

        return {
          applied: true,
          description: `Added explicit dependencies for Java EE modules removed in Java 11: ${[...needed].join(', ')}.`,
          filesTouched: ['pom.xml'],
        };
      },
    },

    {
      id: 'maven-fix-repositories',
      kind: 'config-patch',
      title: 'Upgrade insecure and retired repository URLs',
      rationale:
        'Maven Central disabled plain HTTP in 2020 and jcenter shut down in 2021. Builds pointing at those endpoints fail at resolution. Rewriting the URLs to their supported HTTPS equivalents restores dependency resolution without touching any dependency versions.',
      priority: 6,
      category: 'network',
      risk: 'low',
      source: 'deterministic',
      async apply(ctx): Promise<RepairEffect> {
        const touched: string[] = [];
        const candidates = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle'];

        for (const file of candidates) {
          const full = path.join(ctx.projectDir, file);
          if (!(await pathExists(full))) continue;
          const text = await readFileSafe(full);
          if (!text) continue;

          let updated = text
            .replace(/http:\/\/repo1\.maven\.org\/maven2/g, 'https://repo1.maven.org/maven2')
            .replace(/http:\/\/repo\.maven\.apache\.org\/maven2/g, 'https://repo.maven.apache.org/maven2')
            .replace(/http:\/\/central\.maven\.org\/maven2/g, 'https://repo1.maven.org/maven2')
            .replace(/https?:\/\/jcenter\.bintray\.com\/?/g, 'https://repo1.maven.org/maven2/')
            .replace(/\bjcenter\(\)/g, 'mavenCentral()');

          if (updated !== text) {
            await fs.writeFile(full, updated, 'utf8');
            touched.push(file);
          }
        }

        return {
          applied: touched.length > 0,
          description: touched.length
            ? `Rewrote retired and insecure repository URLs in ${touched.join(', ')} (HTTP Maven Central to HTTPS, jcenter to Maven Central).`
            : 'No insecure or retired repository URLs found.',
          filesTouched: touched,
        };
      },
    },
  ];
}

function dependencyXml(groupId: string, artifactId: string, version: string): string {
  return `    <dependency>
      <groupId>${groupId}</groupId>
      <artifactId>${artifactId}</artifactId>
      <version>${version}</version>
    </dependency>`;
}
