import type { Diagnosis, FailureCategory, StepName } from '../types';

/**
 * Deterministic failure classification rules.
 *
 * Each rule is a pattern plus the knowledge of what that pattern actually
 * means for an abandoned project. This is the core of Revive working without
 * any AI: the vast majority of legacy build failures produce highly
 * recognisable output, and naming the cause precisely is what makes the repair
 * minimal rather than a blind upgrade.
 */

export interface ClassifyRule {
  id: string;
  /** Matched against combined stdout+stderr. */
  pattern: RegExp;
  /** Optional second pattern that must also match — reduces false positives. */
  also?: RegExp;
  /** Optional pattern that must NOT match. */
  not?: RegExp;
  category: FailureCategory;
  severity: 'blocker' | 'major' | 'minor';
  confidence: number;
  title: string;
  /** Build the explanation; `match` is the regex result for capture groups. */
  detail: (match: RegExpMatchArray) => string;
  repairs: string[];
  /** Restrict the rule to particular steps. */
  steps?: StepName[];
}

export const RULES: ClassifyRule[] = [
  // -------------------------------------------------------------------------
  // Node: runtime version
  // -------------------------------------------------------------------------
  {
    id: 'node-engine-unsupported',
    pattern: /(?:EBADENGINE|Unsupported engine)/i,
    category: 'runtime-version',
    severity: 'major',
    confidence: 90,
    title: 'Declared Node engine does not match the running Node version',
    detail: () =>
      'The package declares an `engines.node` range that the current Node version does not satisfy. npm warns rather than fails for this, but it reliably predicts downstream native-module and syntax failures.',
    repairs: ['node-use-declared-runtime', 'npm-ignore-engines'],
  },
  {
    id: 'node-openssl-md4',
    pattern: /error:0308010C:digital envelope routines::unsupported|ERR_OSSL_EVP_UNSUPPORTED/,
    category: 'runtime-version',
    severity: 'blocker',
    confidence: 98,
    title: 'Webpack 4 hashing is incompatible with the OpenSSL 3 shipped in Node 17+',
    detail: () =>
      'Webpack 4 defaults to the MD4 hash, which OpenSSL 3 (bundled with Node 17 and newer) removed. The build crashes immediately with ERR_OSSL_EVP_UNSUPPORTED. The historically correct environment is Node 16 or earlier; the minimal in-place workaround is to re-enable the legacy provider.',
    repairs: ['node-openssl-legacy', 'node-use-declared-runtime'],
  },
  {
    id: 'node-syntax-optional-chaining',
    pattern: /SyntaxError:\s*(?:Unexpected token\s*'?\.'?|Invalid or unexpected token)/,
    also: /\?\.|\?\?/,
    category: 'runtime-version',
    severity: 'blocker',
    confidence: 70,
    title: 'Source uses syntax the running Node version cannot parse',
    detail: () =>
      'Optional chaining (?.) and nullish coalescing (??) require Node 14 or newer. Seeing this means the runtime is older than the source expects.',
    repairs: ['node-use-declared-runtime'],
  },

  // -------------------------------------------------------------------------
  // Node: node-sass / native modules
  // -------------------------------------------------------------------------
  {
    id: 'node-sass-binding',
    pattern: /node-sass|Missing binding|Node Sass (?:could not find|does not yet support)/i,
    category: 'node-sass',
    severity: 'blocker',
    confidence: 95,
    title: 'node-sass cannot build or find a binary for this Node version',
    detail: (m) =>
      `node-sass ships prebuilt binaries per Node ABI and was deprecated in 2020. ${
        /does not yet support/i.test(m[0])
          ? 'The installed version predates the running Node release, so no binary exists.'
          : 'The native binding is missing and a source rebuild requires a full C++ toolchain.'
      } The maintained drop-in replacement is dart-sass, published as \`sass\`, which is pure JavaScript and needs no native build.`,
    repairs: ['node-sass-to-dart-sass'],
  },
  {
    id: 'node-gyp-failure',
    pattern: /node-gyp|gyp ERR!|MSBuild|Could not find any Visual Studio installation/i,
    not: /node-sass/i,
    category: 'native-module',
    severity: 'blocker',
    confidence: 85,
    title: 'A native module failed to compile',
    detail: () =>
      'A dependency requires node-gyp to compile C/C++ sources against the current Node ABI. This fails when the package predates the running Node version or when no compiler toolchain is present. The fix is usually a newer release of the same package that ships prebuilt binaries.',
    repairs: ['native-module-bump', 'node-use-declared-runtime'],
  },

  // -------------------------------------------------------------------------
  // Node: dependency resolution
  // -------------------------------------------------------------------------
  {
    id: 'npm-404',
    pattern: /npm ERR! 404\s+.*?'([^']+)'|404 Not Found.*?\/([\w@/.-]+)/i,
    category: 'dead-package',
    severity: 'blocker',
    confidence: 92,
    title: 'A dependency no longer exists in the registry',
    detail: (m) => {
      const name = (m[1] || m[2] || 'the package').replace(/^-\s*/, '');
      return `\`${name}\` returned 404 from the npm registry — it was unpublished, renamed, or was never public. Installation cannot proceed until the reference is replaced or removed.`;
    },
    repairs: ['dead-package-replace', 'dead-package-remove'],
  },
  {
    id: 'npm-peer-conflict',
    pattern: /ERESOLVE|could not resolve dependency|Conflicting peer dependency/i,
    category: 'peer-conflict',
    severity: 'blocker',
    confidence: 94,
    title: 'Peer dependency conflict blocks installation',
    detail: () =>
      'npm 7 made peer dependency conflicts a hard error where npm 6 silently ignored them. A project last installed under npm 6 will often fail here without anything in the project having changed. Installing with the legacy peer-dependency behaviour reproduces the original, working resolution.',
    repairs: ['npm-legacy-peer-deps'],
  },
  {
    id: 'npm-ci-lock-mismatch',
    pattern: /npm ci.*can only install packages when your package\.json and package-lock\.json|`npm ci` can only install/i,
    category: 'broken-lockfile',
    severity: 'blocker',
    confidence: 96,
    title: 'Lockfile is out of sync with package.json',
    detail: () =>
      '`npm ci` requires the lockfile to match package.json exactly and refuses to reconcile drift. The lockfile is stale relative to the manifest.',
    repairs: ['npm-install-instead-of-ci', 'lockfile-regenerate'],
  },
  {
    id: 'npm-lock-integrity',
    pattern: /EINTEGRITY|integrity checksum failed|sha1-[A-Za-z0-9+/=]+ integrity/i,
    category: 'broken-lockfile',
    severity: 'blocker',
    confidence: 90,
    title: 'Lockfile integrity hashes are invalid',
    detail: () =>
      'The lockfile records integrity hashes that no longer match what the registry serves. This happens with lockfiles written against the legacy registry or after a package was republished. Regenerating the lockfile from the manifest restores a resolvable tree.',
    repairs: ['lockfile-regenerate'],
  },
  {
    id: 'npm-etarget',
    pattern: /ETARGET|No matching version found for ([^\s]+)/i,
    category: 'obsolete-dependency',
    severity: 'blocker',
    confidence: 90,
    title: 'A pinned dependency version no longer exists',
    detail: (m) =>
      `No published version satisfies the requested range${m[1] ? ` for \`${m[1]}\`` : ''}. The version was most likely unpublished or the range references a pre-release that was removed.`,
    repairs: ['dependency-relax-range', 'lockfile-regenerate'],
  },

  // -------------------------------------------------------------------------
  // Node: module system
  // -------------------------------------------------------------------------
  {
    id: 'esm-require-error',
    pattern: /ERR_REQUIRE_ESM|require\(\) of ES Module|Must use import to load ES Module/i,
    category: 'module-system',
    severity: 'blocker',
    confidence: 95,
    title: 'A CommonJS file is requiring an ES-module-only dependency',
    detail: () =>
      'A dependency published a breaking major that switched to ESM-only. CommonJS `require()` cannot load it. The minimal repair is to pin the dependency back to its last CommonJS release, which preserves the original code exactly.',
    repairs: ['esm-pin-cjs-version'],
  },
  {
    id: 'cjs-in-esm-package',
    pattern:
      /(?:require|module|exports|__dirname|__filename) is not defined in ES module scope|ReferenceError: require is not defined/,
    category: 'module-system',
    severity: 'blocker',
    confidence: 96,
    title: 'Package is declared as ESM but the source is still CommonJS',
    detail: () =>
      'package.json sets "type": "module", which makes Node treat every .js file as an ES module, but the source still uses require/module.exports. This is the signature of an ES module migration that was started and abandoned. Removing the declaration restores the CommonJS behaviour the code was actually written for, which is far less invasive than rewriting every file.',
    repairs: ['esm-remove-type-module'],
  },
  {
    id: 'esm-import-outside-module',
    pattern: /Cannot use import statement outside a module|SyntaxError: Unexpected token 'export'/i,
    category: 'module-system',
    severity: 'blocker',
    confidence: 88,
    title: 'ES module syntax is being parsed as CommonJS',
    detail: () =>
      'The file uses `import`/`export` but Node is treating it as CommonJS. Either package.json is missing `"type": "module"`, or a transpile step that used to run is no longer wired up.',
    repairs: ['esm-set-type-module'],
  },
  {
    id: 'module-not-found',
    pattern: /Cannot find module ['"]([^'"]+)['"]|Module not found: Error: Can't resolve ['"]([^'"]+)['"]/,
    category: 'obsolete-dependency',
    severity: 'blocker',
    confidence: 75,
    title: 'A required module is not installed',
    detail: (m) => {
      const name = m[1] || m[2] || 'a module';
      return `\`${name}\` could not be resolved. Either installation did not complete, or the package is a transitive dependency that a newer resolver no longer hoists to the top level.`;
    },
    repairs: ['install-missing-module'],
  },

  // -------------------------------------------------------------------------
  // Node: bundlers / transpilers
  // -------------------------------------------------------------------------
  {
    id: 'webpack-config-schema',
    pattern: /Invalid configuration object.*webpack|configuration has an unknown property/i,
    category: 'bundler-incompat',
    severity: 'blocker',
    confidence: 88,
    title: 'Webpack configuration uses options from a different major version',
    detail: () =>
      'The webpack config validates against a schema from a different major release — options were renamed or removed between webpack 3, 4 and 5. Restoring the webpack version the config was written for is less invasive than rewriting the config.',
    repairs: ['webpack-pin-major'],
  },
  {
    id: 'webpack5-polyfill',
    pattern: /BREAKING CHANGE: webpack < 5 used to include polyfills|Can't resolve '(?:crypto|stream|buffer|path|os|http|https|zlib|util|assert)'/,
    category: 'bundler-incompat',
    severity: 'blocker',
    confidence: 92,
    title: 'Webpack 5 removed automatic Node core-module polyfills',
    detail: () =>
      'Webpack 4 automatically polyfilled Node core modules for the browser; webpack 5 removed that behaviour and fails to resolve them. The project was written against webpack 4 semantics.',
    repairs: ['webpack-pin-major', 'webpack-add-fallbacks'],
  },
  {
    id: 'babel-preset-missing',
    pattern: /Cannot find (?:module|package) ['"](?:babel-preset-|@babel\/preset-)([^'"]+)['"]|Plugin\/Preset files are not allowed to export objects/i,
    category: 'build-config',
    severity: 'blocker',
    confidence: 85,
    title: 'Babel configuration references a preset from a different Babel major',
    detail: () =>
      'Babel 6 (`babel-preset-*`, `babel-core`) and Babel 7 (`@babel/preset-*`, `@babel/core`) use incompatible package names and plugin formats. The configuration and the installed Babel disagree.',
    repairs: ['babel-align-major'],
  },

  // -------------------------------------------------------------------------
  // Python
  // -------------------------------------------------------------------------
  {
    id: 'python-venv-unavailable',
    pattern:
      /ensurepip|Command .*(?:venv|ensurepip).*returned non-zero exit status|No module named venv|venv: command not found|The virtual environment was not created successfully/i,
    category: 'missing-toolchain',
    severity: 'blocker',
    confidence: 90,
    title: 'This Python installation cannot create a virtual environment',
    detail: () =>
      'Creating the isolated virtualenv failed. The usual causes are the Microsoft Store build of Python (whose ensurepip fails outside an app context), a distribution that ships python3-venv separately, or a locked-down environment. The virtualenv is only a hygiene measure, so Revive falls back to the system interpreter and continues the diagnosis rather than stopping here.',
    repairs: ['python-venv-fallback'],
  },
  {
    id: 'python2-print',
    pattern: /Missing parentheses in call to ['"]print['"]|SyntaxError.*print/,
    category: 'python-version',
    severity: 'blocker',
    confidence: 96,
    title: 'Python 2 source is being run by a Python 3 interpreter',
    detail: () =>
      '`print` as a statement rather than a function is Python 2 syntax. Python 3 rejects it at parse time. This project was written for Python 2.7, which reached end of life in January 2020.',
    repairs: ['python-2to3', 'python-use-declared-runtime'],
  },
  {
    id: 'python-imp-removed',
    pattern: /ModuleNotFoundError: No module named ['"](imp|distutils|asyncore|smtpd|cgi|telnetlib)['"]/,
    category: 'compiler-behavior',
    severity: 'blocker',
    confidence: 94,
    title: 'A standard-library module removed in a newer Python is still imported',
    detail: (m) => {
      const mod = m[1];
      const removals: Record<string, string> = {
        imp: 'removed in Python 3.12 (use importlib)',
        distutils: 'removed in Python 3.12 (use setuptools)',
        asyncore: 'removed in Python 3.12',
        smtpd: 'removed in Python 3.12',
        cgi: 'removed in Python 3.13',
        telnetlib: 'removed in Python 3.13',
      };
      return `\`${mod}\` was ${removals[mod] ?? 'removed from the standard library'}. The project predates that removal, so running it on the interpreter it was written for is the faithful repair.`;
    },
    repairs: ['python-use-declared-runtime', 'python-install-shim'],
  },
  {
    id: 'python-setuptools-missing',
    pattern: /No module named ['"]setuptools['"]|error in .* setup command|use_2to3 is invalid/,
    category: 'build-config',
    severity: 'blocker',
    confidence: 85,
    title: 'setuptools behaviour the package relies on has been removed',
    detail: () =>
      'Modern setuptools removed `use_2to3` and implicit distutils patching. Packages built before setuptools 58 frequently fail to install against current tooling. Pinning setuptools to the era the package targeted restores the original install path.',
    repairs: ['python-pin-setuptools'],
  },
  {
    id: 'python-metadata-generation',
    pattern: /metadata-generation-failed|error: subprocess-exited-with-error|Preparing metadata \(pyproject\.toml\).*error/,
    category: 'obsolete-dependency',
    severity: 'blocker',
    confidence: 75,
    title: 'A dependency cannot build metadata under modern pip',
    detail: () =>
      'pip 23 removed the legacy `setup.py install` fallback. Packages without wheels that relied on it now fail during metadata generation. Either a newer release of the package ships wheels, or pip must be pinned to the behaviour the project expected.',
    repairs: ['python-pin-pip', 'dependency-relax-range'],
  },
  {
    id: 'python-no-matching-distribution',
    pattern: /No matching distribution found for ([\w.-]+)|Could not find a version that satisfies the requirement ([\w.-]+)/,
    category: 'obsolete-dependency',
    severity: 'blocker',
    confidence: 90,
    title: 'A pinned Python package version is unavailable for this interpreter',
    detail: (m) => {
      const name = m[1] || m[2] || 'a dependency';
      return `No distribution of \`${name}\` satisfies the pinned requirement on this interpreter. Older packages frequently have no wheels for newer Python versions, so the pin is unsatisfiable rather than wrong.`;
    },
    repairs: ['python-relax-pin', 'python-use-declared-runtime'],
  },

  // -------------------------------------------------------------------------
  // Java
  // -------------------------------------------------------------------------
  {
    id: 'java-source-option-removed',
    pattern:
      /(?:Source|Target) option ([\d.]+) is no longer supported|invalid (?:source|target) release: ?([\d.]+)|release version ([\d.]+) not supported/i,
    category: 'java-version',
    severity: 'blocker',
    confidence: 97,
    title: 'The configured Java source/target level is no longer supported by this JDK',
    detail: (m) => {
      const version = m[1] || m[2] || m[3] || 'the configured level';
      return `This JDK refuses to compile for source/target ${version}. Modern JDKs drop support for very old release levels — JDK 21 accepts nothing below 8. The project targets a level older than the installed compiler accepts, which is a build-configuration problem rather than anything wrong with the code.`;
    },
    repairs: ['java-raise-target', 'java-use-declared-runtime'],
  },
  {
    id: 'java-unsupported-class-version',
    pattern: /UnsupportedClassVersionError.*?class file version (\d+\.\d+)|has been compiled by a more recent version/,
    category: 'java-version',
    severity: 'blocker',
    confidence: 95,
    title: 'Compiled classes target a newer JVM than the one running them',
    detail: () =>
      'A dependency was compiled for a newer class-file version than the running JVM supports. The runtime JDK is older than the dependency requires.',
    repairs: ['java-use-declared-runtime'],
  },
  {
    id: 'java-package-removed',
    pattern: /package (javax\.xml\.bind|javax\.annotation|javax\.activation|com\.sun\.[\w.]+) does not exist/,
    category: 'compiler-behavior',
    severity: 'blocker',
    confidence: 93,
    title: 'A Java EE package removed from the JDK is still imported',
    detail: (m) =>
      `\`${m[1]}\` was part of the JDK through Java 8, deprecated in Java 9, and removed in Java 11. Projects written for Java 8 fail to compile on modern JDKs until the module is added back as an explicit dependency.`,
    repairs: ['java-add-jaxb', 'java-use-declared-runtime'],
  },
  {
    id: 'maven-plugin-resolution',
    pattern: /Plugin ([\w.:-]+) or one of its dependencies could not be resolved|Could not resolve dependencies for project/,
    category: 'obsolete-dependency',
    severity: 'blocker',
    confidence: 85,
    title: 'A Maven plugin or dependency cannot be resolved',
    detail: () =>
      'Maven could not resolve a plugin or dependency. Common causes are a repository that has shut down (jcenter, Maven Central over plain HTTP) or a version that was removed.',
    repairs: ['maven-fix-repositories', 'dependency-relax-range'],
  },
  {
    id: 'maven-http-blocked',
    pattern: /Blocked mirror for repositories|HTTP Status 501.*HTTPS Required|repository.*was blocked because it uses an insecure protocol/i,
    category: 'network',
    severity: 'blocker',
    confidence: 95,
    title: 'Build references a repository over insecure HTTP',
    detail: () =>
      'Maven Central disabled plain HTTP in 2020 and Maven now blocks insecure repository URLs outright. Builds written before that date still point at http:// endpoints.',
    repairs: ['maven-fix-repositories'],
  },

  // -------------------------------------------------------------------------
  // Go
  // -------------------------------------------------------------------------
  {
    id: 'go-missing-gomod',
    pattern: /go: cannot find main module|go\.mod file not found|GO111MODULE=off/,
    category: 'build-config',
    severity: 'blocker',
    confidence: 92,
    title: 'Project predates Go modules',
    detail: () =>
      'The project has no go.mod, so it was written for the GOPATH workflow used before Go 1.11. Modern Go toolchains require a module definition.',
    repairs: ['go-init-module'],
  },
  {
    id: 'go-version-too-old',
    pattern: /go\.mod requires go >= ([\d.]+)|requires go ([\d.]+) or later|note: module requires Go ([\d.]+)/,
    category: 'runtime-version',
    severity: 'blocker',
    confidence: 90,
    title: 'Module requires a newer Go toolchain than is installed',
    detail: (m) =>
      `The module declares a minimum Go version of ${m[1] || m[2] || m[3]}, which exceeds the installed toolchain.`,
    repairs: ['go-use-declared-runtime', 'go-lower-directive'],
  },
  {
    id: 'go-checksum-mismatch',
    pattern: /checksum mismatch|SECURITY ERROR.*go\.sum|missing go\.sum entry/,
    category: 'broken-lockfile',
    severity: 'blocker',
    confidence: 90,
    title: 'go.sum does not match the module contents',
    detail: () =>
      'The recorded module checksums no longer match what the proxy serves, or go.sum is missing entries for required modules. `go mod tidy` rebuilds it from the module graph.',
    repairs: ['go-mod-tidy'],
  },

  // -------------------------------------------------------------------------
  // Rust
  // -------------------------------------------------------------------------
  {
    id: 'rust-edition-unsupported',
    pattern: /edition(?:2018|2021|2024)?.*is required|feature `edition(\d+)` is required|this version of Cargo is older than the `(\d+)` edition/,
    category: 'runtime-version',
    severity: 'blocker',
    confidence: 93,
    title: 'Cargo is older than the edition the crate declares',
    detail: () =>
      'The crate declares a Rust edition that the installed Cargo does not understand. The toolchain is older than the project.',
    repairs: ['rust-use-declared-runtime', 'rust-lower-edition'],
  },
  {
    id: 'rust-lockfile-version',
    pattern: /lock file version (\d+) (?:requires|was found, but this version of Cargo)|lock file version `?(\d+)`? requires/,
    category: 'broken-lockfile',
    severity: 'blocker',
    confidence: 95,
    title: 'Cargo.lock format is newer than the installed Cargo',
    detail: () =>
      'The lockfile uses a format version the installed Cargo cannot read. Deleting it lets Cargo resolve a fresh, compatible lockfile from Cargo.toml.',
    repairs: ['rust-regenerate-lock'],
  },
  {
    id: 'rust-own-msrv',
    pattern:
      /rustc ([\d.]+) is not supported by the following packages?:|package `([^`]+)` cannot be built because it requires rustc ([\d.]+)/,
    also: /requires rustc|rust-version|currently active rustc/i,
    category: 'runtime-version',
    severity: 'blocker',
    confidence: 96,
    title: 'The crate declares a minimum Rust version newer than the installed compiler',
    detail: (m) =>
      `Cargo refuses to build this crate: it declares a minimum Rust version newer than the installed compiler${m[1] ? ` (installed: rustc ${m[1]})` : ''}${m[3] ? `, requires rustc ${m[3]}` : ''}. Nothing is compiled at all, so this is a manifest claim rather than a code problem. Abandoned crates frequently declare an MSRV higher than the code actually needs, so lowering the declaration is tested before anything else is changed.`,
    repairs: ['rust-lower-msrv', 'rust-use-declared-runtime'],
  },
  {
    id: 'rust-msrv',
    pattern: /package `([^`]+)` cannot be built because it requires rustc ([\d.]+)/,
    category: 'obsolete-dependency',
    severity: 'blocker',
    confidence: 95,
    title: 'A dependency requires a newer Rust compiler',
    detail: (m) =>
      `\`${m[1]}\` requires rustc ${m[2]} or newer. A transitive dependency resolved to a version with a higher MSRV than the installed toolchain — pinning it back to a compatible release is the minimal fix.`,
    repairs: ['rust-pin-msrv-dependency', 'rust-use-declared-runtime'],
  },
  {
    id: 'rust-e0658-unstable',
    pattern: /error\[E0658\]|use of unstable library feature/,
    category: 'compiler-behavior',
    severity: 'blocker',
    confidence: 85,
    title: 'Code uses a feature that is unstable on this compiler',
    detail: () =>
      'The source relies on a language or library feature that is not stable in the installed compiler, which means the toolchain is older than the code expects.',
    repairs: ['rust-use-declared-runtime'],
  },

  // -------------------------------------------------------------------------
  // Cross-cutting
  // -------------------------------------------------------------------------
  {
    id: 'missing-toolchain',
    pattern: /(?:command not found|is not recognized as an internal or external command|No such file or directory).*?\b(node|npm|yarn|pnpm|python|python3|pip|java|javac|mvn|gradle|go|cargo|rustc)\b|\b(node|npm|yarn|pnpm|python3?|pip3?|java|javac|mvn|gradle|go|cargo|rustc)\b.*?(?:command not found|is not recognized)/i,
    category: 'missing-toolchain',
    severity: 'blocker',
    confidence: 90,
    title: 'A required toolchain is not installed on this machine',
    detail: (m) => {
      const tool = m[1] || m[2] || 'the toolchain';
      return `\`${tool}\` is not available on the execution host. Revive cannot install system toolchains into the sandbox, so this project cannot be executed here — static analysis and diagnosis remain available.`;
    },
    repairs: [],
  },
  {
    id: 'network-unreachable',
    pattern: /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|getaddrinfo|network is unreachable|Could not resolve host|Temporary failure in name resolution/i,
    category: 'network',
    severity: 'blocker',
    confidence: 88,
    title: 'Network access failed while fetching dependencies',
    detail: () =>
      'A registry or proxy could not be reached. This is an environment problem rather than a defect in the repository — the same build may succeed on a connected machine.',
    repairs: ['retry-with-backoff'],
  },
  {
    id: 'missing-env-var',
    pattern: /(?:environment variable|env var)\s+["'`]?([A-Z][A-Z0-9_]{2,})["'`]?\s+(?:is )?(?:not set|is required|missing)|process\.env\.([A-Z][A-Z0-9_]{2,}) is (?:not defined|undefined)/,
    category: 'missing-env',
    severity: 'major',
    confidence: 80,
    title: 'The project expects an environment variable that is not set',
    detail: (m) =>
      `\`${m[1] || m[2]}\` is required but absent. Abandoned projects frequently assume a .env file that was never committed. Revive supplies an inert placeholder so the build can proceed, and records the assumption in the report.`,
    repairs: ['inject-placeholder-env'],
  },
  {
    id: 'out-of-memory',
    pattern: /JavaScript heap out of memory|FATAL ERROR:.*Allocation failed|OutOfMemoryError|Killed process/i,
    category: 'build-config',
    severity: 'blocker',
    confidence: 88,
    title: 'The build exhausted available memory',
    detail: () =>
      'The process ran out of heap. Older bundlers assumed a smaller default heap than modern Node provides, or the sandbox memory ceiling was reached.',
    repairs: ['increase-node-memory'],
  },
  {
    id: 'test-assertion-failure',
    pattern: /(\d+) (?:tests? )?(?:failed|failing)|AssertionError|FAILED \(failures=\d+\)|Tests run:.*Failures: [1-9]/i,
    category: 'test-failure',
    severity: 'major',
    confidence: 70,
    title: 'Tests ran but some assertions failed',
    detail: () =>
      'The suite executed, so the toolchain and dependencies resolved correctly, but assertions failed. Revive deliberately does not edit tests to make them pass — a green suite obtained by changing the tests would be a false result.',
    repairs: [],
    steps: ['test'],
  },
];

/** Apply every rule to one step's output and return the diagnoses that match. */
export function applyRules(
  output: string,
  step: StepName | 'clone' | 'detect',
): Omit<Diagnosis, 'source'>[] {
  const found: Omit<Diagnosis, 'source'>[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    if (rule.steps && step !== 'clone' && step !== 'detect') {
      if (!rule.steps.includes(step as StepName)) continue;
    }
    const match = output.match(rule.pattern);
    if (!match) continue;
    if (rule.also && !rule.also.test(output)) continue;
    if (rule.not && rule.not.test(output)) continue;
    if (seen.has(rule.id)) continue;
    seen.add(rule.id);

    found.push({
      category: rule.category,
      title: rule.title,
      detail: rule.detail(match),
      evidence: extractEvidence(output, match),
      step,
      confidence: rule.confidence,
      severity: rule.severity,
      suggestedRepairs: rule.repairs,
    });
  }

  return found;
}

/** Pull the matching line plus a little surrounding context out of the log. */
export function extractEvidence(output: string, match: RegExpMatchArray): string {
  const index = match.index ?? output.indexOf(match[0]);
  if (index < 0) return match[0].slice(0, 400);

  const lines = output.slice(0, index).split('\n');
  const lineNumber = lines.length - 1;
  const allLines = output.split('\n');
  const start = Math.max(0, lineNumber - 2);
  const end = Math.min(allLines.length, lineNumber + 4);

  return allLines
    .slice(start, end)
    .join('\n')
    .trim()
    .slice(0, 1200);
}
